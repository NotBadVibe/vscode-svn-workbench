<script lang="ts">
  import type {
    HostToWebviewMessage,
    UpdateSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import PreviewPathList from "../../components/list/PreviewPathList.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import StatusExplanation from "../../components/svn/StatusExplanation.svelte";
  import { riskExplanations, riskLabels } from "../../i18n/terminology";

  let {
    snapshot,
    onAction,
    pathDetail,
  }: {
    snapshot: UpdateSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.10：路径详情结果（Host 一次性下发）。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
  } = $props();

  // v0.0.14 批次 D：更新确认意向单（远端为操作对象，重叠为风险提示）
  let updateIntentOpen = $state(false);
  let updateTriggerEl = $state<HTMLElement | null>(null);
  const updateIntent = $derived.by(() => {
    const preview = snapshot.preview;
    if (!preview) return undefined;
    const remoteCount = preview.remoteCount;
    const hasRemoteCount = typeof remoteCount === "number";
    const title = hasRemoteCount
      ? `更新 ${remoteCount} 个远端变更`
      : "更新当前范围";
    const summary = hasRemoteCount
      ? `更新 ${remoteCount} 个远端变更 · 重叠风险 ${preview.overlapPaths.length} 个路径，执行前将重新校验范围与远端状态`
      : "更新当前范围 · 远端数量待检测，执行前将重新校验范围与远端状态";
    return {
      token: preview.token,
      kind: "update" as const,
      title,
      summary,
      paths: preview.overlapPaths,
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: [],
      commands: preview.commands,
      stale: false,
    };
  });
  const updateConfirmLabel = $derived.by(() => {
    const preview = snapshot.preview;
    if (!preview) return "确认更新当前范围";
    const remoteCount = preview.remoteCount;
    return typeof remoteCount === "number"
      ? `确认更新（${remoteCount}）`
      : "确认更新当前范围";
  });

  // v0.0.17 批次 B（U-06）：常驻冲突 CTA——只要当前范围仍有冲突就展示，
  // 携带冲突数量与范围直达冲突模块（打开模块不扩大右键范围）。
  const hasConflicts = $derived(snapshot.conflicts.count > 0);

  function openConflicts(): void {
    onAction("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  }
</script>

<section class="feature-layout">
  {#if snapshot.recovery}
    <div class="notice notice--warning" role="alert">
      <span class="codicon codicon-tools" aria-hidden="true"></span><span
        ><strong>{snapshot.recovery.title}</strong
        >，更新前请先完成恢复；此前写操作预览已经失效。</span
      ><button
        class="button button--secondary"
        onclick={() =>
          onAction("open-module", {
            moduleId: "repository",
            taskId: "repository/recovery",
          })}>进入清理与恢复</button
      >
    </div>
  {/if}

  {#if hasConflicts}
    <div
      class="notice notice--warning conflict-cta"
      role="status"
      data-update-conflict-cta
    >
      <span class="codicon codicon-warning" aria-hidden="true"></span>
      <div class="conflict-cta__body">
        <strong>当前范围有 {snapshot.conflicts.count} 个冲突</strong>
        <p>
          更新或本地修改产生了未解决冲突；在处理完冲突前，这些文件不能提交。点击下方按钮直达冲突处理，操作范围保持不变。
        </p>
        {#if snapshot.conflicts.paths.length > 0}
          <details>
            <summary>查看冲突文件（{snapshot.conflicts.paths.length}）</summary>
            <ul class="conflict-cta__paths">
              {#each snapshot.conflicts.paths as conflictPath (conflictPath)}
                <li>{conflictPath}</li>
              {/each}
            </ul>
          </details>
        {/if}
      </div>
      <button class="button button--primary" onclick={openConflicts}
        >处理 {snapshot.conflicts.count} 个冲突</button
      >
    </div>
  {:else if snapshot.conflicts.error}
    <div class="notice notice--warning" role="status">
      <span class="codicon codicon-warning" aria-hidden="true"></span><span
        >未能采集当前范围冲突状态：{snapshot.conflicts
          .error}。可以刷新重试；更新预览不受影响。</span
      >
    </div>
  {/if}

  <section class="operation-card operation-card--wide">
    <div class="section-heading">
      <div>
        <span class="eyebrow">更新范围</span>
        <h2>更新当前范围</h2>
      </div>
      {#if snapshot.preview}<span
          class={`risk-badge risk-badge--${snapshot.preview.risk}`}
          >{riskLabels[snapshot.preview.risk]}</span
        >
        <StatusExplanation
          term={riskLabels[snapshot.preview.risk]}
          explanation={riskExplanations[snapshot.preview.risk]}
        />{/if}
    </div>
    {#if snapshot.result}<div
        class={`notice notice--${snapshot.result.ok ? "success" : "error"}`}
        role="status"
      >
        <span
          class={`codicon codicon-${snapshot.result.ok ? "pass-filled" : "error"}`}
          aria-hidden="true"
        ></span><span>{snapshot.result.message}</span>
      </div>{/if}
    {#if snapshot.preview}
      <div class="operation-facts">
        <span><strong>{snapshot.preview.localCount}</strong> 个本地修改</span
        ><span
          ><strong>{snapshot.preview.remoteCount ?? "?"}</strong> 个远端修改</span
        ><span
          ><strong>{snapshot.preview.overlapPaths.length}</strong> 条路径重叠</span
        >
      </div>
      <div class="risk-messages">
        {#each snapshot.preview.messages as item, messageIndex (messageIndex)}<p
          >
            <span class="codicon codicon-info" aria-hidden="true"></span>{item}
          </p>{/each}
      </div>
      {#if snapshot.preview.error}<div class="notice notice--error">
          {snapshot.preview.error}
        </div>{/if}
      {#if snapshot.preview.overlapPaths.length}
        <!-- v0.0.10：重叠路径可搜索、复制清单与查看路径详情。 -->
        <PreviewPathList
          paths={snapshot.preview.overlapPaths}
          label="重叠路径清单"
          {onAction}
          {pathDetail}
        />
      {/if}
      <details class="command-preview">
        <summary>查看命令预览</summary
        >{#each snapshot.preview.commands as command, commandIndex (commandIndex)}<code
            >{command}</code
          >{/each}
      </details>
      <div class="toolbar-actions">
        <button
          class="button button--secondary"
          onclick={() => onAction("update/preview")}>重新检查</button
        ><button
          class="button button--primary"
          disabled={!snapshot.preview.canExecute}
          onclick={(event) => {
            updateTriggerEl = event.currentTarget as HTMLElement;
            updateIntentOpen = true;
          }}>确认更新当前范围</button
        >
      </div>
      <OperationIntentDialog
        intent={updateIntent}
        open={updateIntentOpen && Boolean(updateIntent)}
        confirmLabel={updateConfirmLabel}
        cancelLabel="取消"
        triggerElement={updateTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          updateIntentOpen = false;
          onAction("update/execute", { previewToken: token });
        }}
        onCancel={() => (updateIntentOpen = false)}
      />
    {:else}
      <div class="preview-empty">
        <span class="codicon codicon-sync" aria-hidden="true"></span>
        <strong>尚未生成更新预览</strong>
        <p>
          这是正常状态：进入更新页后先检查，再决定是否更新。检查会对比本地未提交修改与远端新修订，并提示同路径重叠风险；整个检查只读，不会修改工作副本。
        </p>
        <button
          class="button button--primary"
          onclick={() => onAction("update/preview")}>生成更新预览</button
        >
      </div>
    {/if}
  </section>
</section>
