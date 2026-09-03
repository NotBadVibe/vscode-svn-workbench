<script lang="ts">
  import type {
    HostToWebviewMessage,
    UpdateSnapshot,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import PreviewPathList from "../../components/list/PreviewPathList.svelte";
  import OperationIntentDialog from "../../components/operation/OperationIntentDialog.svelte";
  import PrimaryActionBar from "../../components/task/PrimaryActionBar.svelte";
  import ResultNextStep from "../../components/task/ResultNextStep.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import TaskSummary from "../../components/task/TaskSummary.svelte";
  import type { TaskSummaryTone } from "../../components/task/TaskSummary.svelte";
  import {
    riskExplanations,
    riskLabels,
    updateConfirmLabel,
    updateConflictFilesSummary,
    updateConflictPrimaryLabel,
    updateConflictStatus,
  } from "../../i18n/terminology";

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
    // v0.1.5 V015-C1 九要素补齐：scope 摘要取 Host 下发的仓库名；revision 取检查修订
    // 回退工作副本修订；可恢复性复用结果页 recoveryHint 同一文案。
    const checkedRevision = preview.checkedRevision ?? snapshot.info.revision;
    return {
      token: preview.token,
      kind: "update" as const,
      title,
      summary,
      paths: preview.overlapPaths,
      scopeText: snapshot.info.name,
      revision: checkedRevision ? `r${checkedRevision}` : undefined,
      recoverability: "如需回退，请使用历史记录恢复到更新前的修订。",
      createdAt: new Date().toISOString(),
      canExecute: preview.canExecute,
      issues: [],
      commands: preview.commands,
      stale: false,
    };
  });
  // v0.1.5 V015-B2：确认标签集中进 terminology（远端数量未知时回退，不虚构数字）。
  const confirmLabel = $derived(
    updateConfirmLabel(snapshot.preview?.remoteCount),
  );

  // v0.0.17 批次 B（U-06）：常驻冲突 CTA——只要当前范围仍有冲突就展示，
  // 携带冲突数量与范围直达冲突模块（打开模块不扩大右键范围）。
  const hasConflicts = $derived(snapshot.conflicts.count > 0);
  // v0.1.5 V015-B2：同页 TaskSummary full≤1——recovery 阻断优先占 full，
  // 冲突摘要此时降级为 compact（骨架约束）。
  const conflictVariant = $derived(
    snapshot.recovery ? ("compact" as const) : ("full" as const),
  );

  // v0.1.5 V015-B2：风险等级→TaskSummary tone（low=info/medium=warning/high=error）。
  const riskTone = $derived.by((): TaskSummaryTone => {
    const risk = snapshot.preview?.risk;
    if (risk === "high") return "error";
    if (risk === "medium") return "warning";
    return "info";
  });

  // v0.1.5 V015-B2：执行结果→ResultNextStep（结果先行，下一步与恢复如实表达）。
  const resultView = $derived.by(() => {
    const result = snapshot.result;
    if (!result) return undefined;
    const cancelled = !result.ok && result.message.includes("更新已取消");
    if (result.ok) {
      const conflicted = hasConflicts || result.hasConflicts;
      const count = snapshot.conflicts.count;
      if (conflicted && count > 0) {
        return {
          tone: "success" as const,
          result: result.message,
          nextStep: `存在未解决冲突，下一步是${updateConflictPrimaryLabel(count)}（操作范围保持不变）。`,
          recoveryHint: "如需回退，请使用历史记录恢复到更新前的修订。",
          actions: [
            {
              label: updateConflictPrimaryLabel(count),
              action: "update-conflicts",
              kind: "primary" as const,
            },
          ],
        };
      }
      return {
        tone: "success" as const,
        result: result.message,
        nextStep: "更新完成，下一步可查看本地修改，或返回编辑继续工作。",
        recoveryHint: "如需回退，请使用历史记录恢复到更新前的修订。",
        actions: [
          {
            label: "查看本地修改",
            action: "update-view-changes",
            kind: "primary" as const,
          },
          {
            label: "返回编辑",
            action: "update-back-changes",
            kind: "secondary" as const,
          },
        ],
      };
    }
    return {
      tone: "error" as const,
      result: result.message,
      nextStep: cancelled
        ? "更新已取消：请重新采集工作副本状态，不复用半完成结果；确认无残留修改后可重新生成预览。"
        : "更新失败：请重新检查后重试；旧预览已失效，不复用旧确认。",
      recoveryHint: "重试将重新生成预览并重新确认，不会自动沿用旧结果。",
      actions: [
        {
          label: "重新检查",
          action: "update-retry",
          kind: "primary" as const,
        },
        {
          label: "复制诊断信息",
          action: "update-copy-diagnostic",
          kind: "secondary" as const,
        },
      ],
    };
  });

  function openConflicts(): void {
    onAction("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  }

  /**
   * v0.1.5 V015-B2：PrimaryActionBar 的 onClick 不透出事件，触发按钮经
   * `document.activeElement` 记录，供意向单关闭后焦点返回（OperationIntentDialog 同契约）。
   */
  function openUpdateIntent(): void {
    updateTriggerEl =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    updateIntentOpen = true;
  }

  /** ResultNextStep / TaskEmptyState 动作纯透传：只映射页面已知标识，不拼接协议名。 */
  function handleResultAction(action: string): void {
    if (action === "update-conflicts") {
      openConflicts();
      return;
    }
    if (action === "update-view-changes") {
      onAction("open-module", {
        moduleId: "diff",
        taskId: "diff/working",
      });
      return;
    }
    if (action === "update-back-changes") {
      onAction("open-module", {
        moduleId: "changes",
        taskId: "changes/overview",
      });
      return;
    }
    if (action === "update-retry" || action === "update-preview") {
      onAction("update/preview");
      return;
    }
    if (action === "update-copy-diagnostic") {
      onAction("copy-text", { text: snapshot.result?.message ?? "" });
      return;
    }
  }
</script>

<section class="feature-layout">
  {#if snapshot.recovery}
    <!-- v0.1.5 V015-B2：recovery 阻断 notice→TaskSummary full warning（进入恢复按钮语义保留）。 -->
    <TaskSummary
      variant="full"
      tone="warning"
      icon="codicon-tools"
      status={snapshot.recovery.title}
      reason="更新前请先完成恢复；此前写操作预览已经失效。"
      nextStep="下一步：进入清理与恢复，完成后再重新生成更新预览。"
    />
    <div class="toolbar-actions">
      <button
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
    <!-- v0.1.5 V015-B2：常驻冲突 CTA→TaskSummary（full，recovery 在场时降级 compact）+ PrimaryActionBar 主动作。 -->
    <div class="update-conflict-cta" data-update-conflict-cta>
      <TaskSummary
        variant={conflictVariant}
        tone="warning"
        icon="codicon-warning"
        status={updateConflictStatus(snapshot.conflicts.count)}
        reason="更新或本地修改产生了未解决冲突；在处理完冲突前，这些文件不能提交。"
        nextStep={`下一步：${updateConflictPrimaryLabel(snapshot.conflicts.count)}（操作范围保持不变）。`}
      />
      {#if snapshot.conflicts.paths.length > 0}
        <details>
          <summary
            >{updateConflictFilesSummary(
              snapshot.conflicts.paths.length,
            )}</summary
          >
          <ul class="conflict-cta__paths">
            {#each snapshot.conflicts.paths as conflictPath (conflictPath)}
              <li>{conflictPath}</li>
            {/each}
          </ul>
        </details>
      {/if}
      <!-- 结果出口已给出处理冲突主动作时不再重复，避免同页两个同名 primary。 -->
      {#if !snapshot.result}
        <PrimaryActionBar
          primary={{
            label: updateConflictPrimaryLabel(snapshot.conflicts.count),
            onClick: openConflicts,
          }}
          ariaLabel="冲突处理操作栏"
        />
      {/if}
    </div>
  {:else if snapshot.conflicts.error}
    <!-- v0.1.5 V015-B2：冲突采集失败→TaskSummary compact warning（保留刷新重试）。 -->
    <TaskSummary
      variant="compact"
      tone="warning"
      icon="codicon-warning"
      status={`未能采集当前范围冲突状态：${snapshot.conflicts.error}。`}
      reason="更新预览不受影响。"
      nextStep="下一步：重新检查以重试冲突采集。"
    />
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        onclick={() => onAction("update/preview")}>重新检查</button
      >
    </div>
  {/if}

  <section class="operation-card operation-card--wide">
    {#if resultView}
      <ResultNextStep
        tone={resultView.tone}
        result={resultView.result}
        nextStep={resultView.nextStep}
        recoveryHint={resultView.recoveryHint}
        actions={resultView.actions}
        onAction={handleResultAction}
      />
    {/if}
    {#if snapshot.preview}
      <!-- v0.1.5 V015-B2：风险徽章语义并入 TaskSummary compact（页内重复标题已删，ScopeBar H1 表达任务）。 -->
      <TaskSummary
        variant="compact"
        tone={riskTone}
        icon="codicon-info"
        status={`更新风险：${riskLabels[snapshot.preview.risk]}`}
        reason={riskExplanations[snapshot.preview.risk]}
      />
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
      <!-- v0.1.5 V015-B2：工具栏→PrimaryActionBar（唯一 primary + 次级重新检查；UpdateSnapshot 无 busy/stale 信号，沿用 disabled 语义）。 -->
      <PrimaryActionBar
        primary={{
          label: confirmLabel,
          disabled: !snapshot.preview.canExecute,
          disabledReason: "当前预览不可执行，请核对风险提示后重新检查。",
          onClick: openUpdateIntent,
        }}
        secondary={[
          {
            label: "重新检查",
            onClick: () => onAction("update/preview"),
          },
        ]}
        ariaLabel="更新确认操作栏"
      />
      <OperationIntentDialog
        intent={updateIntent}
        open={updateIntentOpen && Boolean(updateIntent)}
        {confirmLabel}
        cancelLabel="取消"
        recheckLabel="重新检查"
        triggerElement={updateTriggerEl}
        {onAction}
        {pathDetail}
        onConfirm={(token) => {
          updateIntentOpen = false;
          onAction("update/execute", { previewToken: token });
        }}
        onCancel={() => (updateIntentOpen = false)}
        onRecheck={() => {
          updateIntentOpen = false;
          onAction("update/preview");
        }}
      />
    {:else if !snapshot.result}
      <!-- v0.1.5 V015-B2：空预览→TaskEmptyState（原文三句直搬 + 生成预览主动作）。 -->
      <TaskEmptyState
        icon="codicon-sync"
        what="尚未生成更新预览"
        whyNormal="这是正常状态：进入更新页后先检查，再决定是否更新。检查会对比本地未提交修改与远端新修订，并提示同路径重叠风险；整个检查只读，不会修改工作副本。"
        whatNow="现在可以生成更新预览，确认风险后再决定是否更新。"
        actions={[
          {
            label: "生成更新预览",
            action: "update-preview",
            kind: "primary",
          },
        ]}
        onAction={handleResultAction}
      />
    {/if}
  </section>
</section>
