<script lang="ts">
  import type { Component } from 'svelte';
  import type { RepositorySnapshot, WebviewAction, WorkbenchTaskId } from '@protocol/workbenchProtocol';
  import ScrollArea from '../../components/ui/ScrollArea.svelte';
  import { taskLabels } from '../../i18n/terminology';

  type RepositoryTaskId = Extract<WorkbenchTaskId, `repository/${string}`>;
  type TaskModule = { default: Component<{ snapshot: RepositorySnapshot; taskId: WorkbenchTaskId; onAction: (action: WebviewAction, data?: Record<string, unknown>) => void }> };

  let {
    snapshot,
    taskId = 'repository/update',
    onAction
  }: {
    snapshot: RepositorySnapshot;
    taskId: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  const taskNavigation: Array<{ id: RepositoryTaskId; label: string }> = [
    { id: 'repository/update', label: '更新' },
    { id: 'repository/recovery', label: '清理与恢复' },
    { id: 'repository/browse', label: '浏览仓库' },
    { id: 'repository/properties', label: 'SVN 属性' },
    { id: 'repository/branch', label: '创建分支' },
    { id: 'repository/tag', label: '创建标签' },
    { id: 'repository/switch', label: '切换' },
    { id: 'repository/relocate', label: '重定位' },
    { id: 'repository/merge', label: '合并' },
    { id: 'repository/patch-shelf', label: '补丁与搁置' },
    { id: 'repository/release-notes', label: '发布说明' }
  ];

  const taskLoaders: Record<RepositoryTaskId, () => Promise<TaskModule>> = {
    'repository/update': () => import('./tasks/UpdateTask.svelte') as Promise<TaskModule>,
    'repository/recovery': () => import('./tasks/RecoveryTask.svelte') as Promise<TaskModule>,
    'repository/browse': () => import('./tasks/BrowseTask.svelte') as Promise<TaskModule>,
    'repository/properties': () => import('./tasks/PropertiesTask.svelte') as Promise<TaskModule>,
    'repository/branch': () => import('./tasks/AdvancedTask.svelte') as Promise<TaskModule>,
    'repository/tag': () => import('./tasks/AdvancedTask.svelte') as Promise<TaskModule>,
    'repository/switch': () => import('./tasks/AdvancedTask.svelte') as Promise<TaskModule>,
    'repository/relocate': () => import('./tasks/AdvancedTask.svelte') as Promise<TaskModule>,
    'repository/merge': () => import('./tasks/AdvancedTask.svelte') as Promise<TaskModule>,
    'repository/patch-shelf': () => import('./tasks/PatchShelfTask.svelte') as Promise<TaskModule>,
    'repository/release-notes': () => import('./tasks/ReleaseNotesTask.svelte') as Promise<TaskModule>
  };

  const previewOperationLabels: Record<NonNullable<RepositorySnapshot['advanced']['preview']>['operation'], string> = {
    branch: '创建分支',
    tag: '创建标签',
    switch: '切换工作副本',
    relocate: '重定位仓库地址',
    merge: '合并到工作副本',
    'apply-patch': '应用补丁',
    shelf: '创建本地搁置'
  };

  const currentTask = $derived((taskId.startsWith('repository/') ? taskId : 'repository/update') as RepositoryTaskId);
  const currentTaskLoader = $derived(taskLoaders[currentTask]);
  const showsAdvancedPreview = $derived(['repository/branch', 'repository/tag', 'repository/switch', 'repository/relocate', 'repository/merge', 'repository/patch-shelf'].includes(currentTask));

  let advancedConfirmed = $state(false);
  let previewToken = $state<string | undefined>();

  $effect(() => {
    const token = snapshot.advanced.preview?.token;
    if (token !== previewToken) {
      previewToken = token;
      advancedConfirmed = false;
    }
  });

  function openTask(next: RepositoryTaskId): void {
    onAction('open-module', { moduleId: 'repository', taskId: next });
  }
</script>

<section class="repository-page" data-repository-task={currentTask}>
  <header class="page-heading">
    <div><span class="eyebrow">当前仓库任务</span><h1>{taskLabels[currentTask]}</h1><p>当前页面只显示这项任务；任何写操作都先生成精确预览，再由你确认。</p></div>
  </header>

  <ScrollArea class="repository-task-navigation" label="仓库任务导航">
    {#each taskNavigation as item (item.id)}
      <button class:active={currentTask === item.id} aria-current={currentTask === item.id ? 'page' : undefined} onclick={() => openTask(item.id)}>{item.label}</button>
    {/each}
  </ScrollArea>

  <div class="repository-hero">
    <div class="repo-mark"><span class="codicon codicon-repo" aria-hidden="true"></span></div>
    <div><strong>{snapshot.info.name}</strong><span title={snapshot.info.url}>{snapshot.info.url ?? '未读取到仓库 URL'}</span></div>
    <div class="repo-facts"><span>工作副本 r{snapshot.info.revision ?? '?'}</span><button class="icon-button" aria-label="复制仓库 URL" disabled={!snapshot.info.url} onclick={() => onAction('copy-text', { text: snapshot.info.url })}><span class="codicon codicon-copy" aria-hidden="true"></span></button></div>
  </div>

  {#if snapshot.recovery && currentTask !== 'repository/recovery'}
    <div class="notice notice--warning recovery-shortcut"><span class="codicon codicon-tools" aria-hidden="true"></span><span><strong>{snapshot.recovery.title}</strong>，此前写操作预览已经失效。</span><button class="button button--secondary" onclick={() => openTask('repository/recovery')}>进入清理与恢复</button></div>
  {/if}

  {#await currentTaskLoader()}
    <div class="module-loading" role="status"><span class="codicon codicon-loading codicon-modifier-spin" aria-hidden="true"></span><span>正在加载仓库任务…</span></div>
  {:then taskModule}
    {@const Task = taskModule.default}
    <Task {snapshot} {taskId} {onAction} />
  {:catch}
    <div class="notice notice--error" role="alert">仓库任务加载失败。请重新打开此任务；如果问题持续存在，请运行环境诊断。</div>
  {/await}

  {#if snapshot.advanced.feedback}<div class="notice notice--success" role="status">{snapshot.advanced.feedback}</div>{/if}

  {#if snapshot.advanced.preview && showsAdvancedPreview}
    <section class={`advanced-preview ${snapshot.advanced.preview.destructive ? 'advanced-preview--destructive' : ''}`} aria-labelledby="advanced-preview-title">
      <div class="section-heading"><div><span class="eyebrow">已签名操作预览</span><h2 id="advanced-preview-title">{snapshot.advanced.preview.title}</h2></div><span class="status-badge">{previewOperationLabels[snapshot.advanced.preview.operation]}</span></div>
      <div class="advanced-preview-grid"><div><strong>命令</strong>{#each snapshot.advanced.preview.commands as command}<code>{command}</code>{/each}</div><div><strong>影响</strong><ul>{#each snapshot.advanced.preview.details as detail}<li>{detail}</li>{/each}</ul></div></div>
      {#each snapshot.advanced.preview.issues as issue}<div class="notice notice--error">{issue}</div>{/each}
      {#if snapshot.advanced.preview.destructive}<label class="destructive-confirm"><input type="checkbox" bind:checked={advancedConfirmed} /><span>我已核对命令、目标和影响；理解该操作会修改工作副本或其绑定地址。</span></label>{/if}
      <button class="button button--primary" disabled={!snapshot.advanced.preview.canExecute || (snapshot.advanced.preview.destructive && !advancedConfirmed)} onclick={() => onAction('repository/execute-advanced', { previewToken: snapshot.advanced.preview?.token })}>确认执行{previewOperationLabels[snapshot.advanced.preview.operation]}</button>
    </section>
  {/if}
</section>
