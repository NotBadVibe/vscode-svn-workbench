<script lang="ts">
  import type {
    WorkbenchScopeView,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import { taskLabels } from "../../i18n/terminology";

  let {
    scope,
    taskId,
    onRefresh,
    onSwitchProject,
  }: {
    scope?: WorkbenchScopeView;
    taskId: WorkbenchTaskId;
    onRefresh: () => void;
    onSwitchProject?: () => void;
  } = $props();
</script>

<header class="scope-bar">
  <div class="scope-heading">
    <div class="eyebrow">
      {scope?.projectName ?? scope?.repositoryName ?? "SVN 工作台"}
    </div>
    <h1>{taskLabels[taskId]}</h1>
    {#if scope?.projectName}
      <div class="scope-context">
        {#if scope.projectName !== scope.repositoryName}
          <span>工作副本：{scope.repositoryName}</span>
        {/if}
        {#if scope.projectRootIsFallback}
          <span class="scope-context-hint"
            >尚未设置项目根，当前按工作副本根显示</span
          >
        {/if}
      </div>
    {/if}
  </div>
  <div class="scope-actions">
    {#if scope}
      <div
        class="scope-chip"
        title={scope.roots.map((root) => root.relativePath).join(", ")}
      >
        <span class="codicon codicon-target" aria-hidden="true"></span>
        <span
          >{scope.roots.length === 1
            ? scope.roots[0].relativePath
            : `${scope.roots.length} 个操作范围`}</span
        >
      </div>
    {/if}
    <button
      class="icon-button"
      aria-label="刷新当前模块"
      title="刷新"
      onclick={onRefresh}
    >
      <span class="codicon codicon-refresh" aria-hidden="true"></span>
    </button>
    {#if onSwitchProject}
      <button
        class="icon-button"
        aria-label="切换项目"
        title="切换项目或查看项目总览"
        onclick={onSwitchProject}
      >
        <span class="codicon codicon-project" aria-hidden="true"></span>
      </button>
    {/if}
  </div>
</header>
