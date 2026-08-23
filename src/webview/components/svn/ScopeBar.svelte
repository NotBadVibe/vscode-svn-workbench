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
    onCopyText,
  }: {
    scope?: WorkbenchScopeView;
    taskId: WorkbenchTaskId;
    onRefresh: () => void;
    onSwitchProject?: () => void;
    /** v0.0.18 批次 E：复制文本出口（经 Host 剪贴板）。 */
    onCopyText?: (text: string) => void;
  } = $props();

  /*
   * v0.0.18 批次 E（U-07 收尾）：范围栏快捷事实——候选数、工作副本
   * revision、入口来源；范围清单可展开逐条复制，长路径键盘可达
   * （不依赖悬停 title）。
   */
  const sourceLabels: Record<WorkbenchScopeView["source"], string> = {
    explorer: "资源管理器右键",
    editor: "编辑器",
    scm: "源代码管理",
    commandPalette: "命令面板",
    internal: "内部跳转",
  };

  let rootsExpanded = $state(false);
  let rootsTriggerEl = $state<HTMLElement | null>(null);

  const rootsSummary = $derived(
    scope
      ? scope.roots.length === 1
        ? scope.roots[0].relativePath
        : `${scope.roots.length} 个操作范围`
      : "",
  );

  function toggleRoots(event: Event): void {
    rootsTriggerEl = event.currentTarget as HTMLElement;
    rootsExpanded = !rootsExpanded;
  }

  function copyRootPath(relativePath: string): void {
    if (relativePath === "." || relativePath === "") {
      onCopyText?.(scope?.repositoryName ?? relativePath);
      return;
    }
    onCopyText?.(relativePath);
  }

  function handleRootsKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && rootsExpanded) {
      rootsExpanded = false;
      rootsTriggerEl?.focus();
    }
  }
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
      <div class="scope-facts" aria-label="范围快捷事实">
        {#if scope.candidateCount !== undefined}
          <span class="scope-fact"
            ><span class="codicon codicon-files" aria-hidden="true"></span>
            {scope.candidateCount} 个候选</span
          >
        {/if}
        {#if scope.workingCopyRevision}
          <span class="scope-fact"
            ><span class="codicon codicon-git-commit" aria-hidden="true"></span>
            r{scope.workingCopyRevision}</span
          >
        {/if}
        <span class="scope-fact"
          ><span class="codicon codicon-link" aria-hidden="true"></span>
          入口：{sourceLabels[scope.source]}</span
        >
      </div>
      <button
        class="scope-chip"
        aria-expanded={rootsExpanded}
        aria-controls="scope-roots-list"
        onclick={toggleRoots}
        onkeydown={handleRootsKeydown}
      >
        <span class="codicon codicon-target" aria-hidden="true"></span>
        <span>{rootsSummary}</span>
        <span
          class="codicon codicon-{rootsExpanded
            ? 'chevron-up'
            : 'chevron-down'}"
          aria-hidden="true"
        ></span>
      </button>
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
{#if scope && rootsExpanded}
  <div
    id="scope-roots-list"
    class="scope-roots"
    role="region"
    aria-label="操作范围清单"
  >
    {#each scope.roots as root, index (index)}
      <div class="scope-roots__row">
        <span class="scope-roots__kind"
          >{root.kind === "folder" ? "目录" : "文件"}</span
        >
        <span class="scope-roots__path">{root.relativePath}</span>
        <button
          class="icon-button icon-button--small"
          aria-label={`复制范围路径 ${root.relativePath}`}
          onclick={() => copyRootPath(root.relativePath)}
          ><span class="codicon codicon-copy" aria-hidden="true"></span></button
        >
      </div>
    {/each}
    {#if onCopyText && scope.roots.length > 1}
      <button
        class="button button--secondary button--small"
        onclick={() =>
          onCopyText(scope.roots.map((root) => root.relativePath).join("\n"))}
        >复制全部范围路径</button
      >
    {/if}
  </div>
{/if}
