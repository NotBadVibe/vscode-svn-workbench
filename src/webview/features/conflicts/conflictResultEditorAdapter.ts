/**
 * Pierre Editor 纯适配层（V012-B1）。
 * 只做薄适配，不引入 Svelte，不直接发 Host 消息。
 * 职责：File/Editor 生命周期、offset↔Range 转换、IME 守卫、单实例与 dispose 链、错误分类。
 */
import { File } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
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
  applyMergeEdit,
  type MergeDocumentState,
  type TextEdit as V012ATextEdit,
} from "../../../conflict/mergeDocumentModel";
import { CONFLICT_EDITOR_FIND_KEYMAP } from "./conflictShortcuts";

/** Pierre TextEdit 行列形态（0 基 UTF-16） */
interface PierreTextEdit {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  newText: string;
}

/** 挂载选项 */
export interface ConflictResultEditorMountOptions {
  relativePath: string;
  language?: string;
  getMergeState: () => MergeDocumentState;
  onDraftChange?: (text: string, revision: number) => void;
  onError?: (info: DiffErrorInfo, error: unknown) => void;
  readonly?: boolean;
}

/** 对外 API */
export interface ConflictResultEditorApi {
  getText: () => string;
  focusLine: (line: number) => void;
  applyRegionEdit: (edits: V012ATextEdit[]) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
  isComposing: () => boolean;
}

/** 句柄 */
export interface ConflictResultEditorMountHandle {
  readonly container: HTMLElement;
  dispose: () => void;
  getApi: () => ConflictResultEditorApi;
}

// 单实例：按容器隔离，重复挂载先 dispose 旧实例
const activeHandles = new WeakMap<
  HTMLElement,
  ConflictResultEditorMountHandle
>();

/** 将字符偏移转为 Pierre 行列（基于 \n 累计） */
export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; character: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

/** 将 Pierre 行列转为字符偏移（基于 \n 累计） */
export function positionToOffset(
  text: string,
  pos: { line: number; character: number },
): number {
  const lines = text.split("\n");
  let offset = 0;
  const targetLine = Math.max(0, pos.line);
  for (let i = 0; i < targetLine && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  const lineLen = lines[targetLine]?.length ?? 0;
  const char = Math.max(0, Math.min(pos.character, lineLen));
  return Math.min(text.length, offset + char);
}

/** 把 V012-A 偏移 TextEdit 转为 Pierre Range TextEdit */
export function toPierreEdits(
  text: string,
  edits: V012ATextEdit[],
): PierreTextEdit[] {
  return edits.map((edit) => ({
    range: {
      start: offsetToPosition(text, edit.start),
      end: offsetToPosition(text, edit.end),
    },
    newText: edit.newText,
  }));
}

/** 中文注释：计算增量 TextEdit，避免每次输入都全量 0-len 替换（100 块时全量会使 tracked 全部坍缩） */
export function computeIncrementalEdit(
  oldText: string,
  newText: string,
): V012ATextEdit | undefined {
  if (oldText === newText) return undefined;
  let prefix = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (
    prefix < minLen &&
    oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)
  ) {
    prefix++;
  }
  // 完全前缀相等时 suffix 不应越过 prefix
  let suffix = 0;
  const maxSuffix = minLen - prefix;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  const start = prefix;
  const end = oldText.length - suffix;
  const newSlice = newText.slice(start, newText.length - suffix);
  return { start, end, newText: newSlice };
}

