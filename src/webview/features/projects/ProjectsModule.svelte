<script lang="ts">
  import type {
    ProjectOverviewItem,
    ProjectsSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import { formatZhTime } from "../../i18n/formatters";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";

  /*
   * v0.0.7 项目总览（§6.1）：只读优先。数量只是聚合统计；行内动作始终
   * 携带明确项目目标，不会把多个项目合成一个操作范围。
   */

  let {
    snapshot,
    onAction,
  }: {
    snapshot: ProjectsSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  function openTask(project: ProjectOverviewItem, task: string): void {
    onAction("projects/open-task", {
      projectRoot: project.absolutePath,
      task,
    });
  }

  function isSvnProject(project: ProjectOverviewItem): boolean {
    return project.binding !== "notSvn" && project.binding !== "missing";
  }
</script>

<section
  class="module-card projects-module"
  aria-label="项目总览"
  use:focusOnMount
  tabindex="-1"
>
  <div class="module-card-header">
    <div>
      <h2>工作区项目</h2>
      <p class="module-card-subtitle">
        {snapshot.projects.length} 个项目 · 更新于 {formatZhTime(
          snapshot.generatedAt,
        )}
      </p>
    </div>
  </div>

  {#if snapshot.projects.length === 0}
    <div class="empty-state">
      <span class="codicon codicon-project" aria-hidden="true"></span>
      <strong>没有打开的工作区项目</strong>
      <p>在 VS Code 中打开包含 SVN 工作副本的文件夹后，这里会列出项目。</p>
    </div>
  {:else}
    <ScrollArea class="projects-list" role="list" label="工作区项目列表">
      {#each snapshot.projects as project (project.absolutePath)}
        <div class="project-row" role="listitem">
          <div class="project-row__main">
            <div class="project-row__title">
              <span class="codicon codicon-project" aria-hidden="true"></span>
              <strong>{project.name}</strong>
              {#if project.current}
                <span class="project-badge">当前项目</span>
              {/if}
              <span class={`binding-badge binding-badge--${project.binding}`}
                >{project.bindingLabel}</span
              >
            </div>
            <div class="project-row__meta" title={project.absolutePath}>
              <span>{project.absolutePath}</span>
              {#if project.workingCopyRoot}
                <span>工作副本：{project.workingCopyRoot}</span>
              {/if}
            </div>
            {#if !project.exists}
              <div class="project-row__warning" role="note">
                路径不可用，请确认项目目录是否被移动或删除。
              </div>
            {:else if !isSvnProject(project)}
              <div class="project-row__warning" role="note">
                非 SVN 目录，不能执行 SVN 任务；请先检出（Checkout）。
              </div>
            {/if}
          </div>
          {#if project.counts}
            <div
              class="project-row__counts"
              aria-label={`变更 ${project.counts.changes}，冲突 ${project.counts.conflicts}，未版本化 ${project.counts.unversioned}`}
            >
              <span class="count-chip">变更 {project.counts.changes}</span>
              <span
                class="count-chip"
                class:count-chip--warning={project.counts.conflicts > 0}
                >冲突 {project.counts.conflicts}</span
              >
              <span class="count-chip"
                >未版本化 {project.counts.unversioned}</span
              >
            </div>
          {/if}
          <div class="project-row__actions">
            <button
              class="button button--secondary"
              disabled={!isSvnProject(project)}
              onclick={() => openTask(project, "changes")}>打开变更</button
            >
            <button
              class="button button--secondary"
              disabled={!isSvnProject(project)}
              onclick={() => openTask(project, "commit")}>提交</button
            >
            <button
              class="button button--secondary"
              disabled={!isSvnProject(project)}
              onclick={() => openTask(project, "update")}>更新</button
            >
          </div>
        </div>
      {/each}
    </ScrollArea>
  {/if}
</section>
