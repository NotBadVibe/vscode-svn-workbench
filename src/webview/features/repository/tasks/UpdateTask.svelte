<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import { riskLabels } from "../../../i18n/terminology";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
</script>

<section class="operation-card operation-card--wide repository-task-card">
  <div class="section-heading">
    <div>
      <span class="eyebrow">更新范围</span>
      <h2>更新当前范围</h2>
    </div>
    {#if snapshot.update}<span
        class={`risk-badge risk-badge--${snapshot.update.risk}`}
        >{riskLabels[snapshot.update.risk]}</span
      >{/if}
  </div>
  {#if snapshot.lastResult}<div
      class={`notice notice--${snapshot.lastResult.ok ? "success" : "error"}`}
      role="status"
    >
      <span
        class={`codicon codicon-${snapshot.lastResult.ok ? "pass-filled" : "error"}`}
        aria-hidden="true"
      ></span><span
        >{snapshot.lastResult.message}{snapshot.lastResult.hasConflicts
          ? "；检测到冲突，请前往冲突处理。"
          : ""}</span
      >
    </div>{/if}
  {#if snapshot.update}
    <div class="operation-facts">
      <span><strong>{snapshot.update.localCount}</strong> 个本地修改</span><span
        ><strong>{snapshot.update.remoteCount ?? "?"}</strong> 个远端修改</span
      ><span
        ><strong>{snapshot.update.overlapPaths.length}</strong> 条路径重叠</span
      >
    </div>
    <div class="risk-messages">
      {#each snapshot.update.messages as item, messageIndex (messageIndex)}<p>
          <span class="codicon codicon-info" aria-hidden="true"></span>{item}
        </p>{/each}
    </div>
    {#if snapshot.update.error}<div class="notice notice--error">
        {snapshot.update.error}
      </div>{/if}
    {#if snapshot.update.overlapPaths.length}<details>
        <summary>查看重叠路径</summary>
        <ul>
          {#each snapshot.update.overlapPaths as item (item)}<li>
              {item}
            </li>{/each}
        </ul>
      </details>{/if}
    <details class="command-preview">
      <summary>查看命令预览</summary
      >{#each snapshot.update.commands as command, commandIndex (commandIndex)}<code
          >{command}</code
        >{/each}
    </details>
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        onclick={() => onAction("repository/preview-update")}>重新检查</button
      ><button
        class="button button--primary"
        disabled={!snapshot.update.canExecute}
        onclick={() =>
          onAction("repository/execute-update", {
            previewToken: snapshot.update?.token,
          })}>确认更新当前范围</button
      >
    </div>
  {:else}
    <div class="preview-empty">
      <span class="codicon codicon-sync" aria-hidden="true"></span>
      <p>先检查本地未提交、远端状态和同路径重叠，再决定是否更新。</p>
      <button
        class="button button--primary"
        onclick={() => onAction("repository/preview-update")}
        >生成更新预览</button
      >
    </div>
  {/if}
</section>
