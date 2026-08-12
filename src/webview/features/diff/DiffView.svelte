<script lang="ts" module>
  import { installDiffCspCompatibilityShim } from "./cspCompatObserver";

  // 生产 CSP 适配第一层（插入前拦截）：模块加载即安装，幂等。
  installDiffCspCompatibilityShim();
</script>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { FileDiff, parsePatchFiles, preloadHighlighter } from "@pierre/diffs";
  import { Editor } from "@pierre/diffs/edit";
  import { mapToDiffLanguage } from "./diffLanguage";
  import {
    observeDiffContainer,
    observeDiffShadowRoot,
  } from "./cspCompatObserver";
  import { diffViewLabels } from "../../i18n/terminology";

  /*
   * @pierre/diffs 适配层（v0.0.4 阶段 1 + v0.0.6 编辑态）。
   *
   * 职责：
   * - 封装 vanilla FileDiff 的挂载/卸载与快照切换生命周期（old/new 全文与
   *   patch 直渲两种输入），业务模块只依赖本组件；
   * - 挂载收窄版 CSP 兼容垫片（见 cspCompatObserver.ts 的安全论证），
   *   保持 renderWebviewShell.ts 的严格 CSP 不放松；
   * - 提供中文、键盘可达的 unified/split 视图切换与"展开全部/折叠未变更"
   *   控制；
   * - v0.0.6 编辑态：editMode=true 时把 @pierre/diffs/edit 的 Editor 附加到
   *   可编辑 FileDiff，仅工作副本侧可编辑；通过 onEditChange 上报内容。
   *
   * 生命周期（手动管理，不依赖 $effect 依赖追踪的重跑语义）：
   * - 渲染 effect 不返回 cleanup；每次重跑由 body 按「挂载键
   *   （目标/语言/编辑态/视图控件）」与「渲染内容」比较决定：
   *   - 挂载键相同且编辑态：保持现有 FileDiff/Editor 实例不重建（Host 保存后
   *     权威快照刷新不丢快速二次输入）；
   *   - 挂载键相同且只读态：仅当渲染内容变化时重建（快照刷新采用权威内容）；
   *   - 挂载键变化（目标切换/退出编辑/视图切换）：释放旧实例并重建；
   *   - 组件销毁由 onDestroy 兜底释放。
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
    onEditChange,
    onReady,
    onFallback,
  }: {
    relativePath: string;
    language?: string;
    oldContents?: string;
    newContents?: string;
    patch?: string;
    /** v0.0.6：是否处于编辑态（仅 Working Copy 侧可编辑）。 */
    editMode?: boolean;
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
    onFallback: (error: unknown) => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let diffStyle = $state<"unified" | "split">("split");
  let expandUnchanged = $state(false);
  /** 当前附加的编辑器实例（编辑态）。 */
  let editorInstance: Editor<undefined> | undefined;
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

  /** 当前挂载的 FileDiff 实例与 CSP observer（手动生命周期持有）。 */
  const instances: FileDiff[] = [];
  const observers: { disconnect(): void }[] = [];
  /** 当前渲染的挂载键与内容，用于决定重建/保持。 */
  let mounted:
    { key: string; mode: "edit" | "read"; contentKey: string } | undefined;

  /** 释放全部实例与 observer（幂等；重建与组件销毁共用）。 */
  function disposeAll(): void {
    for (const observer of observers) observer.disconnect();
    observers.length = 0;
    for (const instance of instances) instance.cleanUp();
    instances.length = 0;
    const el = host;
    if (el) el.replaceChildren();
    mounted = undefined;
  }

  onDestroy(disposeAll);

  // 预热当前文件语言的高亮资源（语言 chunk 懒加载）；失败不阻塞基础渲染。
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

    // 挂载键：目标/语言/编辑态/视图控件。变化时必须重建（目标切换、
    // 退出编辑、unified/split、展开控制）。
    const key = `${rel}|${lang}|${isEditing}|${style}|${expand}`;
    // 渲染内容键：仅用于只读态判断内容是否变化（编辑态内容由编辑器持有，
    // 快照刷新不据此重建）。
    const contentKey = `${oldC}|${newC}|${patchC ?? ""}`;

    if (mounted) {
      if (mounted.key === key) {
        if (mounted.mode === "read" && mounted.contentKey !== contentKey) {
          // 只读态内容变化：释放旧实例，用权威内容重建。
          disposeAll();
        } else {
          // 编辑态同键（含保存后权威快照刷新）：保持实例与编辑器，
          // 不打断正在进行的输入；或只读态内容未变。
          return;
        }
      } else {
        // 挂载键变化：释放旧实例重建。
        disposeAll();
      }
    }

    const ready = onReady;
    const fallback = onFallback;
    try {
      // 容器级 CSP 兼容垫片（随实例生命周期一起释放）。
      observers.push(observeDiffContainer(container));
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
      if (patchC != null) {
        const files = parsePatchFiles(patchC).flatMap((parsed) => parsed.files);
        if (files.length === 0) {
          throw new Error("patch 中没有可解析的文件差异");
        }
        for (const fileDiff of files) {
          mountInstance({ disableFileHeader: false }, (instance) =>
            instance.render({ fileDiff, containerWrapper: container }),
          );
        }
      } else {
        const diffLang = mapToDiffLanguage(lang, rel);
        mountInstance({ disableFileHeader: true }, (instance) => {
          instance.render({
            oldFile: {
              name: rel,
              contents: oldC,
              lang: diffLang,
            },
            newFile: {
              name: rel,
              contents: newC,
              lang: diffLang,
            },
            containerWrapper: container,
          });
          // v0.0.6 编辑态：附加编辑器，仅工作副本侧可编辑。
          if (isEditing) {
            const editor = new Editor<undefined>({
              onChange: () => {
                onEditChange?.(editor.getText());
              },
            });
            editor.edit(instance);
            editorInstance = editor;
          }
          ready?.({
            getText: () => editorInstance?.getText() ?? "",
            focusLine: (lineNumber: number) =>
              editorInstance?.focus({ lineNumber }),
            applyRegionEdit: (
              startLine: number,
              endLine: number,
              newText: string,
            ) => {
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
        });
      }
      mounted = { key, mode: isEditing ? "edit" : "read", contentKey };
    } catch (error) {
      disposeAll();
      fallback(error);
      return;
    }
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
