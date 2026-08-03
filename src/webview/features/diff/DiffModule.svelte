<script lang="ts">
  import { EditorState } from "@codemirror/state";
  import { MergeView } from "@codemirror/merge";
  import { EditorView, lineNumbers } from "@codemirror/view";
  import type {
    DiffSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: DiffSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let mergeHost = $state<HTMLDivElement>();

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

  $effect(() => {
    const parent = mergeHost;
    const original = snapshot.original;
    const modified = snapshot.modified;
    const showMergeView = !snapshot.binary && snapshot.language !== "diff";
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

<section class="feature-layout diff-feature">
  <div class="feature-toolbar">
    <div class="file-title">
      <span class="codicon codicon-diff" aria-hidden="true"></span>
      <div>
        <strong>{snapshot.relativePath}</strong>
        <span>BASE ↔ 工作副本 · {snapshot.language}</span>
      </div>
    </div>
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("open-file", { relativePath: snapshot.relativePath })}
      >
        在编辑器中打开
      </button>
      <button
        class="button button--primary"
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

  {#if snapshot.binary}
    <div class="empty-state empty-state--large">
      <span class="codicon codicon-file-binary" aria-hidden="true"></span>
      <strong>二进制文件无法进行文本对比</strong>
      <p>可以在编辑器中打开文件，或查看 SVN 属性与历史。</p>
    </div>
  {:else if snapshot.language === "diff"}
    <pre
      class="unified-diff"
      aria-label={`${snapshot.relativePath} 统一差异`}><code
        >{snapshot.modified}</code
      ></pre>
  {:else}
    <div class="merge-view-frame" aria-label={`${snapshot.relativePath} 差异`}>
      <div class="merge-view-labels" aria-hidden="true">
        <span>BASE</span><span>工作副本</span>
      </div>
      <div class="codemirror-merge-host" bind:this={mergeHost}></div>
    </div>
  {/if}
</section>
