<script lang="ts">
  import type {
    RepositorySnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import OperationIntentDialog from "../../../components/operation/OperationIntentDialog.svelte";
  import { formatZhDateTime } from "../../../i18n/formatters";

  let {
    snapshot,
    onAction,
  }: {
    snapshot: RepositorySnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();

  // v0.0.14 批次 D：清理意向单
  let cleanupIntentOpen = $state(false);
  let cleanupTriggerEl = $state<HTMLElement | null>(null);
  const cleanupIntent = $derived.by(() => {
    const preview = snapshot.cleanup.preview;
    if (!preview) return undefined;
    const title = "清理工作副本";
    const summary = `清理工作副本 · 目标：${snapshot.cleanup.target}，执行前将重新校验`;
    // v0.1.5 V015-C1 九要素补齐：scope 即清理目标；可恢复性说明 cleanup 语义
    // （只释放锁与中断状态，不改动文件内容）；revision 无权威来源，不虚构。
    return {
      token: preview.token,
      kind: "cleanup" as const,
      title,
      summary,
      paths: [snapshot.cleanup.target],
      scopeText: snapshot.cleanup.target,
      recoverability:
        "清理只释放工作副本锁与中断状态，不改动文件内容；不会自动提交。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: preview.issues,
      commands: [preview.command],
      stale: false,
    };
  });
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
          onclick={(event) => {
            cleanupTriggerEl = event.currentTarget as HTMLElement;
            cleanupIntentOpen = true;
          }}>确认清理工作副本</button
        >
        <OperationIntentDialog
          intent={cleanupIntent}
          open={cleanupIntentOpen && Boolean(cleanupIntent)}
          confirmLabel="确认清理工作副本"
          cancelLabel="取消"
          recheckLabel="重新检查"
          triggerElement={cleanupTriggerEl}
          onAction={(a, d) => onAction(a, d)}
          onConfirm={(token) => {
            cleanupIntentOpen = false;
            onAction("repository/execute-cleanup", { previewToken: token });
          }}
          onCancel={() => (cleanupIntentOpen = false)}
          onRecheck={() => {
            cleanupIntentOpen = false;
            onAction("repository/preview-cleanup");
          }}
        />
      </div>{:else}<button
        class="button button--primary"
        disabled={!snapshot.cleanup.available}
        onclick={() => onAction("repository/preview-cleanup")}
        >生成清理预览</button
      >{/if}
  </div>
</section>
