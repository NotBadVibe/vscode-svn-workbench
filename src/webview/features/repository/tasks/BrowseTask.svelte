<script lang="ts">
  import type { RepositorySnapshot, WebviewAction } from '@protocol/workbenchProtocol';
  import ScrollArea from '../../../components/ui/ScrollArea.svelte';

  let { snapshot, onAction }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let browserUrl = $state('');
  let initializedRepository = $state('');

  $effect(() => {
    const identity = snapshot.info.url ?? snapshot.info.repositoryRoot ?? snapshot.info.name;
    if (identity !== initializedRepository) {
      initializedRepository = identity;
      browserUrl = snapshot.info.url ?? snapshot.info.repositoryRoot ?? '';
    }
  });

  function openBrowser(url = browserUrl): void {
    browserUrl = url;
    onAction('repository/browse', { url });
  }

  function childUrl(name: string): string {
    return `${(snapshot.advanced.browser?.url ?? browserUrl).replace(/\/+$/, '')}/${encodeURIComponent(name)}`;
  }
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading"><div><span class="eyebrow">只读浏览</span><h2>仓库浏览器</h2></div><span class="status-badge">只读</span></div>
  <div class="repository-browser-toolbar"><label class="field"><span>仓库 URL</span><input bind:value={browserUrl} placeholder="https://…/trunk" /></label><button class="button button--secondary" disabled={!browserUrl} onclick={() => openBrowser()}>打开 URL</button><button class="button button--secondary" onclick={() => openBrowser(snapshot.info.url ?? '')}>返回当前路径</button></div>
  {#if snapshot.advanced.browser}
    <div class="browser-location"><button class="icon-button" aria-label="打开上级目录" disabled={!snapshot.advanced.browser.parentUrl} onclick={() => snapshot.advanced.browser?.parentUrl && openBrowser(snapshot.advanced.browser.parentUrl)}><span class="codicon codicon-arrow-up" aria-hidden="true"></span></button><code>{snapshot.advanced.browser.url}</code><button class="icon-button" aria-label="复制当前浏览 URL" onclick={() => onAction('copy-text', { text: snapshot.advanced.browser?.url })}><span class="codicon codicon-copy" aria-hidden="true"></span></button></div>
    {#if snapshot.advanced.browser.error}<div class="notice notice--error">{snapshot.advanced.browser.error}</div>{/if}
    <ScrollArea class="repository-browser-list" label="仓库目录内容">{#if snapshot.advanced.browser.entries.length === 0 && !snapshot.advanced.browser.error}<div class="mini-empty">这个仓库目录为空。</div>{/if}{#each snapshot.advanced.browser.entries as entry (entry.name)}<button onclick={() => entry.kind === 'dir' ? openBrowser(childUrl(entry.name)) : onAction('copy-text', { text: childUrl(entry.name) })}><span class={`codicon codicon-${entry.kind === 'dir' ? 'folder' : 'file'}`} aria-hidden="true"></span><strong>{entry.name}</strong><small>r{entry.revision ?? '?'} · {entry.author ?? '未知'}</small><span>{entry.kind === 'dir' ? '打开' : '复制 URL'}</span></button>{/each}</ScrollArea>
  {:else}<div class="preview-empty preview-empty--compact"><span class="codicon codicon-repo" aria-hidden="true"></span><p>按需浏览仓库端目录，不读取文件正文。</p></div>{/if}
</section>
