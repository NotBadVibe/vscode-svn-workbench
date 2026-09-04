<script lang="ts">
  import type {
    ActivitySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  // 中文注释：V017-C T6——模块主区落点（挂载聚焦一次，刷新不抢焦点）。
  import { focusOnMount } from "../../components/ui/focusOnMount";
  import { taskStateCopy } from "../../i18n/terminology";
  import { formatZhDateTime } from "../../i18n/formatters";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: ActivitySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  let query = $state("");
  const filtered = $derived(
    snapshot.records.filter((r) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        r.scopeLabel.toLowerCase().includes(q) ||
        (r.previewSummary ?? "").toLowerCase().includes(q) ||
        (r.errorReason ?? "").toLowerCase().includes(q)
      );
    }),
  );

  function handleNext(action: string, recordId: string): void {
    switch (action) {
      case "retry":
        onAction("activity/retry", { recordId });
        break;
      case "view-conflicts":
        onAction("activity/view-conflicts", { recordId });
        break;
      case "open-output":
        onAction("activity/open-output", { recordId });
        break;
      case "copy-diagnostics":
        onAction("activity/copy-diagnostics", { recordId });
        break;
      case "view-history":
        onAction("activity/view-history", { recordId });
        break;
      default:
        break;
    }
  }
</script>

<section class="activity-page" use:focusOnMount tabindex="-1">
  <header class="page-heading">
    <div>
      <span class="eyebrow">操作记录</span>
      <h1>操作时间线</h1>
      <p>会话内记录，共 {snapshot.records.length} 条，仅本次会话可见</p>
      <p>生成于 {formatZhDateTime(snapshot.generatedAt)}</p>
    </div>
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        onclick={() => onAction("activity/refresh")}>刷新</button
      >
      <button
        class="button button--secondary"
        onclick={() =>
          onAction("copy-text", {
            text: snapshot.records
              .map(
                (r) =>
                  `${r.capturedAt} ${r.scopeLabel} ${r.result ?? ""} ${r.errorReason ?? ""}`,
              )
              .join("\n"),
          })}>复制时间线</button
      >
    </div>
  </header>

  <div class="search-bar">
    <input
      type="search"
      placeholder="搜索任务、范围或错误"
      bind:value={query}
      aria-label="搜索操作记录"
    />
    <ResultCount count={filtered.length} suffix="条记录" />
  </div>

  {#if filtered.length === 0}
    <!-- v0.1.5 V015-E：mini-empty→TaskEmptyState（三句复用 taskStateCopy，空会话给出来路下一步）。 -->
    {#if snapshot.records.length === 0}
      <TaskEmptyState
        icon="codicon-history"
        what="本次会话暂无操作记录"
        whyNormal="尚未执行提交、解决冲突或保存草稿，这是正常状态。"
        whatNow="下一步可先查看本地修改，执行操作后记录会在此显示。"
        actions={[]}
        onAction={() => {}}
      />
    {:else}
      <TaskEmptyState
        icon="codicon-search"
        what={taskStateCopy.filterNoMatch.what}
        whyNormal={taskStateCopy.filterNoMatch.whyNormal}
        whatNow={taskStateCopy.filterNoMatch.whatNow}
        actions={[]}
        onAction={() => {}}
      />
    {/if}
  {:else}
    <ScrollArea class="activity-list" label="操作时间线">
      {#each filtered as record (record.id)}
        <article
          class="activity-row"
          class:activity-row--failed={record.result === "failed"}
        >
          <div class="activity-row-head">
            <span
              class={`check-icon check-icon--${record.result === "failed" ? "fail" : record.result === "success" ? "pass" : "warn"}`}
              role="img"
              aria-label={record.result === "failed"
                ? "失败"
                : record.result === "success"
                  ? "成功"
                  : "进行中"}
            >
              <span
                class={`codicon codicon-${record.result === "failed" ? "error" : record.result === "success" ? "pass-filled" : "clock"}`}
                aria-hidden="true"
              ></span>
            </span>
            <div class="activity-meta">
              <strong>{record.scopeLabel}</strong>
              <small
                >{formatZhDateTime(record.capturedAt)} · {record.moduleId}/{record.taskId}{record.projectName
                  ? ` · ${record.projectName}`
                  : ""} · 影响 {record.impactedCount} 项</small
              >
              {#if record.previewSummary}<small class="activity-summary"
                  >{record.previewSummary}</small
                >{/if}
            </div>
            <span class="status-badge"
              >{record.kind === "draft-checkpoint"
                ? "草稿"
                : record.kind === "understanding-confirmation"
                  ? "已确认"
                  : "执行"}</span
            >
          </div>
          {#if record.errorReason}
            <div class="activity-error" role="alert">
              <span class="codicon codicon-warning" aria-hidden="true"></span>
              <span>失败原因：{record.errorReason}</span>
            </div>
          {/if}
          {#if record.nonRecoverable}
            <div class="notice notice--warning" role="note">
              <span class="codicon codicon-info" aria-hidden="true"></span>
              <span
                >此操作不能在工作台中一键撤销。如需恢复，请通过新的状态检查、预览与确认重做。</span
              >
            </div>
          {/if}
          {#if record.nextActions.length > 0}
            <div class="activity-actions">
              {#each record.nextActions as action (action.id)}
                <button
                  class="button button--secondary"
                  onclick={() => handleNext(action.id, record.id)}
                  >{action.label}</button
                >
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </ScrollArea>
  {/if}
</section>

<style>
  .activity-page {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .activity-list :global(.scroll-region) {
    max-height: 100%;
  }
  .activity-row {
    border: 1px solid var(--vscode-panel-border);
    padding: 10px;
    border-radius: 6px;
    margin-bottom: 8px;
  }
  .activity-row-head {
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .activity-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .activity-summary {
    color: var(--vscode-descriptionForeground);
  }
  .activity-error {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    color: var(--vscode-errorForeground, #f14c4c);
  }
  .activity-actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
    flex-wrap: wrap;
  }
  .search-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .search-bar input {
    flex: 1;
  }
</style>
