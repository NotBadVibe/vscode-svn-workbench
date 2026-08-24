<script lang="ts" module>
  import { installDiffCspCompatibilityShim } from "./cspCompatObserver";

  // 生产 CSP 适配第一层（插入前拦截）：模块加载即安装，幂等。
  installDiffCspCompatibilityShim();
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { preloadHighlighter } from "@pierre/diffs";
  import { mapToDiffLanguage } from "./diffLanguage";
  import { mountDiffView, type DiffViewMountHandle } from "./diffViewAdapter";
  import { diffErrorInfo, type DiffErrorInfo } from "./diffErrorTaxonomy";
  import {
    shouldRebuildDiffView,
    type DiffViewMountState,
  } from "./diffViewLifecycle";
  import { diffViewLabels } from "../../i18n/terminology";

  /*
   * @pierre/diffs 适配层（v0.0.4 阶段 1 + v0.0.6 编辑态 + v0.1.0 薄化）。
   *
   * v0.1.0（V010-C）起本组件只保留业务入口职责：
   * - 持有「是否重建」的纯决策（diffViewLifecycle.shouldRebuildDiffView）；
   * - 实例创建、observer 注册、Editor attach、cleanup 与错误分类全部收敛到
   *   diffViewAdapter.mountDiffView 的单一生命周期；
   * - 视图设置（unified/split、展开未变更）由 DiffModule 的统一工具区持有，
   *   经 props 传入；偏好只影响呈现，不改变内容与操作范围。
   *
   * 生命周期语义不变：
   * - 编辑态同键同容器：保持实例不重建（Host 保存后权威快照刷新不丢输入）；
   * - 只读态内容变化：重建以采用权威内容；
   * - 挂载键/容器身份变化：释放旧实例（清理旧容器 DOM）后重建；
   * - 组件销毁由 onDestroy 兜底释放。
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
    editMode = false,
    diffStyle = "split",
    expandUnchanged = false,
    /** 重试计数：变化时重新预热高亮并重建实例。 */
    retryToken = 0,
    onEditChange,
    onReady,
    onFallback,
    onHighlightError,
  }: {
    relativePath: string;
    language?: string;
    oldContents?: string;
    newContents?: string;
    patch?: string;
    /** v0.0.6：是否处于编辑态（仅 Working Copy 侧可编辑）。 */
    editMode?: boolean;
    /** v0.1.0：视图偏好由 DiffModule 统一工具区持有。 */
    diffStyle?: "unified" | "split";
    expandUnchanged?: boolean;
    retryToken?: number;
    /** 编辑内容变化回调（供脏状态与草稿检查点）。 */
    onEditChange?: (text: string) => void;
    /** 挂载完成回调：暴露读取/导航/逐块采用 API。 */
    onReady?: (api: {
      getText: () => string;
      focusLine: (lineNumber: number) => void;
      applyRegionEdit: (
        startLine: number,
        endLine: number,
        newText: string,
      ) => void;
    }) => void;
    /** v0.1.0：结构化失败回调（分类信息 + 原始异常）。 */
    onFallback: (info: DiffErrorInfo, error: unknown) => void;
    /** 高亮资源失败回调（非阻塞，纯文本降级）。 */
    onHighlightError?: (info: DiffErrorInfo) => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  /**
   * 挂载就绪信号：bind:this 的 host 在父级重渲染时可能被重赋值（新身份）。
   * onMount 只执行一次（绝不重复赋值），渲染 effect 以该布尔信号为首个依赖
   * 门槛；即便 host 身份变化触发了 effect 重跑，重建与否仍由下方挂载键与
   * 内容键的语义比较决定（编辑态保持实例）。
   */
  let hostReady = $state(false);
  onMount(() => {
    hostReady = true;
  });

  /** 当前挂载状态（含实际容器与渲染内容），用于决定重建/保持。 */
  let mounted: DiffViewMountState | undefined;
  /** 当前适配层句柄（dispose 幂等）。 */
  let handle: DiffViewMountHandle | undefined;

  /** 释放当前挂载（幂等；重建与组件销毁共用）。 */
  function disposeAll(): void {
    handle?.dispose();
    handle = undefined;
    mounted = undefined;
  }

  onDestroy(disposeAll);

  // 预热当前文件语言的高亮资源（语言 chunk 懒加载）；失败不阻塞基础渲染，
  // 但上报结构化错误供页面提示“已按纯文本渲染”与重试入口。
  $effect(() => {
    void retryToken;
    if (patch != null) return;
    const lang = mapToDiffLanguage(language, relativePath);
    if (lang === "text") return;
    preloadHighlighter({
      themes: ["pierre-dark", "pierre-light"],
      langs: [lang],
    }).catch((error: unknown) => {
      console.warn("差异语法高亮资源加载失败，将以纯文本渲染。", error);
      onHighlightError?.(diffErrorInfo("highlight-load-failed"));
    });
  });

  $effect(() => {
    void hostReady;
    const container = host;
    if (!container) return;
    const style = diffStyle;
    const expand = expandUnchanged;
    const isEditing = editMode;
    const rel = relativePath;
    const lang = language;
    const oldC = oldContents ?? "";
    const newC = newContents ?? "";
    const patchC = patch;
    const retry = retryToken;

    // 挂载键：目标/语言/编辑态/视图控件/重试。变化时必须重建（目标切换、
    // 退出编辑、unified/split、展开控制、重试渲染）。
    const key = `${rel}|${lang}|${isEditing}|${style}|${expand}|${retry}`;

    if (mounted) {
      if (
        shouldRebuildDiffView(mounted, {
          key,
          container,
          oldContents: oldC,
          newContents: newC,
          patch: patchC,
        })
      ) {
        // 容器身份变化 / 挂载键变化 / 只读态内容变化：释放旧实例重建。
        disposeAll();
      } else {
        // 编辑态同键同容器（含保存后权威快照刷新）：保持实例与编辑器，
        // 不打断正在进行的输入；或只读态内容未变。
        return;
      }
    }

    const ready = onReady;
    const fallback = onFallback;
    handle = mountDiffView(
      container,
      {
        relativePath: rel,
        language: mapToDiffLanguage(lang, rel),
        oldContents: oldC,
        newContents: newC,
        patch: patchC,
        diffStyle: style,
        expandUnchanged: expand,
        editMode: isEditing,
      },
      {
        onEditChange,
        onReady: ready,
        onError: (info, error) => {
          fallback(info, error);
        },
      },
    );
    if (handle === undefined) return;
    mounted = {
      key,
      mode: isEditing ? "edit" : "read",
      container,
      oldContents: oldC,
      newContents: newC,
      patch: patchC,
    };
  });
</script>

<div
  class="diff-view-frame"
  role="region"
  aria-label={`${relativePath} ${diffViewLabels.contentRegion}`}
  bind:this={host}
></div>
