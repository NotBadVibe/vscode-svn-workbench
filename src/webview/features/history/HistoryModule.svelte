<script lang="ts">
  import type { HistorySnapshot, WebviewAction } from '@protocol/workbenchProtocol';
  import ScrollArea from '../../components/ui/ScrollArea.svelte';
  import { formatZhDateTime } from '../../i18n/formatters';

  let {
    snapshot,
    onAction
  }: {
    snapshot: HistorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let query = $state('');
  let compare = $state(new Set<string>());

  $effect(() => {
    compare = new Set(snapshot.compareRevisions);
  });

  const visible = $derived(snapshot.revisions.filter((item) => {
    const value = query.trim().toLowerCase();
    return !value || item.message.toLowerCase().includes(value) || item.author.toLowerCase().includes(value) || item.revision.includes(value);
  }));
  const selected = $derived(snapshot.revisions.find((item) => item.revision === snapshot.selectedRevision) ?? snapshot.revisions[0]);

  function toggleCompare(revision: string): void {
    const next = new Set(compare);
    if (next.has(revision)) {
      next.delete(revision);
    } else {
      if (next.size >= 2) {
        next.delete([...next][0]);
      }
      next.add(revision);
    }
    compare = next;
  }
</script>

<section class="history-layout">
  <div class="history-list-pane">
    <div class="feature-toolbar feature-toolbar--compact">
      <div>
        <h2>修订历史</h2>
        <p>最近 {snapshot.revisions.length} 条修订</p>
      </div>
      <div class="search-field search-field--compact">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <input bind:value={query} aria-label="筛选历史" placeholder="作者、说明、修订号…" />
      </div>
    </div>
    <div class="history-compare-bar">
      <span>已选择 {compare.size}/2 条修订</span>
      <button class="button button--secondary" disabled={compare.size !== 2} onclick={() => onAction('history/compare', { revisions: [...compare] })}>比较修订</button>
    </div>
    <ScrollArea class="revision-list" role="list" label="SVN 修订列表">
      {#each visible as revision (revision.revision)}
        <div class:active={selected?.revision === revision.revision} class="revision-row" role="listitem">
          <button
            class="revision-select"
            aria-label={`查看修订 ${revision.revision}`}
            onclick={() => onAction('history/select', { revision: revision.revision, compareRevisions: [...compare] })}
          >
            <span class="revision-dot" aria-hidden="true"></span>
            <span class="revision-content">
              <strong>r{revision.revision} · {revision.author}</strong>
              <span>{revision.message || '无提交说明'}</span>
              <small>{formatZhDateTime(revision.date)}</small>
            </span>
          </button>
          <input
            type="checkbox"
            aria-label={`选择修订 ${revision.revision} 进行比较`}
            checked={compare.has(revision.revision)}
            onchange={() => toggleCompare(revision.revision)}
          />
        </div>
      {/each}
    </ScrollArea>
  </div>
  <ScrollArea class="revision-detail" label="修订详情">
    {#if selected}
      <div class="revision-detail-header">
        <div><span class="eyebrow">修订详情</span><h2>r{selected.revision}</h2></div>
        <div class="toolbar-actions">
          {#if snapshot.fileActionsAvailable}<button class="button button--secondary" onclick={() => onAction('history/blame')}>查看逐行责任</button><button class="button button--secondary" onclick={() => onAction('history/preview-restore', { revision: selected.revision })}>从此修订恢复</button>{/if}
          <span class="status-badge">{selected.author}</span>
        </div>
      </div>
      {#if snapshot.feedback}<div class="notice notice--success" role="status">{snapshot.feedback}</div>{/if}
      <p class="revision-message">{selected.message || '无提交说明'}</p>
      <div class="detail-meta"><span>{formatZhDateTime(selected.date)}</span><span>{selected.changedPaths.length} 条变更路径</span></div>
      <h3>变更路径</h3>
      <ScrollArea class="changed-paths" label="当前修订的变更路径">
        {#each selected.changedPaths as item (`${item.action}:${item.path}`)}
          <div class="changed-path-row">
            <span class={`change-action change-action--${item.action.toLowerCase()}`}>{item.action}</span>
            <span title={item.path}>{item.path}</span>
            {#if item.copyFromPath}<small>来自 {item.copyFromPath}@{item.copyFromRevision}</small>{/if}
          </div>
        {/each}
      </ScrollArea>
      {#if snapshot.blame}
        <h3>逐行责任</h3>
        <ScrollArea class="blame-view" label="文件逐行责任">
          {#each snapshot.blame as line (line.line)}<div><span>{line.line}</span><span>r{line.revision}</span><span>{line.author}</span><code>{line.content}</code></div>{/each}
        </ScrollArea>
      {/if}
      {#if snapshot.restorePreview}
        <div class="restore-preview scroll-region" role="dialog" aria-label="修订恢复预览" tabindex="0" data-scroll-region>
          <div class="section-heading"><div><span class="eyebrow">危险操作预览</span><h2>恢复 {snapshot.restorePreview.relativePath}</h2></div><span class="status-badge">r{snapshot.restorePreview.revision}</span></div>
          <div class="notice notice--warning">将用所选修订覆盖工作副本文件，但不会自动提交。现有未提交内容会丢失。</div>
          <code>{snapshot.restorePreview.command}</code>
          {#each snapshot.restorePreview.issues as issue}<div class="notice notice--error">{issue}</div>{/each}
          <button class="button button--primary commit-button" disabled={!snapshot.restorePreview.canExecute} onclick={() => onAction('history/execute-restore', { previewToken: snapshot.restorePreview?.token })}>确认覆盖工作副本文件</button>
        </div>
      {/if}
    {:else}
      <div class="empty-state empty-state--large"><span class="codicon codicon-history"></span><div><strong>暂无历史</strong><p>当前范围没有可显示的修订记录。</p></div></div>
    {/if}
  </ScrollArea>
</section>
