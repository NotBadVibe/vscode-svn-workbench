/*
 * V018-B VirtualizedFileDiff 只读 spike 适配器（v0.1.8 规划 §4.2）。
 *
 * 范围：spike 专用，不被任何生产渲染引用。只覆盖只读分支
 * （old/new 全文或 parsePatchFiles 的 fileDiff），不挂载 Editor：
 * 编辑态虚拟化有布局失效风险（invalidateEditSessionLayout 专属 API），
 * 有不兼容证据即不启用编辑态虚拟化。
 *
 * 生命周期（幂等 dispose）：observer disconnect → Virtualizer
 * disconnect/cleanUp → VirtualizedFileDiff.cleanUp → 清空容器。
 * CSP 垫片复用生产 cspCompatObserver（插入前拦截全局幂等 + 插入后
 * 观察器随实例释放）。
 */
import {
  VirtualizedFileDiff,
  Virtualizer,
  parsePatchFiles,
  type SupportedLanguages,
} from "@pierre/diffs";
import {
  observeDiffContainer,
  observeDiffShadowRoot,
} from "./cspCompatObserver";
import {
  DiffStageError,
  classifyDiffRenderError,
  type DiffErrorInfo,
} from "./diffErrorTaxonomy";

export interface V018VirtualizedSpikeInput {
  relativePath: string;
  language: SupportedLanguages;
  oldContents: string;
  newContents: string;
  /**
   * 修订比较 patch 直渲输入；存在时忽略 old/new 全文。
   * 与生产 diffViewAdapter 同口径（parsePatchFiles → files）。
   */
  patch?: string;
  diffStyle?: "unified" | "split";
  expandUnchanged?: boolean;
}

export interface V018VirtualizedSpikeHandle {
  readonly container: HTMLElement;
  readonly dispose: () => void;
  /** 虚拟化实例行数（布局估计用），诊断用。 */
  readonly virtualizedHeight: number;
}

/**
 * 在 scrollRoot（固定高度纵向滚动容器）内挂载只读 VirtualizedFileDiff。
 * 失败时完整 dispose 并经 onError 上报结构化错误，不残留半挂载状态。
 */
export function mountV018VirtualizedSpike(
  scrollRoot: HTMLElement,
  input: V018VirtualizedSpikeInput,
  hooks: {
    onError: (info: DiffErrorInfo, error: unknown) => void;
  },
): V018VirtualizedSpikeHandle | undefined {
  const observers: { disconnect(): void }[] = [];
  let virtualizer: Virtualizer | undefined;
  let instance: VirtualizedFileDiff | undefined;
  let disposed = false;
  // 连接用容器：render 内由实例经 virtualizer.connect 接管。
  let fileContainer: HTMLElement | undefined;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    if (fileContainer != null) {
      try {
        virtualizer?.disconnect(fileContainer);
      } catch {
        // 断开失败不阻断释放链。
      }
      fileContainer = undefined;
    }
    try {
      virtualizer?.cleanUp();
    } catch {
      // 同上。
    }
    virtualizer = undefined;
    if (instance != null) {
      try {
        instance.cleanUp();
      } catch {
        // 同上。
      }
      instance = undefined;
    }
    scrollRoot.replaceChildren();
  };

  try {
    observers.push(observeDiffContainer(scrollRoot));
    virtualizer = new Virtualizer();
    // 内容容器：虚拟化实例渲染目标，滚动根为纵向滚动视口。
    const content = document.createElement("div");
    content.dataset.v018SpikeContent = "1";
    scrollRoot.appendChild(content);
    virtualizer.setup(scrollRoot, content);

    const before = new Set(scrollRoot.querySelectorAll("diffs-container"));
    const created = new VirtualizedFileDiff(
      {
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: "system",
        diffStyle: input.diffStyle ?? "split",
        expandUnchanged: input.expandUnchanged ?? false,
        overflow: "scroll",
        diffIndicators: "classic",
        disableErrorHandling: true,
      } as const,
      virtualizer,
    );
    instance = created;
    fileContainer = content;

    if (input.patch != null) {
      const files = parsePatchFiles(input.patch).flatMap(
        (parsed) => parsed.files,
      );
      if (files.length === 0) {
        throw new DiffStageError("patch-parse", "patch 中没有可解析的文件差异");
      }
      try {
        for (const fileDiff of files) {
          created.render({ fileDiff, containerWrapper: content });
        }
      } catch (error) {
        throw new DiffStageError("mount", "虚拟化 patch 差异渲染失败", {
          cause: error,
        });
      }
    } else {
      try {
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
          containerWrapper: content,
        });
      } catch (error) {
        throw new DiffStageError("mount", "虚拟化差异视图挂载失败", {
          cause: error,
        });
      }
    }

    for (const element of Array.from(
      scrollRoot.querySelectorAll("diffs-container"),
    )) {
      if (!before.has(element) && element.shadowRoot != null) {
        observers.push(observeDiffShadowRoot(element.shadowRoot));
      }
    }
    const virtualizedHeight = created.getVirtualizedHeight();
    return { container: scrollRoot, dispose, virtualizedHeight };
  } catch (error) {
    dispose();
    hooks.onError(classifyDiffRenderError(error), error);
    return undefined;
  }
}
