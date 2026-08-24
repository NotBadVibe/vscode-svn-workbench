/*
 * v0.1.0（V010-C）@pierre/diffs 薄挂载适配层：单一生命周期。
 *
 * 把实例创建、CSP observer 注册、Editor attach、cleanup、fallback 错误
 * 分类收敛到 mountDiffView 一个入口；DiffView.svelte 只负责
 * 「是否重建」的纯决策（diffViewLifecycle.ts）与调用本适配器。
 *
 * 释放顺序（幂等）：observer disconnect → Editor detach/cleanUp →
 * FileDiff.cleanUp → 清空容器 DOM。销毁与异常路径共用同一 dispose。
 */
import { FileDiff, parsePatchFiles } from "@pierre/diffs";
import type { SupportedLanguages } from "@pierre/diffs";
import { Editor } from "@pierre/diffs/edit";
import {
  observeDiffContainer,
  observeDiffShadowRoot,
} from "./cspCompatObserver";
import {
  DiffStageError,
  classifyDiffRenderError,
  type DiffErrorInfo,
} from "./diffErrorTaxonomy";

/** DiffView 暴露给业务模块的读取/导航/逐块采用 API。 */
export interface DiffViewApi {
  getText: () => string;
  /** 编辑态经 Editor 聚焦；只读态经 FileDiff.revealLine 滚入目标行。 */
  focusLine: (lineNumber: number) => void;
  applyRegionEdit: (
    startLine: number,
    endLine: number,
    newText: string,
  ) => void;
}

export interface DiffViewMountInput {
  relativePath: string;
  /** 已归一到 Shiki 子集的语言（mapToDiffLanguage 结果）。 */
  language: SupportedLanguages;
  oldContents: string;
  newContents: string;
  /** patch 直渲输入（修订比较）；存在时忽略 old/new 全文。 */
  patch: string | undefined;
  diffStyle: "unified" | "split";
  expandUnchanged: boolean;
  editMode: boolean;
}

export interface DiffViewMountHooks {
  onEditChange?: (text: string) => void;
  onReady?: (api: DiffViewApi) => void;
  /** 结构化失败回调：分类信息 + 原始异常（诊断用）。 */
  onError: (info: DiffErrorInfo, error: unknown) => void;
}

export interface DiffViewMountHandle {
  /** 实际挂载实例的容器；销毁时必须清理它而不是调用方当前容器。 */
  readonly container: HTMLElement;
  /** 释放全部实例、Editor 与 observer（幂等）。 */
  dispose: () => void;
}

/**
 * 在 container 内挂载差异视图。任何阶段失败都会先完整 dispose，
 * 再经 onError 上报结构化错误并返回 undefined（不残留半挂载状态）。
 */
export function mountDiffView(
  container: HTMLElement,
  input: DiffViewMountInput,
  hooks: DiffViewMountHooks,
): DiffViewMountHandle | undefined {
  const observers: { disconnect(): void }[] = [];
  const instances: FileDiff[] = [];
  const editorDetachers: (() => void)[] = [];
  const editors: Editor<undefined>[] = [];
  let disposed = false;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    for (const detach of editorDetachers) detach();
    editorDetachers.length = 0;
    for (const editor of editors) editor.cleanUp();
    editors.length = 0;
    for (const instance of instances) instance.cleanUp();
    instances.length = 0;
    container.replaceChildren();
  };

  try {
    // 容器级 CSP 兼容垫片（随实例生命周期一起释放）。
    observers.push(observeDiffContainer(container));
    const options = {
      theme: { dark: "pierre-dark", light: "pierre-light" },
      themeType: "system",
      diffStyle: input.diffStyle,
      expandUnchanged: input.expandUnchanged,
      overflow: "scroll",
      // 状态不只靠颜色：gutter 保留 +/- 指示符（规划 §5 P1）。
      diffIndicators: "classic",
      // 渲染异常抛给适配层，由父级降级（不渲染库自带的错误块）。
      disableErrorHandling: true,
    } as const;

    const mountInstance = (
      extraOptions: { disableFileHeader?: boolean },
      render: (instance: FileDiff<undefined>) => void,
    ): FileDiff<undefined> => {
      const before = new Set(container.querySelectorAll("diffs-container"));
      const instance = new FileDiff({ ...options, ...extraOptions });
      render(instance);
      instances.push(instance);
      for (const element of Array.from(
        container.querySelectorAll("diffs-container"),
      )) {
        if (!before.has(element) && element.shadowRoot != null) {
          observers.push(observeDiffShadowRoot(element.shadowRoot));
        }
      }
      return instance;
    };

    if (input.patch != null) {
      const files = parsePatchFiles(input.patch).flatMap(
        (parsed) => parsed.files,
      );
      if (files.length === 0) {
        throw new DiffStageError("patch-parse", "patch 中没有可解析的文件差异");
      }
      try {
        for (const fileDiff of files) {
          mountInstance({ disableFileHeader: false }, (instance) =>
            instance.render({ fileDiff, containerWrapper: container }),
          );
        }
      } catch (error) {
        throw new DiffStageError("mount", "patch 差异渲染失败", {
          cause: error,
        });
      }
      hooks.onReady?.({
        getText: () => "",
        focusLine: (lineNumber: number) => {
          for (const instance of instances) {
            if (instance.revealLine(lineNumber)) return;
          }
        },
        applyRegionEdit: () => undefined,
      });
      return { container, dispose };
    }

    let instance: FileDiff<undefined>;
    try {
      instance = mountInstance({ disableFileHeader: true }, (created) => {
        created.render({
          oldFile: {
            name: input.relativePath,
            contents: input.oldContents,
            lang: input.language,
          },
          newFile: {
            name: input.relativePath,
            contents: input.newContents,
            lang: input.language,
          },
          containerWrapper: container,
        });
      });
    } catch (error) {
      throw new DiffStageError("mount", "差异视图挂载失败", { cause: error });
    }

    // 编辑态：附加编辑器，仅工作副本侧可编辑；edit() 返回 detach，
    // 与 Editor.cleanUp 一起进入统一释放链。
    let editorInstance: Editor<undefined> | undefined;
    if (input.editMode) {
      try {
        const editor = new Editor<undefined>({
          onChange: () => {
            hooks.onEditChange?.(editor.getText());
          },
        });
        const detach = editor.edit(instance) as unknown;
        // 防御：真实 API 返回 detach 函数；mock/未来版本不返回时跳过。
        if (typeof detach === "function")
          editorDetachers.push(() => (detach as () => void)());
        editors.push(editor);
        editorInstance = editor;
      } catch (error) {
        throw new DiffStageError("editor-attach", "页内编辑器附加失败", {
          cause: error,
        });
      }
    }

    hooks.onReady?.({
      getText: () => editorInstance?.getText() ?? "",
      focusLine: (lineNumber: number) => {
        if (editorInstance) {
          editorInstance.focus({ lineNumber });
          return;
        }
        instance.revealLine(lineNumber);
      },
      applyRegionEdit: (startLine, endLine, newText) => {
        editorInstance?.applyEdits([
          {
            range: {
              start: { line: Math.max(0, startLine - 1), character: 0 },
              end: {
                line: Math.max(0, endLine - 1),
                character: Number.MAX_SAFE_INTEGER,
              },
            },
            newText,
          },
        ]);
      },
    });
    return { container, dispose };
  } catch (error) {
    dispose();
    hooks.onError(classifyDiffRenderError(error), error);
    return undefined;
  }
}
