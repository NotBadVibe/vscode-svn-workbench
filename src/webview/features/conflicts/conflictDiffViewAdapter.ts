import { UnresolvedFile } from "@pierre/diffs";
import type {
  MergeConflictActionPayload,
  MergeConflictResolution,
} from "@pierre/diffs";
import {
  observeDiffContainer,
  observeDiffShadowRoot,
} from "../diff/cspCompatObserver";
import {
  classifyDiffRenderError,
  DiffStageError,
  type DiffErrorInfo,
} from "../diff/diffErrorTaxonomy";
import {
  buildPierreUnresolvedInput,
  parseConflictRegions,
} from "../../../conflict/conflictDiffModel";
import type { ConflictParseError } from "../../../conflict/conflictDiffModel";

export interface ConflictDiffViewApi {
  getText: () => string;
  focusConflict: (conflictIndex: number) => void;
  getBlockProgress: () => { current: number; total: number };
  getControlledResult: () => string;
}

export interface ConflictDiffViewMountInput {
  relativePath: string;
  workingText: string;
  language?: string;
}

export interface ConflictDiffViewMountHooks {
  onMergeConflictAction?: (payload: MergeConflictActionPayload) => void;
  onError: (info: DiffErrorInfo, error: unknown) => void;
  onReady?: (api: ConflictDiffViewApi) => void;
}

export interface ConflictDiffViewMountHandle {
  readonly container: HTMLElement;
  dispose: () => void;
  getApi: () => ConflictDiffViewApi;
}

function createChineseActionRenderer(
  _onAction?: (payload: MergeConflictActionPayload) => void,
): (action: { conflictIndex: number }) => HTMLElement {
  void _onAction;
  return (action: { conflictIndex: number }) => {
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "6px";
    wrap.style.flexWrap = "wrap";
    wrap.setAttribute("data-conflict-actions", String(action.conflictIndex));
    const defs: Array<{
      label: string;
      resolution: MergeConflictResolution;
      title: string;
    }> = [
      {
        label: "采用我的修改",
        resolution: "current",
        title: "采用我的修改（本地）",
      },
      {
        label: "采用对方修改",
        resolution: "incoming",
        title: "采用对方修改（仓库）",
      },
      {
        label: "保留双方修改",
        resolution: "both",
        title: "保留双方修改 — 当前顺序为先我的后对方，另一顺序延期到 v0.1.2",
      },
    ];
    for (const def of defs) {
      const btn = document.createElement("button");
      btn.textContent = def.label;
      btn.title = def.title;
      btn.type = "button";
      btn.className = "button button--secondary conflict-action-btn";
      btn.setAttribute("data-merge-conflict-action", def.resolution);
      btn.setAttribute(
        "data-merge-conflict-conflict-index",
        String(action.conflictIndex),
      );
      btn.setAttribute(
        "data-testid",
        `conflict-action-${def.resolution}-${action.conflictIndex}`,
      );
      wrap.appendChild(btn);
    }
    return wrap;
  };
}

