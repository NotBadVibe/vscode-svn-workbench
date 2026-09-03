<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type {
    ChangeUnderstandingSnapshot,
    EvidenceReference,
    HostToWebviewMessage,
    WebviewAction,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import FilePathDetail from "../../components/svn/FilePathDetail.svelte";
  import TaskEmptyState from "../../components/task/TaskEmptyState.svelte";
  import { understandingLabels } from "../../i18n/terminology";

  let {
    snapshot,
    onAction,
    pathDetail,
    understandingReceipt,
  }: {
    snapshot: ChangeUnderstandingSnapshot;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
    /** v0.0.7 路径详情结果。 */
    pathDetail?: Extract<
      HostToWebviewMessage,
      { type: "file/path-detail-result" }
    >["payload"];
    /** v0.0.12 变更解读外发回执（understanding/receipt 一次性）。 */
    understandingReceipt?: Extract<
      HostToWebviewMessage,
      { type: "understanding/receipt" }
    >["payload"];
  } = $props();

  let confirmText = $state("");
  let receiptExpanded = $state(false);

  const stateLabels: Record<ChangeUnderstandingSnapshot["state"], string> = {
    idle: "尚未分析",
    running: "运行中",
    ready: "已完成",
    partial: "部分完成",
    failed: "分析失败",
    stale: "已过期",
  };

  const sourceLabels: Record<string, string> = {
    "local-rule": understandingLabels.localRule,
    "configured-model": understandingLabels.configuredModel,
    "local-rule-fallback": understandingLabels.localFallback,
    user: understandingLabels.user,
    mixed: understandingLabels.mixed,
  };

  const claimStatusLabels: Record<string, string> = {
    confirmed: understandingLabels.confirmed,
    inferred: understandingLabels.inferred,
    toConfirm: understandingLabels.toConfirm,
  };

  /*
   * v0.0.18 批次 D（C-08）：逐条已看/未看进度——大范围分析可按任意顺序
   * 标记，不强迫线性流程；已看状态仅本地（会话内），快照刷新只保留仍
   * 存在的条目，新分析（新 id）自然从“未看”开始。
   */
  const viewedChanges = new SvelteSet<string>();
  $effect(() => {
    const validIds = new Set(snapshot.changes.map((change) => change.id));
    for (const id of [...viewedChanges]) {
      if (!validIds.has(id)) viewedChanges.delete(id);
    }
  });
  const viewedCount = $derived(
    snapshot.changes.filter((change) => viewedChanges.has(change.id)).length,
  );

  function toggleViewed(changeId: string): void {
    if (viewedChanges.has(changeId)) {
      viewedChanges.delete(changeId);
    } else {
      viewedChanges.add(changeId);
    }
  }

  const findingCategoryLabels: Record<string, string> = {
    "local-blocked": "本地阻止项",
    model: "模型发现",
    "evidence-gap": "证据不足",
    "business-unknown": "业务未知",
  };

  function runLocal(): void {
    onAction("understanding/run-local", {});
  }

  function requestReceipt(): void {
    onAction("understanding/preview-receipt", {});
  }

  function confirmReceiptGenerate(): void {
    if (!understandingReceipt) return;
    onAction("understanding/run-model", {
      receiptToken: understandingReceipt.token,
    });
    understandingReceipt = undefined;
  }

  function continueLocalFromReceipt(): void {
    const receipt = understandingReceipt;
    if (receipt) {
      onAction("understanding/receipt-dismiss", { token: receipt.token });
    }
    understandingReceipt = undefined;
    onAction("understanding/run-local", {});
  }

  function dismissReceipt(): void {
    const receipt = understandingReceipt;
    if (receipt) {
      onAction("understanding/receipt-dismiss", { token: receipt.token });
    }
    understandingReceipt = undefined;
  }

  function openEvidence(reference: EvidenceReference): void {
    onAction("understanding/open-evidence", {
      candidateId: reference.candidateId,
      ...(reference.hunkId ? { hunkId: reference.hunkId } : {}),
      projectRelativePath: reference.projectRelativePath,
    });
  }

  function confirmFact(): void {
    const text = confirmText.trim();
    if (!text) return;
    onAction("understanding/confirm-fact", { statement: text });
    confirmText = "";
  }

  function handleConfirmKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      confirmFact();
    }
  }

  function clearConfirmations(): void {
    onAction("understanding/clear-confirmations", {});
  }

  function requestRetryFailed(): void {
    onAction("understanding/retry-failed", {});
  }

  const failedRetryCount = $derived.by(
    () =>
      snapshot.coverageFiles.filter(
        (file) =>
          file.state === "readFailed" || file.state === "budgetExcluded",
      ).length,
  );

  const hasResult = $derived.by(
    () =>
      snapshot.changes.length > 0 ||
      snapshot.findings.length > 0 ||
      snapshot.verification.length > 0,
  );
