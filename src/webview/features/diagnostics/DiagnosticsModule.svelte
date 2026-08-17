<script lang="ts">
  import type {
    DiagnosticsSnapshot,
    WebviewAction,
    WorkbenchTaskId,
  } from "@protocol/workbenchProtocol";
  import ScrollArea from "../../components/ui/ScrollArea.svelte";
  import ResultCount from "../../components/list/ResultCount.svelte";
  import { formatZhDateTime } from "../../i18n/formatters";

  /*
   * v0.0.10 跨模块列表迁移：诊断列表提供“只看需要处理”、状态筛选、
   * 结果数量与复制单项；多根归属展示与验收清单结构保持不变。
   */

  let {
    snapshot,
    taskId = "diagnostics/environment",
    onAction,
  }: {
    snapshot: DiagnosticsSnapshot;
    taskId?: WorkbenchTaskId;
    onAction: (action: WebviewAction, data?: Record<string, unknown>) => void;
  } = $props();
  let expanded = $state<string | undefined>();
  let statusFilter = $state<
    "all" | "needsAttention" | "pass" | "warn" | "fail"
  >("all");
  const statusLabels = { pass: "通过", warn: "提醒", fail: "失败" };

  const visibleChecks = $derived(
    snapshot.checks.filter((check) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "needsAttention") return check.status !== "pass";
      return check.status === statusFilter;
    }),
  );

  function copyCheck(check: (typeof snapshot.checks)[number]): void {
    const lines = [
      `[${statusLabels[check.status]}] ${check.label}`,
      check.detail,
      check.action ? `建议：${check.action}` : undefined,
    ].filter((line): line is string => line !== undefined);
    onAction("copy-text", { text: lines.join("\n") });
  }
</script>

