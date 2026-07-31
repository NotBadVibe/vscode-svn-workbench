<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { defaultWorkbenchTask, type WorkbenchModuleId, type WorkbenchTaskId } from '@protocol/workbenchProtocol';
  import type { WorkbenchState } from '../../app/workbenchState.svelte';
  import ScopeBar from '../svn/ScopeBar.svelte';

  let { state: workbenchState, children }: { state: WorkbenchState; children: Snippet } = $props();

  const navigation: Array<{ id: WorkbenchModuleId; taskId: WorkbenchTaskId; label: string; icon: string }> = [
    { id: 'changes', taskId: defaultWorkbenchTask('changes'), label: '本地修改', icon: 'source-control' },
    { id: 'commit', taskId: defaultWorkbenchTask('commit'), label: '提交', icon: 'checklist' },
    { id: 'history', taskId: defaultWorkbenchTask('history'), label: '历史', icon: 'history' },
    { id: 'conflicts', taskId: defaultWorkbenchTask('conflicts'), label: '冲突', icon: 'merge' },
    { id: 'changelists', taskId: defaultWorkbenchTask('changelists'), label: '变更集', icon: 'list-tree' },
    { id: 'ai-review', taskId: defaultWorkbenchTask('ai-review'), label: 'AI 审查', icon: 'sparkle' },
    { id: 'impact', taskId: defaultWorkbenchTask('impact'), label: '影响分析', icon: 'pulse' },
    { id: 'agent', taskId: defaultWorkbenchTask('agent'), label: '任务代理', icon: 'hubot' },
    { id: 'repository', taskId: defaultWorkbenchTask('repository'), label: '仓库操作', icon: 'repo' },
    { id: 'settings', taskId: defaultWorkbenchTask('settings'), label: '设置', icon: 'settings-gear' }
  ];
  let now = $state(Date.now());
  const elapsedSeconds = $derived(workbenchState.progress ? Math.max(0, Math.floor((now - workbenchState.progress.startedAt) / 1000)) : 0);

  onMount(() => {
    const timer = window.setInterval(() => now = Date.now(), 1000);
    return () => window.clearInterval(timer);
  });
</script>

<div class="workbench-shell">
  <aside class="rail" aria-label="SVN 工作台模块">
    <div class="brand" title="SVN 工作台">
      <span class="brand-mark">S</span>
    </div>
    <nav>
      {#each navigation as item (item.id)}
        <button
          class:active={workbenchState.moduleId === item.id}
          class="rail-button"
          aria-label={item.label}
          aria-current={workbenchState.moduleId === item.id ? 'page' : undefined}
          title={item.label}
          onclick={() => workbenchState.openModule(item.id, item.taskId)}
        >
          <span class={`codicon codicon-${item.icon}`} aria-hidden="true"></span>
        </button>
      {/each}
    </nav>
    <div class="rail-spacer"></div>
    <button
      class:active={workbenchState.moduleId === 'diagnostics'}
      class="rail-button"
      aria-label="诊断"
      title="诊断"
      onclick={() => workbenchState.openModule('diagnostics', defaultWorkbenchTask('diagnostics'))}
    >
      <span class="codicon codicon-pulse" aria-hidden="true"></span>
    </button>
  </aside>

  <main class="workbench-main">
    <ScopeBar scope={workbenchState.scope} taskId={workbenchState.taskId} onRefresh={() => workbenchState.action('refresh')} />
    {#if workbenchState.progress}
      <div class="progress-strip" role="status" aria-live="polite">
        <span class="loading-ring loading-ring--small" aria-hidden="true"></span>
        <div class="progress-strip__content"><strong>{workbenchState.progress.title}</strong><span>阶段：{workbenchState.progress.stage ?? workbenchState.progress.message ?? '执行 SVN 命令'}</span><span>范围：{workbenchState.progress.scope ?? workbenchState.scope?.roots.map((root) => root.relativePath).join('、') ?? '当前范围'}</span><span>已用时：{elapsedSeconds} 秒</span></div>
        {#if workbenchState.progress.outputAvailable}<button class="button button--secondary" onclick={() => workbenchState.action('diagnostics/show-output')}>查看输出</button>{/if}
        {#if workbenchState.progress.cancellable}<button class="button button--secondary" onclick={() => workbenchState.action('operation/cancel')}>取消</button>{/if}
      </div>
    {/if}
    {#if workbenchState.notification}
      <div class={`result-strip result-strip--${workbenchState.notification.tone}`} role="status"><span class={`codicon codicon-${workbenchState.notification.tone === 'success' ? 'pass-filled' : 'warning'}`} aria-hidden="true"></span><strong>{workbenchState.notification.title}</strong><span>{workbenchState.notification.message}</span></div>
    {/if}
    <div class="workbench-content">
      {@render children()}
    </div>
  </main>
</div>
