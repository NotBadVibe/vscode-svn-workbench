<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../../components/ui/ScrollArea.svelte";
  import {
    releaseNotesIntegrityLabel,
    releaseNotesOmittedLabel,
  } from "../../../i18n/terminology";

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

  const notes = $derived(snapshot.advanced.releaseNotes);
  const complete = $derived(notes?.complete ?? true);
  const revisionsRead = $derived(notes?.revisionsRead ?? notes?.count ?? 0);
  const omitted = $derived(notes?.omittedPathCount ?? 0);
  const isPartial = $derived(complete === false);
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">修订摘要</span>
      <h2>生成发布说明</h2>
    </div>
    <span class="status-badge">本地生成</span>
  </div>
  <p class="task-hint">
    按修订范围只读分页采集（端点包含）；结束可用 HEAD（请求开始固定为
    rN），反向范围自动归一化。
  </p>
  <div class="revision-range">
    <label class="field"
      ><span>起始修订</span><input
        inputmode="numeric"
        bind:value={fromRevision}
        placeholder="1"
      /></label
    ><label class="field"
      ><span>结束修订</span><input
        inputmode="text"
        bind:value={toRevision}
        placeholder="HEAD"
      /></label
    >
  </div>
  <div class="toolbar-actions">
    <button
      class="button button--primary"
      onclick={() =>
        onAction("repository/generate-release-notes", {
          fromRevision,
          toRevision,
        })}>从 SVN 历史生成</button
    >
    {#if isPartial}
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("repository/generate-release-notes", {
            fromRevision: notes?.requestedFrom ?? fromRevision,
            toRevision: notes?.requestedTo ?? toRevision,
          })}>用相同范围重新生成（续查）</button
      >
    {/if}
  </div>
  {#if notes}
    <div class="release-notes-preview">
      <div class="release-notes-meta">
        <strong>{notes.count} 条修订</strong>
        <span
          class={isPartial
            ? "status-badge status-badge--warning"
            : "status-badge"}
          >{releaseNotesIntegrityLabel(revisionsRead, notes.complete)}</span
        >
        {#if omitted > 0}
          <span class="status-badge">{releaseNotesOmittedLabel(omitted)}</span>
        {/if}
        {#if notes.resolvedHeadRevision}
          <span class="task-hint"
            >结束 HEAD 已固定为 r{notes.resolvedHeadRevision}</span
          >
        {/if}
        {#if notes.rangeNote}
          <span class="task-hint">{notes.rangeNote}</span>
        {/if}
        {#if notes.partialReason}
          <span class="task-hint">部分原因：{notes.partialReason}</span>
        {/if}
      </div>
      <div class="toolbar-actions">
        <button
          class="icon-button"
          aria-label="复制发布说明摘要"
          title="复制摘要（含省略提示）"
          onclick={() =>
            onAction("copy-text", {
              text: notes?.markdown,
            })}
          ><span class="codicon codicon-copy" aria-hidden="true"></span></button
        >
        {#if notes.fullMarkdown}
          <button
            class="button button--secondary"
            onclick={() =>
              onAction("copy-text", {
                text: notes?.fullMarkdown,
              })}>复制完整版</button
          >
          <button
            class="button button--secondary"
            onclick={() => onAction("repository/export-release-notes")}
            >导出完整版</button
          >
        {/if}
      </div>
      <ScrollArea label="发布说明内容"><pre>{notes.markdown}</pre></ScrollArea>
    </div>
  {/if}
</section>
