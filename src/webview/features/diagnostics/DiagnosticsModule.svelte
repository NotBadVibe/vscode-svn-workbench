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
  // C-11：人工验收清单入口对普通用户隐藏，开发/测试环境保留
  const showAcceptance = $derived(import.meta.env.DEV);
  // C-10/C 四状态收敛：根据 svn-cli 与 workspace 检查结果展示主、次动作
  const firstRunState = $derived.by(() => {
    const svnCheck = snapshot.checks.find((c) => c.id === "svn-cli");
    const workspaceCheck = snapshot.checks.find((c) => c.id === "workspace");
    if (!svnCheck || !workspaceCheck) return null;
    if (svnCheck.status === "pass" && workspaceCheck.status === "pass") {
      return {
        title: "SVN 可用且当前目录是工作副本",
        detail: "可以开始查看修改、提交、更新与冲突处理。",
        primary: {
          label: "查看修改",
          action: "open-module" as const,
          params: { moduleId: "changes", taskId: "changes/overview" },
        },
        secondary: {
          label: "查看工作副本状态",
          action: "diagnostics/run" as const,
          params: {},
        },
      };
    }
    if (svnCheck.status === "fail" && svnCheck.detail.includes("未找到 svn")) {
      return {
        title: "SVN CLI 未找到",
        detail: "需要安装 SVN 或选择可执行文件路径。",
        primary: {
          label: "选择 SVN 可执行文件",
          action: "diagnostics/select-svn-executable" as const,
          params: {},
        },
        secondary: {
          label: "打开设置",
          action: "diagnostics/open-settings" as const,
          params: { query: "svnWorkbench.svn.path" },
        },
      };
    }
    if (
      svnCheck.status === "fail" &&
      svnCheck.detail.includes("未找到配置路径")
    ) {
      return {
        title: "路径无效或无权限",
        detail: "配置的 SVN 路径无法访问，请重新选择并检测。",
        primary: {
          label: "重新选择并检测",
          action: "diagnostics/select-svn-executable" as const,
          params: {},
        },
        secondary: {
          label: "复制诊断信息",
          action: "diagnostics/copy-diagnostics" as const,
          params: { text: snapshot.reportText },
        },
      };
    }
    if (
      workspaceCheck.status === "warn" &&
      workspaceCheck.detail.includes("均未检测到 SVN 工作副本")
    ) {
      return {
        title: "当前目录不是工作副本",
        detail: "请打开已有的 SVN 工作副本，或检出到新目录。",
        primary: {
          label: "打开文件夹",
          action: "diagnostics/open-folder" as const,
          params: {},
        },
        secondary: {
          label: "复制诊断信息",
          action: "diagnostics/copy-diagnostics" as const,
          params: { text: snapshot.reportText },
        },
      };
    }
    return null;
  });

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

  function handleDiagnosticAction(
    action: NonNullable<(typeof snapshot.checks)[number]["actions"]>[number],
  ): void {
    switch (action.id) {
      case "selectSvnExecutable":
        onAction("diagnostics/select-svn-executable", {});
        break;
      case "openSettings":
        onAction("diagnostics/open-settings", action.params ?? {});
        break;
      case "rerunDiagnostics":
        onAction("diagnostics/run", {});
        break;
      case "openFolder":
        onAction("diagnostics/open-folder", action.params ?? {});
        break;
      case "copyDiagnostics":
        onAction("diagnostics/copy-diagnostics", {
          text: snapshot.reportText,
          ...(action.params ?? {}),
        });
        break;
      case "openUrl":
        onAction("diagnostics/open-url", action.params ?? {});
        break;
      default:
        break;
    }
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
    {#if showAcceptance}
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
    {/if}
  </div>

  {#if taskId === "diagnostics/environment" || (taskId === "diagnostics/acceptance" && !showAcceptance)}
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
    {#if firstRunState}
      <div
        class="first-run-card"
        role="region"
        aria-label={firstRunState.title}
      >
        <h2>{firstRunState.title}</h2>
        <p>{firstRunState.detail}</p>
        <div class="first-run-actions">
          <button
            class="button button--primary"
            onclick={() =>
              onAction(
                firstRunState.primary.action as WebviewAction,
                firstRunState.primary.params,
              )}>{firstRunState.primary.label}</button
          >
          <button
            class="button button--secondary"
            onclick={() =>
              onAction(
                firstRunState.secondary.action as WebviewAction,
                firstRunState.secondary.params,
              )}>{firstRunState.secondary.label}</button
          >
          <button
            class="button button--secondary"
            onclick={() => onAction("diagnostics/run", {})}>重新检测</button
          >
          <button
            class="button button--secondary"
            onclick={() => onAction("copy-text", { text: snapshot.reportText })}
            >复制诊断信息</button
          >
        </div>
      </div>
    {/if}

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
                {#if check.actions}
                  <div class="diagnostic-actions">
                    {#each check.actions as action (action.id)}
                      <button
                        class="button button--secondary"
                        onclick={() => handleDiagnosticAction(action)}
                        >{action.label}</button
                      >
                    {/each}
                  </div>
                {/if}
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
  {:else if showAcceptance}
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