export function mountConflictDiffView(
  container: HTMLElement,
  input: ConflictDiffViewMountInput,
  hooks: ConflictDiffViewMountHooks,
): ConflictDiffViewMountHandle | undefined {
  const observers: { disconnect(): void }[] = [];
  let instance: UnresolvedFile<unknown> | undefined;
  let disposed = false;
  let blockTotal = 0;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const o of observers) o.disconnect();
    observers.length = 0;
    if (instance) {
      try {
        instance.cleanUp();
      } catch {
        /* thin adapter: Pierre file cache optional */
      }
      instance = undefined;
    }
    container.replaceChildren();
  };

  const buildApi = (): ConflictDiffViewApi => ({
    getText: () => {
      try {
        const cur = (
          instance as unknown as {
            __getCurrentFile?: () => { contents: string };
          }
        )?.__getCurrentFile?.();
        if (cur) return cur.contents;
      } catch {
        /* thin adapter: Pierre file cache optional */
      }
      return input.workingText;
    },
    focusConflict: (conflictIndex: number) => {
      if (!instance || disposed) return;
      // 尝试通过 revealLine 定位到该冲突的起始行
      const rev = instance as unknown as {
        revealLine?: (n: number) => boolean;
      };
      if (rev.revealLine) {
        try {
          // 优先尝试使用内部 marker 行号，若不可用则按冲突索引估算
          const anyInst = instance as unknown as {
            computedCache?: { markerRows?: Array<{ lineIndex: number }> };
          };
          const rows = anyInst.computedCache?.markerRows;
          if (rows && rows[conflictIndex]) {
            rev.revealLine(rows[conflictIndex].lineIndex + 1);
            return;
          }
        } catch {
          /* thin adapter: Pierre file cache optional */
        }
        rev.revealLine(conflictIndex + 1);
        return;
      }
      // 兜底：滚动容器内的冲突动作槽（reduced motion 下用 auto，避免平滑滚动）。
      const slot = container.querySelector(
        `[data-conflict-actions="${conflictIndex}"]`,
      );
      if (slot) {
        const reduceMotion =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        slot.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "center",
        });
      }
    },
    getBlockProgress: () => ({ current: 0, total: blockTotal }), // 块进度由组件侧 currentBlock 维护，adapter 仅提供总数，避免谎报 current=1
    getControlledResult: () => {
      try {
        const cur = (
          instance as unknown as {
            __getCurrentFile?: () => { contents: string };
          }
        )?.__getCurrentFile?.();
        if (cur) return cur.contents;
      } catch {
        /* thin adapter: Pierre file cache optional */
      }
      return input.workingText;
    },
  });

  try {
    const pierreInput = buildPierreUnresolvedInput(input.workingText);
    if (pierreInput.error) {
      throw new DiffStageError("mount", pierreInput.error.message, {
        cause: pierreInput.error,
      });
    }
    try {
      const parsed = parseConflictRegions(input.workingText);
      blockTotal = parsed.error ? 0 : parsed.regions.length;
    } catch {
      blockTotal = 0;
    }

    observers.push(observeDiffContainer(container));
    const rawRenderer = createChineseActionRenderer(
      hooks.onMergeConflictAction,
    );
    // Pierre 类型声明将 mergeConflictActionsType 标为 string，实际接受渲染函数（见 spike tests/spike/src/unresolved-spike.ts 用法 createChineseActionRenderer(...) as any）
    const toPierreActionRenderer = (
      fn: (a: { conflictIndex: number }) => HTMLElement,
    ): unknown => fn as unknown as string;
    const chineseRenderer = toPierreActionRenderer(rawRenderer);
    const opts = {
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system" as const,
      mergeConflictActionsType: chineseRenderer as string,
      onMergeConflictAction: (payload: MergeConflictActionPayload) => {
        hooks.onMergeConflictAction?.(payload);
      },
      disableErrorHandling: true as unknown as boolean,
    } as unknown as ConstructorParameters<typeof UnresolvedFile>[0];

    const before = new Set(container.querySelectorAll("diffs-container"));
    const inst: UnresolvedFile<unknown> = new UnresolvedFile(opts as never);
    inst.render({
      file: { name: input.relativePath, contents: input.workingText },
      containerWrapper: container,
    });
    instance = inst;
    for (const el of Array.from(
      container.querySelectorAll("diffs-container"),
    )) {
      if (!before.has(el) && (el as HTMLElement).shadowRoot) {
        observers.push(
          observeDiffShadowRoot((el as HTMLElement).shadowRoot as ShadowRoot),
        );
      }
    }
    hooks.onReady?.(buildApi());
    return { container, dispose, getApi: buildApi };
  } catch (error) {
    dispose();
    const info = classifyDiffRenderError(error);
    const withCause =
      error instanceof DiffStageError &&
      (error as unknown as { cause?: ConflictParseError }).cause
        ? { ...info, what: (error as Error).message }
        : info;
    hooks.onError(withCause as DiffErrorInfo, error);
    return undefined;
  }
}
