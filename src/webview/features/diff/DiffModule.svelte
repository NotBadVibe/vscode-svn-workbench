<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { MergeView } from "@codemirror/merge";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import type {
    DiffSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import DiffView from "./DiffView.svelte";
  import { diffFallbackNotices } from "../../i18n/terminology";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: DiffSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let mergeHost = $state<HTMLDivElement>();
  /*
   * 差异组件（@pierre/diffs）渲染失败标记，按快照身份记录：
   * 新快照注入后身份变化即自动恢复组件渲染（一次失败不永久锁死降级路径）。
   * $state.raw 保持对象引用原样（深代理会破坏 === 身份比较）。
   * MergeView（Working/BASE）与 <pre>（修订比较）代码路径保留为内部回退，
   * 验收通过后按规划在下一版本评估移除。
   */
  let failedSnapshot = $state.raw<DiffSnapshot>();
  const pierreFailed = $derived(
    failedSnapshot !== undefined && failedSnapshot === snapshot,
  );

  function focusOnMount(node: HTMLElement): void {
    queueMicrotask(() => node.focus());
  }

  function handlePierreFallback(error: unknown): void {
    console.warn("差异渲染组件失败，已切换到降级视图。", error);
    failedSnapshot = snapshot;
  }

  const readonlyExtensions = [
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--vscode-editor-foreground)",
        backgroundColor: "var(--vscode-editor-background)",
        fontSize: "var(--vscode-editor-font-size, 12px)",
      },
      ".cm-content": {
        fontFamily: "var(--vscode-editor-font-family, monospace)",
        caretColor: "transparent",
      },
      ".cm-gutters": {
        color: "var(--vscode-editorLineNumber-foreground)",
        backgroundColor:
          "var(--vscode-editorGutter-background, var(--vscode-editor-background))",
        border: "none",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--vscode-editor-selectionBackground) !important",
      },
    }),
  ];

  // MergeView 仅作为差异组件失败后的内部回退路径挂载。
  $effect(() => {
    const parent = mergeHost;
    const original = snapshot.original;
    const modified = snapshot.modified;
    const showMergeView =
      pierreFailed && !snapshot.binary && snapshot.language !== "diff";
    if (!parent || !showMergeView) return;

    const mergeView = new MergeView({
      a: {
        doc: original,
        extensions: [
          ...readonlyExtensions,
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.relativePath} BASE 内容`,
          }),
        ],
      },
      b: {
        doc: modified,
        extensions: [
          ...readonlyExtensions,
          EditorView.contentAttributes.of({
            "aria-label": `${snapshot.relativePath} 工作副本内容`,
          }),
        ],
      },
      parent,
      gutter: true,
      highlightChanges: true,
      collapseUnchanged: { margin: 3, minSize: 8 },
    });

    return () => mergeView.destroy();
  });
</script>

<section
  use:focusOnMount
  class="feature-layout diff-feature"
  tabindex="-1"
  aria-label={`差异：${snapshot.relativePath}`}
>
  <div class="feature-toolbar">
    <div class="file-title">
      <span class="codicon codicon-diff" aria-hidden="true"></span>
      <div>
        <strong>{snapshot.relativePath}</strong>
        <span>BASE ↔ 工作副本 · {snapshot.language}</span>
      </div>
    </div>
    <div class="toolbar-actions">
      {#if snapshot.language !== "diff"}
        <button
          class="button button--primary"
          disabled={snapshot.binary || snapshot.truncated}
          title={snapshot.binary
            ? "二进制文件不支持文本对比"
            : snapshot.truncated
              ? "超过 5 MB 的文件不支持原生对比"
              : undefined}
          onclick={() => onAction("diff/open-in-editor")}
        >
          在编辑器中对比
        </button>
      {/if}
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-file", { relativePath: snapshot.relativePath })}
      >
        在编辑器中打开
      </button>
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "commit",
            selectedPaths: [snapshot.relativePath],
          })}
      >
        提交此文件
      </button>
    </div>
  </div>

  {#if snapshot.message}
    <div
      class="notice"
      class:notice--warning={snapshot.truncated || snapshot.binary}
      role="status"
    >
      <span class="codicon codicon-info" aria-hidden="true"></span>
      <span>{snapshot.message}</span>
    </div>
  {/if}

  {#if pierreFailed && !snapshot.binary}
    <div class="notice notice--warning" role="status">
      <span class="codicon codicon-warning" aria-hidden="true"></span>
      <span>
        {snapshot.language === "diff"
          ? diffFallbackNotices.rawPatch
          : diffFallbackNotices.mergeView}
      </span>
    </div>
  {/if}

  {#if snapshot.binary}
    <div class="empty-state empty-state--large">
      <span class="codicon codicon-file-binary" aria-hidden="true"></span>
      <strong>二进制文件无法进行文本对比</strong>
      <p>可以在编辑器中打开文件，或查看 SVN 属性与历史。</p>
    </div>
  {:else if snapshot.language === "diff"}
    {#if pierreFailed}
      <pre
        class="unified-diff"
        aria-label={`${snapshot.relativePath} 统一差异`}><code
          >{snapshot.modified}</code
        ></pre>
    {:else}
      <DiffView
        relativePath={snapshot.relativePath}
        patch={snapshot.modified}
        onFallback={handlePierreFallback}
      />
    {/if}
  {:else if pierreFailed}
    <div class="merge-view-frame" aria-label={`${snapshot.relativePath} 差异`}>
      <div class="merge-view-labels" aria-hidden="true">
        <span>BASE</span><span>工作副本</span>
      </div>
      <div class="codemirror-merge-host" bind:this={mergeHost}></div>
    </div>
  {:else}
    <DiffView
      relativePath={snapshot.relativePath}
      language={snapshot.language}
      oldContents={snapshot.original}
      newContents={snapshot.modified}
      onFallback={handlePierreFallback}
    />
  {/if}
</section>
