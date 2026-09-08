<script lang="ts">
  import type {
    ProjectOverviewItem,
    ProjectsSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import SearchInput from "../../components/list/SearchInput.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import { formatZhTime } from "../../i18n/formatters";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import {
    loadListPreferences,
    saveListPreferences,
  } from "../../app/listPreferences";

  /*
   * v0.0.7 项目总览（§6.1）：只读优先。数量只是聚合统计；行内动作始终
   * 携带明确项目目标，不会把多个项目合成一个操作范围。
   * V024-R39：统计状态显式建模——ready（含全 0 的干净态）/error（无 counts，
   * 绝不当作 0）/stale（上一成功值 + 过期原因 + 成功时间）；Host 快照不下发
   * loading，本地重试等待态由 retrying 表达；statsSeq 保证旧快照晚到不覆盖新状态。
   * V024-R40：名称/路径搜索、只看有修改、冲突优先/名称排序（偏好按模块记忆）、
   * 当前项目标识、冲突数直达该项目冲突任务、完整路径查看复制。
   * V024-R42：空/非 SVN/路径丢失/统计失败各态均有可执行的下一步（只复用既有
   * 安全动作白名单；检出向导不在本版范围，按钮不命名为已具备检出功能）。
   */

  let {
    snapshot,
    onAction,
  }: {
    snapshot: ProjectsSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  type SortMode = "conflicts" | "name";

  const savedSort = loadListPreferences("projects").customSortField;
  let query = $state("");
  let onlyChanged = $state(false);
  let sortMode = $state<SortMode>(
    savedSort === "name" || savedSort === "conflicts" ? savedSort : "conflicts",
  );
  /** 本地重试等待中的项目（Host 快照终态不下发 loading，此处只表达等待）。 */
  let retrying = $state<string[]>([]);
  /** 已接受的最新快照：statsSeq 只增不减，旧序号晚到直接忽略。 */
  let accepted = $state(snapshot);
  let acceptedSeq = $state(snapshot.statsSeq ?? 0);

  $effect(() => {
    const incomingSeq = snapshot.statsSeq ?? 0;
    if (incomingSeq > acceptedSeq) {
      acceptedSeq = incomingSeq;
      accepted = snapshot;
      // 新权威快照到达：结束等待态（成功/失败均由行内状态表达）。
      retrying = [];
    }
  });

  function setSortMode(mode: SortMode): void {
    sortMode = mode;
    saveListPreferences("projects", { customSortField: mode });
  }

  function openTask(project: ProjectOverviewItem, task: string): void {
    onAction("projects/open-task", {
      projectRoot: project.absolutePath,
      task,
    });
  }

  function retryStats(project: ProjectOverviewItem): void {
    if (!retrying.includes(project.absolutePath)) {
      retrying = [...retrying, project.absolutePath];
    }
    onAction("projects/retry-stats", {
      projectRoot: project.absolutePath,
    });
  }

  function openDiagnostics(): void {
    onAction("open-module", {
      moduleId: "diagnostics",
      taskId: "diagnostics/environment",
    });
  }

  function openFolder(): void {
    onAction("diagnostics/open-folder", {});
  }

  function copyFullPath(project: ProjectOverviewItem): void {
    onAction("copy-text", { text: project.absolutePath });
  }

  function isSvnProject(project: ProjectOverviewItem): boolean {
    return project.binding !== "notSvn" && project.binding !== "missing";
  }

  function statsTotal(project: ProjectOverviewItem): number | undefined {
    if (!project.counts) return undefined;
    return (
      project.counts.changes +
      project.counts.conflicts +
      project.counts.unversioned
    );
  }

  const visibleProjects = $derived.by(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = accepted.projects.filter((project) => {
      if (
        keyword &&
        !project.name.toLowerCase().includes(keyword) &&
        !project.absolutePath.toLowerCase().includes(keyword)
      ) {
        return false;
      }
      if (onlyChanged) {
        const total = statsTotal(project);
        // 统计失败（无 counts）未知是否有修改：不过滤，保留并醒目标记。
        if (total === undefined) return true;
        if (total === 0) return false;
      }
      return true;
    });
    const ranked = [...filtered];
    if (sortMode === "conflicts") {
      // 失败统计（无 counts）不当作 0：按 -1 置底，仍保留醒目失败标记。
      ranked.sort((a, b) => {
        const ac = a.counts?.conflicts ?? -1;
        const bc = b.counts?.conflicts ?? -1;
        if (ac !== bc) return bc - ac;
        const ah = a.counts?.changes ?? -1;
        const bh = b.counts?.changes ?? -1;
        if (ah !== bh) return bh - ah;
        return a.name.localeCompare(b.name, "zh-CN");
      });
    } else {
      ranked.sort((a, b) => {
        const byName = a.name.localeCompare(b.name, "zh-CN");
        if (byName !== 0) return byName;
        return a.absolutePath.localeCompare(b.absolutePath);
      });
    }
    return ranked;
  });
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
        {accepted.projects.length} 个项目 · 更新于 {formatZhTime(
          accepted.generatedAt,
        )}
      </p>
    </div>
  </div>

  {#if accepted.projects.length === 0}
    <!-- V024-R42：无项目空态必须给出可执行的下一步（只复用安全动作白名单）。 -->
    <div class="empty-state">
      <span class="codicon codicon-project" aria-hidden="true"></span>
      <strong>没有打开的工作区项目</strong>
      <p>
        在 VS Code 中打开包含 SVN
        工作副本的文件夹后，这里会列出项目及其变更统计。
      </p>
      <div class="empty-state__actions">
        <button class="button button--primary" onclick={openFolder}
          >打开文件夹</button
        >
        <button class="button button--secondary" onclick={openDiagnostics}
          >查看环境诊断</button
        >
      </div>
    </div>
  {:else}
    <div class="projects-toolbar">
      <SearchInput
        bind:value={query}
        ariaLabel="按项目名称或路径搜索项目"
        placeholder="搜索项目名称或路径"
      />
      <label class="projects-filter-check">
        <input type="checkbox" bind:checked={onlyChanged} />
        只看有修改
      </label>
      <div class="projects-sort" role="group" aria-label="项目排序">
        <button
          type="button"
          class="button button--secondary"
          class:button--primary={sortMode === "conflicts"}
          aria-pressed={sortMode === "conflicts"}
          onclick={() => setSortMode("conflicts")}>冲突优先</button
        >
        <button
          type="button"
          class="button button--secondary"
          class:button--primary={sortMode === "name"}
          aria-pressed={sortMode === "name"}
          onclick={() => setSortMode("name")}>名称排序</button
        >
      </div>
      <ResultCount count={visibleProjects.length} suffix="个项目" />
    </div>
    {#if visibleProjects.length === 0}
      <div class="empty-state">
        <span class="codicon codicon-search" aria-hidden="true"></span>
        <strong>没有匹配的项目</strong>
        <p>当前搜索或筛选没有匹配项目，原始项目列表不受影响。</p>
        <div class="empty-state__actions">
          <button
            class="button button--secondary"
            onclick={() => {
              query = "";
              onlyChanged = false;
            }}>清除搜索与筛选</button
          >
        </div>
      </div>
    {:else}
      <ScrollArea class="projects-list" role="list" label="工作区项目列表">
        {#each visibleProjects as project (project.absolutePath)}
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
              <div class="project-row__meta">
                <span class="project-path" title={project.absolutePath}
                  >{project.absolutePath}</span
                >
                <button
                  type="button"
                  class="icon-button icon-button--small"
                  aria-label={`复制项目完整路径 ${project.absolutePath}`}
                  title="复制完整路径"
                  onclick={() => copyFullPath(project)}
                  ><span class="codicon codicon-copy" aria-hidden="true"
                  ></span></button
                >
                {#if project.workingCopyRoot}
                  <span>工作副本：{project.workingCopyRoot}</span>
                {/if}
              </div>
              {#if !project.exists}
                <!-- V024-R42：路径失效接重新选择；取消选择不清理其他工作区。 -->
                <div class="project-row__warning" role="note">
                  <span class="codicon codicon-warning" aria-hidden="true"
                  ></span>
                  路径不可用，请确认项目目录是否被移动或删除。
                </div>
                <div class="project-row__recovery">
                  <button class="button button--secondary" onclick={openFolder}
                    >重新选择文件夹</button
                  >
                  <button
                    class="button button--secondary"
                    onclick={() => copyFullPath(project)}>复制原路径</button
                  >
                </div>
              {:else if !isSvnProject(project)}
                <!-- V024-R42：非 SVN 接检出说明文字与环境诊断；不承诺检出向导。 -->
                <div class="project-row__warning" role="note">
                  <span class="codicon codicon-info" aria-hidden="true"></span>
                  非 SVN 目录，不能执行 SVN 任务。如需把远程仓库下载到本地（检出 Checkout），请使用
                  SVN 命令行或其他客户端完成；本版工作台不提供检出向导。
                </div>
                <div class="project-row__recovery">
                  <button class="button button--secondary" onclick={openFolder}
                    >打开文件夹</button
                  >
                  <button
                    class="button button--secondary"
                    onclick={openDiagnostics}>查看环境诊断</button
                  >
                </div>
              {:else if project.statsStatus === "error"}
                <!-- V024-R39：失败原地重试/诊断，不阻塞其他项目；无 counts 不当作 0。 -->
                <div
                  class="project-row__warning project-row__warning--error"
                  role="alert"
                >
                  <span class="codicon codicon-error" aria-hidden="true"></span>
                  统计失败：{project.statsError ?? "未能采集该项目统计。"}
                </div>
                <div class="project-row__recovery">
                  <button
                    class="button button--secondary"
                    disabled={retrying.includes(project.absolutePath)}
                    onclick={() => retryStats(project)}
                    >{retrying.includes(project.absolutePath)
                      ? "正在重新统计…"
                      : "重试统计"}</button
                  >
                  <button
                    class="button button--secondary"
                    onclick={openDiagnostics}>查看环境诊断</button
                  >
                </div>
              {:else if project.statsStatus === "stale"}
                <!-- V024-R39：过期值保留展示，附成功时间与过期原因，可原地重试。 -->
                <div class="project-row__warning" role="note">
                  <span class="codicon codicon-warning" aria-hidden="true"
                  ></span>
                  统计已过期：{project.staleReason ?? "已保留上次成功值。"}
                  {#if project.statsUpdatedAt}
                    上次成功于 {formatZhTime(project.statsUpdatedAt)}。
                  {/if}
                </div>
                <div class="project-row__recovery">
                  <button
                    class="button button--secondary"
                    disabled={retrying.includes(project.absolutePath)}
                    onclick={() => retryStats(project)}
                    >{retrying.includes(project.absolutePath)
                      ? "正在重新统计…"
                      : "重试统计"}</button
                  >
                </div>
              {:else if retrying.includes(project.absolutePath)}
                <div class="project-row__warning" role="status">
                  <span
                    class="codicon codicon-sync codicon-modifier-spin"
                    aria-hidden="true"
                  ></span>
                  正在重新统计该项目，其他项目不受影响…
                </div>
              {/if}
            </div>
            {#if project.counts}
              <div
                class="project-row__counts"
                aria-label={`变更 ${project.counts.changes}，冲突 ${project.counts.conflicts}，未版本化 ${project.counts.unversioned}${project.statsStatus === "stale" ? "（已过期）" : ""}`}
              >
                <span class="count-chip">变更 {project.counts.changes}</span>
                <!-- V024-R40：冲突数是可点击的直达入口，只打开该项目冲突任务。 -->
                <button
                  type="button"
                  class="count-chip count-chip--action"
                  class:count-chip--warning={project.counts.conflicts > 0}
                  aria-label={`打开该项目的冲突处理（${project.counts.conflicts} 个冲突）`}
                  onclick={() => openTask(project, "conflicts")}
                  >冲突 {project.counts.conflicts}</button
                >
                <span class="count-chip"
                  >未版本化 {project.counts.unversioned}</span
                >
                {#if project.statsStatus === "stale"}
                  <span class="count-chip count-chip--stale">已过期</span>
                {/if}
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
  {/if}
</section>

<style>
  .projects-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .projects-filter-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  .projects-sort {
    display: inline-flex;
    gap: 4px;
  }
  .project-path {
    overflow-wrap: anywhere;
  }
  .project-row__recovery {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .empty-state__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
  }
  .project-row__warning--error {
    font-weight: 600;
  }
  .count-chip--action {
    cursor: pointer;
  }
  .count-chip--stale {
    font-weight: 600;
  }
</style>
