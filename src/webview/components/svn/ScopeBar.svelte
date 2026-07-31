<script lang="ts">
  import type { WorkbenchScopeView, WorkbenchTaskId } from '@protocol/workbenchProtocol';
  import { taskLabels } from '../../i18n/terminology';

  let {
    scope,
    taskId,
    onRefresh
  }: {
    scope?: WorkbenchScopeView;
    taskId: WorkbenchTaskId;
    onRefresh: () => void;
  } = $props();

</script>

<header class="scope-bar">
  <div class="scope-heading">
    <div class="eyebrow">{scope?.repositoryName ?? 'SVN 工作台'}</div>
    <h1>{taskLabels[taskId]}</h1>
  </div>
  <div class="scope-actions">
    {#if scope}
      <div class="scope-chip" title={scope.roots.map((root) => root.relativePath).join(', ')}>
        <span class="codicon codicon-target" aria-hidden="true"></span>
        <span>{scope.roots.length === 1 ? scope.roots[0].relativePath : `${scope.roots.length} 个操作范围`}</span>
      </div>
    {/if}
    <button class="icon-button" aria-label="刷新当前模块" title="刷新" onclick={onRefresh}>
      <span class="codicon codicon-refresh" aria-hidden="true"></span>
    </button>
  </div>
</header>
