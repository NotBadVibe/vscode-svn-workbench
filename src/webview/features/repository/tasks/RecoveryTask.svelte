<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import { formatZhDateTime } from "../../../i18n/formatters";

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
      <span class="eyebrow">工作副本恢复</span>
      <h2>清理与安全恢复</h2>
    </div>
  </div>
  {#if snapshot.recovery}
    <div class="recovery-card" aria-labelledby="working-copy-recovery-title">
      <div class="recovery-card__icon">
        <span class="codicon codicon-tools" aria-hidden="true"></span>
      </div>
      <div>
        <h2 id="working-copy-recovery-title">{snapshot.recovery.title}</h2>
        <p>
          检测于 {formatZhDateTime(
            snapshot.recovery.detectedAt,
          )}。此前所有写操作预览已作废。
        </p>
        <ol>
          {#each snapshot.recovery.steps as step, stepIndex (stepIndex)}<li>
              {step}
            </li>{/each}
        </ol>
        <div class="notice notice--warning">
          <span class="codicon codicon-warning" aria-hidden="true"></span><span
            >恢复后必须重新采集状态并生成新预览，再执行提交、更新或冲突解决。</span
          >
        </div>
      </div>
    </div>
  {/if}
  <div class="cleanup-card">
    <div>
      <span class="codicon codicon-tools" aria-hidden="true"></span><span
        ><strong>清理工作副本（Cleanup）</strong><small
          >{snapshot.cleanup.reason ??
            `范围：${snapshot.cleanup.target}；不会删除未版本化文件`}</small
        ></span
      >
    </div>
    {#if snapshot.cleanup.feedback}<div
        class="notice notice--success"
        role="status"
      >
        {snapshot.cleanup.feedback}
      </div>{/if}{#if snapshot.cleanup.preview}<div class="property-preview">
        <code>{snapshot.cleanup.preview.command}</code
        >{#each snapshot.cleanup.preview.issues as issue, issueIndex (issueIndex)}<div
            class="notice notice--error"
          >
            {issue}
          </div>{/each}<button
          class="button button--primary"
          disabled={!snapshot.cleanup.preview.canExecute}
          onclick={() =>
            onAction("repository/execute-cleanup", {
              previewToken: snapshot.cleanup.preview?.token,
            })}>确认清理工作副本</button
        >
      </div>{:else}<button
        class="button button--primary"
        disabled={!snapshot.cleanup.available}
        onclick={() => onAction("repository/preview-cleanup")}
        >生成清理预览</button
      >{/if}
  </div>
</section>
