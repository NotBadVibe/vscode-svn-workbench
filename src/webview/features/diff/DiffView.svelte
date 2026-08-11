<script lang="ts">
  import { FileDiff, parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
  import { mapToDiffLanguage } from "./diffLanguage";
  import { observeDiffShadowRoot } from "./cspCompatObserver";
  import { diffViewLabels } from "../../i18n/terminology";

  /*
   * @pierre/diffs 适配层（v0.0.4 阶段 1）。
   *
   * 职责：
   * - 封装 vanilla FileDiff 的挂载/卸载与快照切换生命周期（old/new 全文与
   *   patch 直渲两种输入），业务模块只依赖本组件；
   * - 挂载收窄版 CSP 兼容垫片（见 cspCompatObserver.ts 的安全论证），
   *   保持 renderWebviewShell.ts 的严格 CSP 不放松；
   * - 提供中文、键盘可达的 unified/split 视图切换与"展开全部/折叠未变更"
   *   控制（组件折叠控件本身 tabIndex=-1 键盘不可达，垫片已补齐 aria，
   *   工具栏是不依赖这些控件的等价路径）；
   * - 挂载/渲染抛错时通过 onFallback 通知父级降级到 MergeView / 原始文本。
   *
   * 主题跟随：themeType "system" 让组件按宿主 color-scheme 在
   * pierre-dark/pierre-light 间切换；VS Code 变量到 --diffs-* 的映射在
   * styles/diff-theme.css（自定义属性跨 Shadow DOM 继承，主题切换自动生效）。
   */
  let {
    relativePath,
    language = "text",
    oldContents,
    newContents,
    patch,
    onFallback,
  }: {
    relativePath: string;
    language?: string;
    /** old/new 全文模式：BASE 与工作副本内容。 */
    oldContents?: string;
    newContents?: string;
    /** patch 直渲模式：unified diff 原文（修订比较）；提供时优先于 old/new。 */
    patch?: string;
    /** 挂载或渲染失败回调；父级负责切换到降级 UI。 */
    onFallback: (error: unknown) => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let diffStyle = $state<"unified" | "split">("split");
  let expandUnchanged = $state(false);

  // 预热当前文件语言的高亮资源（语言 chunk 懒加载）；失败不阻塞基础渲染，
  // 组件会在高亮不可用时先渲染无色文本。
  $effect(() => {
    if (patch != null) return;
    const lang = mapToDiffLanguage(language, relativePath);
    if (lang === "text") return;
    preloadHighlighter({
      themes: ["pierre-dark", "pierre-light"],
      langs: [lang],
    }).catch((error: unknown) => {
      console.warn("差异语法高亮资源加载失败，将以纯文本渲染。", error);
    });
  });

  $effect(() => {
    const container = host;
    if (!container) return;
    // 读取响应式状态：视图切换/折叠控制会触发本 effect 重跑并重挂载。
    const style = diffStyle;
    const expand = expandUnchanged;
    const instances: FileDiff[] = [];
    const observers: { disconnect(): void }[] = [];
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      for (const observer of observers) observer.disconnect();
      for (const instance of instances) instance.cleanUp();
      container.replaceChildren();
    };
    try {
      const options = {
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: "system",
        diffStyle: style,
        expandUnchanged: expand,
        overflow: "scroll",
        // 状态不只靠颜色：gutter 保留 +/- 指示符（规划 §5 P1）。
        diffIndicators: "classic",
        // 渲染异常抛给适配层，由父级降级（不渲染库自带的错误块）。
        disableErrorHandling: true,
      } as const;
      const mountInstance = (
        extraOptions: { disableFileHeader?: boolean },
        render: (instance: FileDiff<undefined>) => void,
      ): void => {
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
      };
      if (patch != null) {
        const files = parsePatchFiles(patch).flatMap((parsed) => parsed.files);
        if (files.length === 0) {
          throw new Error("patch 中没有可解析的文件差异");
        }
        for (const fileDiff of files) {
          mountInstance({ disableFileHeader: false }, (instance) =>
            instance.render({ fileDiff, containerWrapper: container }),
          );
        }
      } else {
        const lang = mapToDiffLanguage(language, relativePath);
        // 文件标题已由模块工具栏展示，避免组件头重复显示路径。
        mountInstance({ disableFileHeader: true }, (instance) =>
          instance.render({
            oldFile: {
              name: relativePath,
              contents: oldContents ?? "",
              lang,
            },
            newFile: {
              name: relativePath,
              contents: newContents ?? "",
              lang,
            },
            containerWrapper: container,
          }),
        );
      }
    } catch (error) {
      dispose();
      onFallback(error);
      return;
    }
    return dispose;
  });
</script>

<div class="diff-view">
  <div
    class="diff-view-toolbar"
    role="group"
    aria-label={diffViewLabels.switchGroup}
  >
    <button
      type="button"
      class="button button--secondary"
      aria-pressed={diffStyle === "unified"}
      onclick={() => (diffStyle = "unified")}
    >
      {diffViewLabels.unified}
    </button>
    <button
      type="button"
      class="button button--secondary"
      aria-pressed={diffStyle === "split"}
      onclick={() => (diffStyle = "split")}
    >
      {diffViewLabels.split}
    </button>
    <span class="diff-view-toolbar-divider" aria-hidden="true"></span>
    <button
      type="button"
      class="button button--secondary"
      disabled={expandUnchanged}
      onclick={() => (expandUnchanged = true)}
    >
      {diffViewLabels.expandAll}
    </button>
    <button
      type="button"
      class="button button--secondary"
      disabled={!expandUnchanged}
      onclick={() => (expandUnchanged = false)}
    >
      {diffViewLabels.collapseUnchanged}
    </button>
  </div>
  <div
    class="diff-view-frame"
    role="region"
    aria-label={`${relativePath} ${diffViewLabels.contentRegion}`}
    bind:this={host}
  ></div>
</div>