export function mountConflictResultEditor(
  container: HTMLElement,
  options: ConflictResultEditorMountOptions,
): ConflictResultEditorMountHandle | undefined {
  // 单实例：重复挂载先释放旧的
  const existing = activeHandles.get(container);
  if (existing) {
    try {
      existing.dispose();
    } catch {
      /* 单实例清理防御 */
    }
  }

  const observers: { disconnect(): void }[] = [];
  let fileInstance: InstanceType<typeof File> | undefined;
  let editorInstance: InstanceType<typeof Editor> | undefined;
  let detach: (() => void) | undefined;
  let disposed = false;
  let isComposing = false;
  let draftChangeTimer: ReturnType<typeof setTimeout> | undefined;
  // 程序化编辑（restore/take 等）触发的编辑不应再经 onChange 标记为手工修改，抑制一次
  let suppressNextOnChange = false;

  // 需在 dispose 中移除的监听
  let compositionStartHandler: (() => void) | undefined;
  let compositionEndHandler: (() => void) | undefined;
  let keydownHandler: ((e: KeyboardEvent) => void) | undefined;

  const clearDraftTimer = (): void => {
    if (draftChangeTimer !== undefined) {
      clearTimeout(draftChangeTimer);
      draftChangeTimer = undefined;
    }
  };

  const scheduleDraftChange = (text: string, revision: number): void => {
    clearDraftTimer();
    draftChangeTimer = setTimeout(() => {
      draftChangeTimer = undefined;
      if (!disposed) options.onDraftChange?.(text, revision);
    }, 50);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearDraftTimer();
    // 移除 IME 与快捷键监听
    if (compositionStartHandler) {
      container.removeEventListener(
        "compositionstart",
        compositionStartHandler as EventListener,
      );
    }
    if (compositionEndHandler) {
      container.removeEventListener(
        "compositionend",
        compositionEndHandler as EventListener,
      );
    }
    if (keydownHandler) {
      container.removeEventListener("keydown", keydownHandler, true);
    }
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {
        /* 观察器断开防御 */
      }
    }
    observers.length = 0;
    if (detach) {
      try {
        detach();
      } catch {
        /* detach 防御 */
      }
      detach = undefined;
    }
    if (editorInstance) {
      try {
        (editorInstance as unknown as { cleanUp: () => void }).cleanUp();
      } catch {
        /* editor 清理防御 */
      }
      editorInstance = undefined;
    }
    if (fileInstance) {
      try {
        (fileInstance as unknown as { cleanUp: () => void }).cleanUp();
      } catch {
        /* file 清理防御 */
      }
      fileInstance = undefined;
    }
    container.replaceChildren();
    activeHandles.delete(container);
  };

  const buildApi = (): ConflictResultEditorApi => ({
    getText: () => {
      try {
        if (editorInstance)
          return (
            editorInstance as unknown as { getText: () => string }
          ).getText();
      } catch {
        /* 回退到 draft */
      }
      try {
        return options.getMergeState().draftContents;
      } catch {
        return "";
      }
    },
    focusLine: (line: number) => {
      if (!editorInstance || disposed) return;
      try {
        (
          editorInstance as unknown as {
            focus: (o: { lineNumber: number }) => void;
          }
        ).focus({
          lineNumber: line,
        });
      } catch {
        /* 聚焦防御 */
      }
    },
    applyRegionEdit: (edits: V012ATextEdit[]) => {
      if (!editorInstance || disposed) return;
      try {
        const curText = options.getMergeState().draftContents;
        const pierreEdits = toPierreEdits(curText, edits);
        suppressNextOnChange = true;
        (
          editorInstance as unknown as { applyEdits: (e: unknown[]) => void }
        ).applyEdits(pierreEdits as unknown[]);
        // 若 onChange 未触发（如无实际变更），400ms 后自动清除抑制，避免误屏蔽下一次手工输入
        setTimeout(() => {
          if (suppressNextOnChange) suppressNextOnChange = false;
        }, 400);
      } catch {
        /* 应用编辑防御 */
        suppressNextOnChange = false;
      }
    },
    canUndo: () => {
      try {
        const fn = (editorInstance as unknown as { canUndo?: () => boolean })
          ?.canUndo;
        if (typeof fn === "function") return fn.call(editorInstance);
        // 兜底：若未实现则按 getState 判断
        return false;
      } catch {
        return false;
      }
    },
    canRedo: () => {
      try {
        const fn = (editorInstance as unknown as { canRedo?: () => boolean })
          ?.canRedo;
        if (typeof fn === "function") return fn.call(editorInstance);
        return false;
      } catch {
        return false;
      }
    },
    undo: () => {
      try {
        (editorInstance as unknown as { undo?: () => void })?.undo?.();
      } catch {
        /* undo 防御 */
      }
    },
    redo: () => {
      try {
        (editorInstance as unknown as { redo?: () => void })?.redo?.();
      } catch {
        /* redo 防御 */
      }
    },
    getState: () => {
      try {
        return (
          editorInstance as unknown as { getState?: () => unknown }
        )?.getState?.();
      } catch {
        return undefined;
      }
    },
    setState: (state: unknown) => {
      try {
        (
          editorInstance as unknown as { setState?: (s: unknown) => void }
        )?.setState?.(state);
      } catch {
        /* setState 防御 */
      }
    },
    isComposing: () => isComposing,
  });

  // 初始草稿文本（用于错误保留）
  let initialText: string;
  try {
    initialText = options.getMergeState().draftContents;
  } catch {
    initialText = "";
  }

  try {
    observers.push(observeDiffContainer(container));

    // IME 守卫：维护 isComposing，屏蔽组合期间快捷键
    compositionStartHandler = () => {
      isComposing = true;
    };
    compositionEndHandler = () => {
      isComposing = false;
    };
    keydownHandler = (e: KeyboardEvent) => {
      if (!isComposing) return;
      const key = e.key;
      const isSave = (e.ctrlKey || e.metaKey) && (key === "s" || key === "S");
      if (key === "Enter" || key === "Escape" || isSave) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    container.addEventListener(
      "compositionstart",
      compositionStartHandler as EventListener,
    );
    container.addEventListener(
      "compositionend",
      compositionEndHandler as EventListener,
    );
    container.addEventListener("keydown", keydownHandler, true);

    const fileOpts = {
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system" as const,
    };

    const before = new Set(container.querySelectorAll("diffs-container"));
    const file = new (
      File as unknown as new (o: unknown) => InstanceType<typeof File>
    )(fileOpts as unknown as never);
    (file as unknown as { render: (p: unknown) => void }).render({
      file: {
        name: options.relativePath,
        contents: initialText,
        lang: options.language,
      },
      containerWrapper: container,
    });
    fileInstance = file;
    for (const el of Array.from(
      container.querySelectorAll("diffs-container"),
    )) {
      if (!before.has(el) && (el as HTMLElement).shadowRoot) {
        observers.push(
          observeDiffShadowRoot((el as HTMLElement).shadowRoot as ShadowRoot),
        );
      }
    }

    if (!options.readonly) {
      // Pierre 编辑器 onChange：增量比对生成最小 TextEdit，避免全量替换导致 100 块 tracked 坍缩与重复解析
      const onChange = (): void => {
        if (disposed || !editorInstance) return;
        // 程序化编辑刚触发的 onChange 不应再计为手工修改
        if (suppressNextOnChange) {
          suppressNextOnChange = false;
          return;
        }
        let newText: string;
        try {
          newText = (
            editorInstance as unknown as { getText: () => string }
          ).getText();
        } catch {
          return;
        }
        let curState: MergeDocumentState;
        try {
          curState = options.getMergeState();
        } catch {
          return;
        }
        const oldText = curState.draftContents;
        if (newText === oldText) return;
        const edit = computeIncrementalEdit(oldText, newText);
        if (!edit) return;
        const result = applyMergeEdit(curState, {
          expectedRevision: curState.draftRevision,
          edit,
        });
        if (!result.ok) {
          // 旧 revision 等拒绝静默忽略
          return;
        }
        scheduleDraftChange(newText, result.state.draftRevision);
      };

      // V012-E：查找经 keymap 绑定 openSearchPanel 间接启用（无程序化 API），仅交付查找，替换延期
      let editor: InstanceType<typeof Editor> | undefined;
      try {
        editor = new (
          Editor as unknown as new (o: unknown) => InstanceType<typeof Editor>
        )({
          onChange,
          keymap: CONFLICT_EDITOR_FIND_KEYMAP,
        } as unknown as never);
      } catch {
        // 查找 keymap 绑定失败优雅降级（不报错炸页面）
        try {
          editor = new (
            Editor as unknown as new (o: unknown) => InstanceType<typeof Editor>
          )({
            onChange,
          } as unknown as never);
        } catch {
          throw new DiffStageError("editor-attach", "编辑器附加失败", {
            cause: new Error("Editor init failed"),
          });
        }
      }
      editorInstance = editor as InstanceType<typeof Editor>;
      // attach 可能抛错，单独 try
      try {
        const d = (editor as unknown as { edit: (f: unknown) => unknown }).edit(
          fileInstance,
        );
        if (typeof d === "function") detach = d as () => void;
      } catch (error) {
        throw new DiffStageError("editor-attach", "编辑器附加失败", {
          cause: error,
        });
      }
    }

    const handle: ConflictResultEditorMountHandle = {
      container,
      dispose,
      getApi: buildApi,
    };
    activeHandles.set(container, handle);
    return handle;
  } catch (error) {
    // 失败需完整清理，但保留文本供只读查看
    clearDraftTimer();
    for (const o of observers) {
      try {
        o.disconnect();
      } catch {
        /* 观察器断开防御 */
      }
    }
    observers.length = 0;
    if (detach) {
      try {
        detach();
      } catch {
        /* detach 防御 */
      }
    }
    if (editorInstance) {
      try {
        (editorInstance as unknown as { cleanUp: () => void }).cleanUp();
      } catch {
        /* editor 清理防御 */
      }
    }
    if (fileInstance) {
      try {
        (fileInstance as unknown as { cleanUp: () => void }).cleanUp();
      } catch {
        /* file 清理防御 */
      }
    }
    try {
      container.replaceChildren();
      // 保留文本：以纯文本展示，避免空白容器
      const pre = document.createElement("pre");
      pre.textContent = initialText;
      pre.setAttribute("data-fallback-text", "1");
      container.appendChild(pre);
    } catch {
      /* 保留文本防御 */
    }
    const info = classifyDiffRenderError(error);
    try {
      options.onError?.(info, error);
    } catch {
      /* 回调防御 */
    }
    return undefined;
  }
}
