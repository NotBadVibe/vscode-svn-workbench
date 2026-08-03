<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let fromRevision = $state("");
  let toRevision = $state("");
  let initializedRepository = $state("");

  $effect(() => {
    const identity =
      snapshot.info.url ?? snapshot.info.repositoryRoot ?? snapshot.info.name;
    if (identity !== initializedRepository) {
      initializedRepository = identity;
      toRevision = snapshot.info.revision ?? "";
    }
  });
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">修订摘要</span>
      <h2>生成发布说明</h2>
    </div>
    <span class="status-badge">本地生成</span>
  </div>
  <div class="revision-range">
    <label class="field"
      ><span>起始修订</span><input
        inputmode="numeric"
        bind:value={fromRevision}
        placeholder="1"
      /></label
    ><label class="field"
      ><span>结束修订</span><input
        inputmode="numeric"
        bind:value={toRevision}
        placeholder="HEAD"
      /></label
    >
  </div>
  <button
    class="button button--primary"
    onclick={() =>
      onAction("repository/generate-release-notes", {
        fromRevision,
        toRevision,
      })}>从 SVN 历史生成</button
  >
  {#if snapshot.advanced.releaseNotes}<div class="release-notes-preview">
      <div>
        <strong>{snapshot.advanced.releaseNotes.count} 条修订</strong><button
          class="icon-button"
          aria-label="复制发布说明"
          onclick={() =>
            onAction("copy-text", {
              text: snapshot.advanced.releaseNotes?.markdown,
            })}
          ><span class="codicon codicon-copy" aria-hidden="true"></span></button
        >
      </div>
      <ScrollArea label="发布说明内容"
        ><pre>{snapshot.advanced.releaseNotes.markdown}</pre></ScrollArea
      >
    </div>{/if}
</section>