</script>

<ScrollArea class="understanding-layout" label="变更解读">
  <div class="feature-toolbar">
    <div>
      <h2>{understandingLabels.task}</h2>
      <p>{understandingLabels.purpose}</p>
      <p>
        范围：{snapshot.receipt.projectId
          ? snapshot.binding.scopeHash.slice(0, 8)
          : "当前操作范围"} · 候选 {snapshot.coverage.total} 个文件
        {#if snapshot.source}<span class="status-badge"
            >{sourceLabels[snapshot.source]}</span
          >{/if}
        <span class="status-badge">{stateLabels[snapshot.state]}</span>
      </p>
      <p class="understanding-safe-note">{understandingLabels.aiNoWrite}</p>
    </div>
    <div class="toolbar-actions">
      {#if snapshot.state !== "stale" && snapshot.state !== "running"}
        <button class="button button--secondary" onclick={runLocal}>
          {understandingLabels.runLocal}
        </button>
        <button class="button button--primary" onclick={requestReceipt}>
          {snapshot.state === "idle" || snapshot.state === "failed"
            ? `${understandingLabels.startAnalysis}（${snapshot.coverage.total}）`
            : "重新分析"}
        </button>
      {/if}
    </div>
  </div>

  {#if snapshot.stale}
    <div class="notice notice--warning" role="status">
      范围、候选或修订版本已变化：旧结果只读，用户确认标为待复核；请重新分析。
    </div>
  {/if}
  {#if snapshot.feedback}
    <div
      class="commit-feedback commit-feedback--{snapshot.feedback.tone}"
      role="status"
    >
      {snapshot.feedback.message}
    </div>
  {/if}

  {#if understandingReceipt}
    <div class="commit-receipt" role="region" aria-label="变更解读外发回执">
      <div class="commit-receipt__head">
        <span class="codicon codicon-arrow-up" aria-hidden="true"></span>
        <strong>变更解读外发回执（尚未发送）</strong>
        <span class="commit-receipt__tag" role="status">等待确认</span>
      </div>
      <dl class="commit-receipt__meta">
        <div>
          <dt>任务</dt>
          <dd>变更解读（{understandingReceipt.receipt.task}）</dd>
        </div>
        <div>
          <dt>模型</dt>
          <dd>{understandingReceipt.receipt.model}</dd>
        </div>
        <div>
          <dt>数据类型</dt>
          <dd>{understandingReceipt.receipt.dataTypes.join("、")}</dd>
        </div>
        <div>
          <dt>文件数</dt>
          <dd>{understandingReceipt.receipt.files} 个已发送候选</dd>
        </div>
        <div>
          <dt>预算</dt>
          <dd>
            单文件 {understandingReceipt.receipt.perFileBudget} 字符 / 总计 {understandingReceipt
              .receipt.totalBudget} 字符
          </dd>
        </div>
        <div>
          <dt>历史</dt>
          <dd>
            {understandingReceipt.historyIncluded
              ? `包含 ${understandingReceipt.historyCount ?? 0} 条已脱敏历史摘要`
              : "不包含"}
          </dd>
        </div>
      </dl>
      <p class="commit-receipt__coverage">
        覆盖率：已分析 {understandingReceipt.coverage.analyzed} · 截断
        {understandingReceipt.coverage.truncated} · 二进制
        {understandingReceipt.coverage.binary} · 读取失败
        {understandingReceipt.coverage.readFailed} · 预算外
        {understandingReceipt.coverage.budgetExcluded}（共
        {understandingReceipt.coverage.total} 个候选）
      </p>
      <button
        type="button"
        class="commit-receipt__toggle"
        aria-expanded={receiptExpanded}
        onclick={() => (receiptExpanded = !receiptExpanded)}
        >{receiptExpanded ? "收起" : "展开"}包含 / 排除文件清单</button
      >
      {#if receiptExpanded}
        <ul class="commit-receipt__files" aria-label="包含与排除文件清单">
          {#each understandingReceipt.files as file (file.candidateId)}
            <li
              class="commit-receipt__file"
              class:commit-receipt__file--excluded={file.state !== "analyzed"}
            >
              <span>{file.projectRelativePath}</span>
              <small
                >{file.state}{file.reason ? `（${file.reason}）` : ""} · {file.charCount}
                字符 / {file.hunkCount} 块</small
              >
            </li>
          {/each}
        </ul>
      {/if}
      <p class="commit-receipt__note">
        不会发送：{understandingReceipt.notSent.join("；")}。
      </p>
      <p class="commit-receipt__note">{understandingReceipt.retentionNote}</p>
      <div class="commit-receipt__actions">
        <button
          type="button"
          class="button button--primary"
          onclick={confirmReceiptGenerate}>开始模型分析</button
        >
        <button
          type="button"
          class="button button--secondary"
          onclick={continueLocalFromReceipt}>继续仅本地检查</button
        >
        <button
          type="button"
          class="button button--secondary"
          onclick={dismissReceipt}>放弃</button
        >
      </div>
    </div>
  {/if}

  {#if failedRetryCount > 0 && snapshot.state !== "stale"}
    <div class="understanding-retry">
      <button
        type="button"
        class="button button--secondary"
        onclick={requestRetryFailed}>重试失败项（{failedRetryCount}）</button
      >
      <small>仅重新采集上次读取失败或预算外的文件，并重新展示外发回执。</small>
    </div>
  {/if}

  {#if !hasResult && snapshot.state === "idle"}
    <!-- v0.1.5 V015-E：idle 空态→TaskEmptyState（补齐第三句：两个入口均可达）。 -->
    <TaskEmptyState
      icon="codicon-search"
      what="还没有分析结果"
      whyNormal="尚未开始分析，这是正常状态；本地检查与模型分析都不会修改文件。"
      whatNow="下一步可选择“只运行本地检查”，或“查看并开始分析 N 个文件”。"
      actions={[]}
      onAction={() => {}}
    />
  {:else}
    <section
      class="understanding-section"
      aria-label={understandingLabels.changes}
    >
      <h3>{understandingLabels.changes}</h3>
      {#if snapshot.changes.length > 0}
        <!-- v0.0.18 批次 D：逐条已看进度，不强迫线性流程。 -->
        <p class="understanding-muted" role="status">
          已看 {viewedCount}/{snapshot.changes.length} 条；可按任意顺序标记。
        </p>
      {/if}
      {#if snapshot.changes.length === 0}
        <p class="understanding-muted">没有可展示的变更陈述。</p>
      {:else}
        <ul class="understanding-list">
          {#each snapshot.changes as change (change.id)}
            <li
              class="understanding-item"
              class:understanding-item--toConfirm={change.status ===
                "toConfirm"}
              class:understanding-item--viewed={viewedChanges.has(change.id)}
            >
              <div class="understanding-item__head">
                <input
                  type="checkbox"
                  class="understanding-viewed-toggle"
                  aria-label={`标记已看：${change.statement}`}
                  checked={viewedChanges.has(change.id)}
                  onchange={() => toggleViewed(change.id)}
                />
                <span class="understanding-claim"
                  >{claimStatusLabels[change.status]}</span
                >
                <span class="understanding-source"
                  >{sourceLabels[change.source]}</span
                >
                <span class="understanding-item__text">{change.statement}</span>
              </div>
              {#if change.confidenceReason}<p class="understanding-reason">
                  {change.confidenceReason}
                </p>{/if}
              {#if change.limitations.length > 0}<p
                  class="understanding-limitation"
                >
                  限制：{change.limitations.join("；")}
                </p>{/if}
              {#if change.evidence.length > 0}
                <ul class="understanding-evidence" aria-label="变更证据">
                  {#each change.evidence as reference (reference.candidateId + (reference.hunkId ?? ""))}
                    <li>
                      {reference.projectRelativePath}{#if reference.hunkId}
                        · 差异块已验证{/if}
                      <button
                        type="button"
                        class="commit-suggestion__evidence-open"
                        disabled={snapshot.state === "stale"}
                        onclick={() => openEvidence(reference)}>打开差异</button
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if change.invalidEvidence.length > 0}
                <p class="understanding-limitation">
                  无效证据：{change.invalidEvidence
                    .map((item) => item.reason)
                    .join("；")}
                </p>
              {/if}
              {#if change.nextAction}<p class="understanding-next">
                  下一步：{change.nextAction}
                </p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section
      class="understanding-section"
      aria-label={understandingLabels.findings}
    >
      <h3>{understandingLabels.findings}</h3>
      {#if snapshot.findings.length === 0}
        <p class="understanding-muted">没有需要确认的风险。</p>
      {:else}
        <ul class="understanding-list">
          {#each snapshot.findings as finding (finding.id)}
            <li
              class="understanding-item"
              class:understanding-item--blocked={finding.category ===
                "local-blocked"}
            >
              <div class="understanding-item__head">
                <span class="status-badge status-badge--{finding.severity}"
                  >{findingCategoryLabels[finding.category]}</span
                >
                <span class="understanding-source"
                  >{sourceLabels[finding.source]}</span
                >
                <span class="understanding-item__text">{finding.statement}</span
                >
              </div>
              {#if finding.consequence}<p class="understanding-reason">
                  后果：{finding.consequence}
                </p>{/if}
              {#if finding.evidence.length > 0}
                <ul class="understanding-evidence" aria-label="发现证据">
                  {#each finding.evidence as reference (reference.candidateId + (reference.hunkId ?? ""))}
                    <li>
                      {reference.projectRelativePath}
                      <button
                        type="button"
                        class="commit-suggestion__evidence-open"
                        disabled={snapshot.state === "stale"}
                        onclick={() => openEvidence(reference)}>打开差异</button
                      >
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if finding.nextAction}<p class="understanding-next">
                  核对：{finding.nextAction}
                </p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section
      class="understanding-section"
      aria-label={understandingLabels.verification}
    >
      <h3>{understandingLabels.verification}</h3>
      {#if snapshot.verification.length === 0}
        <p class="understanding-muted">没有验证建议。</p>
      {:else}
        <ul class="understanding-list">
          {#each snapshot.verification as item (item.id)}
            <li class="understanding-item">
              <div class="understanding-item__head">
                <span class="understanding-source"
                  >{item.gate === "general" ? "通用门禁" : "本次特定"}</span
                >
                <span class="understanding-item__text">{item.title}</span>
              </div>
              <p class="understanding-reason">验证：{item.reason}</p>
              {#if item.command}<p class="understanding-command">
                  <code>{item.command}</code>
                </p>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if snapshot.userConfirmations.length > 0 || snapshot.draftProposal}
      <section
        class="understanding-section"
        aria-label={understandingLabels.draft}
      >
        <h3>{understandingLabels.draft}</h3>
        {#if snapshot.draftProposal}
          <div class="understanding-draft">
            <p class="understanding-reason">
              基于已确认事实生成提交说明建议（只读，不写入提交草稿）：
            </p>
            <pre class="commit-suggestion__body">{snapshot.draftProposal
                .message}</pre>
            <button
              type="button"
              class="button button--secondary"
              onclick={() =>
                onAction("open-module", {
                  moduleId: "changelists",
                  taskId: "changelists/manage",
                })}>按改动意图拆分（进入变更集）</button
            >
          </div>
        {:else}
          <p class="understanding-muted">
            确认至少一条事实后可生成提交说明建议。
          </p>
        {/if}
      </section>
    {/if}

    <section class="understanding-section" aria-label="会话内确认">
      <h3>会话内确认</h3>
      {#if snapshot.userConfirmations.length > 0}
        <ul class="understanding-list">
          {#each snapshot.userConfirmations as fact (fact.id)}
            <li
              class="understanding-item"
              class:understanding-item--toConfirm={fact.needsReview}
            >
              <div class="understanding-item__head">
                {#if fact.needsReview}
                  <span class="status-badge status-badge--warning"
                    >{understandingLabels.needsReview}</span
                  >
                {:else}
                  <span class="status-badge">{understandingLabels.user}</span>
                {/if}
                <span class="understanding-item__text">{fact.statement}</span>
              </div>
              {#if fact.needsReview}<p class="understanding-limitation">
                  工作副本已变化，此确认待复核；不会静默沿用。
                </p>{/if}
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="button button--secondary"
          onclick={clearConfirmations}>清除会话内确认</button
        >
      {/if}
      <div class="understanding-confirm-input">
        <input
          bind:value={confirmText}
          aria-label="输入要确认的事实"
          placeholder="记录一条你核对过的事实（仅当前会话有效）…"
          onkeydown={handleConfirmKeydown}
        />
        <button
          type="button"
          class="button button--primary"
          onclick={confirmFact}>确认</button
        >
      </div>
    </section>
  {/if}

  {#if snapshot.limitations.length > 0 || snapshot.warnings.length > 0}
    <section class="understanding-section" aria-label="限制与提醒">
      <h3>限制与提醒</h3>
      {#each [...snapshot.limitations, ...snapshot.warnings] as note, noteIndex (noteIndex)}
        <p class="understanding-limitation">{note}</p>
      {/each}
    </section>
  {/if}

  {#if pathDetail}
    <FilePathDetail
      detail={pathDetail}
      onCopyLocalPath={() =>
        onAction("file/copy-path", { relativePath: pathDetail.relativePath })}
    />
  {/if}
</ScrollArea>

<style>
  .understanding-layout {
    height: 100%;
    padding: 18px;
  }
  .understanding-safe-note {
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-section {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
  .understanding-empty {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 16px;
    color: var(--muted);
  }
  .understanding-muted {
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-list {
    display: grid;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .understanding-item {
    display: grid;
    gap: 3px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }
  /* v0.0.18 批次 D：已看条目轻微弱化；已看状态本身由勾选框表达，不只靠颜色。 */
  .understanding-item--viewed {
    opacity: 0.78;
  }
  .understanding-viewed-toggle {
    flex: 0 0 auto;
    align-self: flex-start;
    margin-top: 2px;
  }
  .understanding-item--blocked {
    border-left: 3px solid var(--danger);
  }
  .understanding-item--toConfirm {
    border-left: 3px solid var(--warning);
  }
  .understanding-item__head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .understanding-item__text {
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .understanding-claim,
  .understanding-source {
    flex: 0 0 auto;
    color: var(--muted);
    font-size: 10px;
  }
  .understanding-claim {
    padding: 0 6px;
    border-radius: 999px;
    color: var(--success);
    border: 1px solid color-mix(in srgb, var(--success) 45%, transparent);
  }
  .understanding-reason {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-limitation {
    margin: 0;
    color: var(--warning);
    font-size: 11px;
  }
  .understanding-next {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-evidence {
    display: grid;
    gap: 2px;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
  }
  .understanding-evidence li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-evidence .commit-suggestion__evidence-open {
    margin-left: auto;
  }
  .understanding-command {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .understanding-command code {
    padding: 1px 4px;
    border-radius: 3px;
    background: var(--surface-0);
  }
  .understanding-draft {
    display: grid;
    gap: 6px;
  }
  .understanding-confirm-input {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .understanding-confirm-input input {
    flex: 1;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-0);
    color: var(--vscode-foreground);
  }
  .understanding-retry {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }
  .understanding-retry small {
    color: var(--muted);
    font-size: 10px;
  }
</style>