<section class="diagnostics-page">
  <header class="page-heading page-heading--actions">
    <div>
      <span class="eyebrow">运行状态与验收</span>
      <h1>
        {taskId === "diagnostics/acceptance" ? "人工验收清单" : "环境诊断"}
      </h1>
      <p>生成于 {formatZhDateTime(snapshot.generatedAt)}</p>
    </div>
    <div class="toolbar-actions">
      <button
        class="button button--secondary"
        onclick={() => onAction("diagnostics/show-output")}>查看输出</button
      ><button
        class="button button--primary"
        onclick={() => onAction("diagnostics/run")}>重新检查</button
      >
    </div>
  </header>

  <div class="settings-tabs" role="tablist" aria-label="诊断分类">
    <button
      role="tab"
      aria-selected={taskId === "diagnostics/environment"}
      class:active={taskId === "diagnostics/environment"}
      onclick={() =>
        onAction("open-module", {
          moduleId: "diagnostics",
          taskId: "diagnostics/environment",
        })}>运行环境</button
    >
    <button
      role="tab"
      aria-selected={taskId === "diagnostics/acceptance"}
      class:active={taskId === "diagnostics/acceptance"}
      onclick={() =>
        onAction("open-module", {
          moduleId: "diagnostics",
          taskId: "diagnostics/acceptance",
        })}>验收清单</button
    >
  </div>

  {#if taskId === "diagnostics/environment"}
    <div class="diagnostic-summary diagnostic-summary--{snapshot.status}">
      <span
        class={`codicon codicon-${snapshot.status === "pass" ? "pass-filled" : snapshot.status === "warn" ? "warning" : "error"}`}
        aria-hidden="true"
      ></span>
      <div>
        <strong>总体{statusLabels[snapshot.status]}</strong>
        <p>
          {snapshot.checks.filter((item) => item.status === "pass").length} 项通过，{snapshot.checks.filter(
            (item) => item.status !== "pass",
          ).length} 项需要关注。
        </p>
      </div>
    </div>

    <div class="diagnostics-layout diagnostics-layout--single">
      <section>
        <div class="section-heading">
          <div>
            <span class="eyebrow">环境检查</span>
            <h2>运行环境</h2>
          </div>
        </div>
        <div class="diagnostic-filter-bar" aria-label="诊断状态筛选">
          <button
            class:active={statusFilter === "needsAttention"}
            aria-pressed={statusFilter === "needsAttention"}
            onclick={() =>
              (statusFilter =
                statusFilter === "needsAttention" ? "all" : "needsAttention")}
            >只看需要处理</button
          >
          {#each ["all", "pass", "warn", "fail"] as value (value)}
            <button
              class:active={statusFilter === value}
              onclick={() => (statusFilter = value as typeof statusFilter)}
              >{value === "all"
                ? "全部"
                : statusLabels[value as keyof typeof statusLabels]}</button
            >
          {/each}
          <ResultCount count={visibleChecks.length} suffix="项检查" />
        </div>
        <ScrollArea class="diagnostic-list" label="环境检查项目">
          {#if visibleChecks.length === 0}
            <div class="mini-empty">
              {snapshot.checks.length === 0
                ? "尚未运行环境检查。"
                : "没有匹配状态的检查项；调整筛选后重试。"}
            </div>
          {/if}
          {#each visibleChecks as check (check.id)}
            <article class="diagnostic-row">
              <span
                class={`check-icon check-icon--${check.status}`}
                role="img"
                aria-label={statusLabels[check.status]}
                ><span
                  class={`codicon codicon-${check.status === "pass" ? "pass-filled" : check.status === "warn" ? "warning" : "error"}`}
                  aria-hidden="true"
                ></span></span
              >
              <div>
                <strong>{check.label}</strong>
                <p>{check.detail}</p>
                {#if check.action}<small>{check.action}</small>{/if}
              </div>
              <button
                type="button"
                class="icon-button icon-button--small"
                aria-label={`复制检查项 ${check.label}`}
                title="复制此项"
                onclick={() => copyCheck(check)}
                ><span class="codicon codicon-copy" aria-hidden="true"
                ></span></button
              >
            </article>
          {/each}
        </ScrollArea>
      </section>
    </div>
  {:else}
    <div class="diagnostics-layout diagnostics-layout--single">
      <section>
        <div class="section-heading">
          <div>
            <span class="eyebrow">验收步骤</span>
            <h2>人工验收清单</h2>
          </div>
          <span class="status-badge"
            >{snapshot.acceptance.summary.items} 项</span
          >
        </div>
        <div class="acceptance-facts">
          <span>{snapshot.acceptance.summary.sections} 个分组</span><span
            >{snapshot.acceptance.summary.steps} 个步骤</span
          ><span>{snapshot.acceptance.summary.expectedResults} 个期望</span>
        </div>
        <ScrollArea class="acceptance-list" label="人工验收项目">
          {#each snapshot.acceptance.sections as section (section.id)}
            <button
              class="acceptance-section"
              aria-expanded={expanded === section.id}
              onclick={() =>
                (expanded = expanded === section.id ? undefined : section.id)}
            >
              <span
                ><strong>{section.title}</strong><small
                  >{section.items.length} 项</small
                ></span
              ><span
                class={`codicon codicon-chevron-${expanded === section.id ? "up" : "down"}`}
                aria-hidden="true"
              ></span>
            </button>
            {#if expanded === section.id}
              <div class="acceptance-items">
                {#each section.items as item (item.id)}
                  <article>
                    <strong>{item.title}</strong>
                    <p>{item.description}</p>
                    <details>
                      <summary>步骤与期望</summary>
                      <ol>
                        {#each item.steps as step, stepIndex (`${item.id}:step:${stepIndex}`)}<li
                          >
                            {step}
                          </li>{/each}
                      </ol>
                      <ul>
                        {#each item.expected as expected, expectedIndex (`${item.id}:expected:${expectedIndex}`)}<li
                          >
                            {expected}
                          </li>{/each}
                      </ul>
                    </details>
                  </article>
                {/each}
              </div>
            {/if}
          {/each}
        </ScrollArea>
        <button
          class="button button--secondary copy-report"
          onclick={() => onAction("copy-text", { text: snapshot.reportText })}
          >复制诊断报告</button
        >
      </section>
    </div>
  {/if}
</section>
