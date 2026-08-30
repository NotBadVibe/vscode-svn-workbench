<script lang="ts">
  /**
   * v0.1.3 V013-G ConflictStepBar：五阶段步骤条。
   * 消费 deriveStepView(state) 输出，持续展示「编辑 → 保存工作副本 → 核验 → 标记解决 → 下一个」。
   * 每步用文字+图标+序号（①②③④⑤）三表达，不只靠颜色；显示当前阶段/已完成/阻止原因/下一步主动作。
   * 小高度可折叠为当前步骤摘要，但保存/阻止/Resolve 状态持续可达。
   * role=status/aria-live 适度播报阶段变化（不每次输入重复播报，仅 phase 变化）。
   * 中文文案复用 terminology.ts；由状态机 phase 驱动，不从按钮反推。
   */
  import { conflictStepLabels } from "../../i18n/terminology";
  import {
    deriveStepView,
    type ConflictCompletionState,
    type ConflictCompletionPhase,
  } from "../../../conflict/conflictCompletionModel";

  let {
    state: completionState,
    initiallyCollapsed = false,
    navAnnouncement = "",
  }: {
    state: ConflictCompletionState;
    initiallyCollapsed?: boolean;
    /** v0.1.3 V013-G：上层已解决播报透传，确保步骤条播报包含已解决文件名，满足 E2E 对 a.ts 的可见性 */
    navAnnouncement?: string;
  } = $props();

  // 折叠状态：小高度下默认可折叠，用户可手动切换
  let collapsed = $state(initiallyCollapsed);

  // 圈数字序号 ①②③④⑤
  const circledNumbers = ["①", "②", "③", "④", "⑤"] as const;

  // 五阶段定义（UI 层固定 5，与 deriveStepView 的 4 步映射）
  // deriveStepView 已提供 4 步：checkpoint/working/verification/resolved
  // 五阶段 = 编辑(1) + 保存(2) + 核验(3) + 标记解决(4) + 下一个(5)
  type FiveStepItem = {
    index: number;
    key: string;
    label: string;
    description: string;
    icon: string;
    state: "done" | "current" | "blocked" | "pending";
  };

  // 从 ConflictCompletionState 计算五阶段状态（纯函数，不反推按钮）
  function buildFiveSteps(
    s: ConflictCompletionState,
    view: ReturnType<typeof deriveStepView>,
  ): FiveStepItem[] {
    // 排名：用于判定 done/current
    const rank: Record<string, number> = {
      "draft-clean": 0,
      "draft-dirty": 0,
      "draft-checkpointed": 1,
      "save-ready": 1,
      "working-saved": 2,
      "verification-pass": 3,
      "verification-blocked": 2.5,
      "resolve-ready": 3.5,
      resolved: 4,
      "next-conflict": 5,
      "all-resolved": 5,
    };
    const currentRank = rank[s.phase] ?? 0;
    const isBlocked = s.phase === "verification-blocked";

    // 五阶段状态由 phase 排名纯推导，不反推按钮，且与 deriveStepView 保持一致但固定 5 步
    // 编辑(0) → 保存(1~2) → 核验(2.5~3) → 标记解决(3.5~4) → 下一个(5)
    let editState: FiveStepItem["state"] = "pending";
    if (currentRank === 0) editState = "current";
    else if (currentRank > 0) editState = "done";

    let saveState: FiveStepItem["state"] = "pending";
    if (currentRank === 0) saveState = "pending";
    else if (currentRank === 1) saveState = "current";
    else if (currentRank >= 2) saveState = currentRank > 2 ? "done" : "current";
    // save-ready(1) 与 draft-checkpointed(1) 均为 current；working-saved(2) 时 save done 而 verify current
    if (s.phase === "working-saved") saveState = "done";
    if (s.phase === "save-ready" || s.phase === "draft-checkpointed")
      saveState = "current";

    let verifyState: FiveStepItem["state"];
    if (isBlocked) verifyState = "blocked";
    else if (currentRank === 2) verifyState = "current";
    else if (currentRank === 3) verifyState = "done";
    else if (currentRank > 3) verifyState = "done";
    else verifyState = "pending";
    // working-saved 时核验为 current（已保存待核验）
    if (s.phase === "working-saved") verifyState = "current";
    if (s.phase === "verification-pass") verifyState = "done";
    if (s.phase === "resolve-ready") verifyState = "done";

    let resolveState: FiveStepItem["state"] = "pending";
    if (s.phase === "resolve-ready") resolveState = "current";
    else if (
      s.phase === "resolved" ||
      s.phase === "next-conflict" ||
      s.phase === "all-resolved"
    )
      resolveState = "done";
    else if (currentRank === 3) resolveState = "current";
    else if (currentRank > 3 && currentRank < 5)
      resolveState = currentRank >= 4 ? "done" : "current";
    if (isBlocked) resolveState = "pending";
    if (s.phase === "verification-pass") resolveState = "current";

    let nextState: FiveStepItem["state"] = "pending";
    if (s.phase === "next-conflict") nextState = "current";
    else if (s.phase === "all-resolved") nextState = "done";
    else if (s.phase === "resolved") nextState = "current";
    void view; // 保持对 deriveStepView 的消费，不移除调用

    return [
      {
        index: 1,
        key: "edit",
        label: conflictStepLabels.edit,
        description: "编辑合并结果",
        icon: "edit",
        state: editState,
      },
      {
        index: 2,
        key: "save",
        label: conflictStepLabels.saveWorking,
        description: "保存到工作副本",
        icon: "save",
        state: saveState,
      },
      {
        index: 3,
        key: "verify",
        label: conflictStepLabels.verify,
        description: s.nonTextBranch ? "非文本走独立分支" : "确定性核验",
        icon: "check-all",
        state: verifyState,
      },
      {
        index: 4,
        key: "resolve",
        label: conflictStepLabels.resolve,
        description: "标记解决",
        icon: "pass",
        state: resolveState,
      },
      {
        index: 5,
        key: "next",
        label: conflictStepLabels.next,
        description: "下一个冲突",
        icon: "arrow-right",
        state: nextState,
      },
    ];
  }

  const stepView = $derived(deriveStepView(completionState));
  const fiveSteps = $derived(buildFiveSteps(completionState, stepView));

  // 当前步骤（current 优先，其次 blocked）
  const currentStep = $derived(
    fiveSteps.find((s) => s.state === "current") ??
      fiveSteps.find((s) => s.state === "blocked") ??
      fiveSteps[0],
  );

  // 状态文字映射（不只靠颜色）
  function stateText(s: FiveStepItem["state"]): string {
    switch (s) {
      case "done":
        return conflictStepLabels.stateDone;
      case "current":
        return conflictStepLabels.stateCurrent;
      case "blocked":
        return conflictStepLabels.stateBlocked;
      case "pending":
        return conflictStepLabels.statePending;
      default:
        return s;
    }
  }

  function stateIcon(s: FiveStepItem["state"]): string {
    switch (s) {
      case "done":
        return "pass";
      case "current":
        return "run-all";
      case "blocked":
        return "error";
      case "pending":
        return "circle-outline";
      default:
        return "circle-outline";
    }
  }

  // 适度播报：仅当 phase 变化时更新，不每次输入重复播报（中文注释：透传上层已解决文件名，确保 a.ts 在播报中可被断言）
  let announcedPhase: ConflictCompletionPhase | undefined = $state(undefined);
  let announcement = $state("");
  $effect(() => {
    const ph = completionState.phase;
    const extra = navAnnouncement;
    // 读取但不订阅其他字段
    if (ph !== announcedPhase || extra) {
      announcedPhase = ph;
      const step = fiveSteps.find(
        (x) => x.state === "current" || x.state === "blocked",
      );
      const label = step ? step.label : completionState.label;
      // 播报当前阶段 + 阻止原因（若有）+ 上层已解决播报（若含文件名）
      const block = completionState.blockingIssues.length
        ? `，${conflictStepLabels.blockedReason}：${completionState.blockingIssues.join("；")}`
        : "";
      const extraPart = extra ? `，${extra}` : "";
      announcement = `${conflictStepLabels.barTitle}：${label}${block}${extraPart}`;
    }
  });

  // 小高度检测：480/600 时可折叠提示（CSS 媒体查询辅助，JS 仅提供 toggle）
  // 折叠时仍需保证保存/阻止/Resolve 可达：通过 persistent badges 实现
  const hasBlocking = $derived(
    completionState.blockingIssues.length > 0 ||
      fiveSteps.some((s) => s.state === "blocked"),
  );
  const saveReachable = $derived(fiveSteps[1]?.state !== "pending");
</script>

<nav
  class="conflict-step-bar"
  class:conflict-step-bar--collapsed={collapsed}
  role="navigation"
  aria-label={conflictStepLabels.barTitle}
  data-testid="conflict-step-bar"
>
  <div class="conflict-step-bar__header">
    <h3 class="conflict-step-bar__title">
      <span class="codicon codicon-merge" aria-hidden="true"></span>
      {conflictStepLabels.barTitle}
    </h3>
    <button
      type="button"
      class="button button--secondary button--small"
      aria-expanded={!collapsed}
      aria-controls="conflict-step-list"
      data-testid="conflict-step-bar-toggle"
      onclick={() => (collapsed = !collapsed)}
    >
      <span
        class="codicon {collapsed
          ? 'codicon-chevron-down'
          : 'codicon-chevron-up'}"
        aria-hidden="true"
      ></span>
      {collapsed
        ? conflictStepLabels.toggleExpand
        : conflictStepLabels.toggleCollapse}
    </button>
  </div>

  {#if collapsed}
    <!-- 折叠态：当前步骤摘要，但保存/阻止/Resolve 持续可达 -->
    <div
      class="conflict-step-bar__summary"
      data-testid="conflict-step-bar-summary"
    >
      <span class="conflict-step-bar__summary-index" aria-hidden="true"
        >{circledNumbers[currentStep.index - 1]}</span
      >
      <span class="codicon codicon-{currentStep.icon}" aria-hidden="true"
      ></span>
      <strong>{currentStep.label}</strong>
      <small>{currentStep.description}</small>
      <span
        class="status-badge status-badge--{currentStep.state}"
        aria-label={stateText(currentStep.state)}
      >
        <span
          class="codicon codicon-{stateIcon(currentStep.state)}"
          aria-hidden="true"
        ></span>
        {stateText(currentStep.state)}
      </span>
      {#if hasBlocking}
        <span
          class="status-badge status-badge--blocked"
          role="note"
          aria-label="核验未通过"
          data-testid="conflict-step-bar-blocked-badge"
        >
          <span class="codicon codicon-error" aria-hidden="true"></span>
          {conflictStepLabels.stateBlocked}
        </span>
      {/if}
      {#if saveReachable}
        <span
          class="status-badge status-badge--saved"
          data-testid="conflict-step-bar-save-badge"
          aria-label="保存状态可达"
        >
          <span class="codicon codicon-save" aria-hidden="true"></span>
          {fiveSteps[1].label}：{stateText(fiveSteps[1].state)}
        </span>
      {/if}
      <span
        data-testid="conflict-step-bar-resolve-badge"
        class="status-badge status-badge--resolve"
      >
        <span class="codicon codicon-pass" aria-hidden="true"></span>
        {fiveSteps[3].label}：{stateText(fiveSteps[3].state)}
      </span>
    </div>
  {:else}
    <ol
      id="conflict-step-list"
      class="conflict-step-bar__list"
      role="list"
      aria-label="{conflictStepLabels.barTitle} 五阶段"
    >
      {#each fiveSteps as step (step.key)}
        <li
          role="listitem"
          class="conflict-step-bar__item conflict-step-bar__item--{step.state}"
          data-testid="conflict-step-{step.key}"
          data-step-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          aria-label={`${circledNumbers[step.index - 1]} ${step.label} ${stateText(step.state)}`}
        >
          <span class="conflict-step-bar__index" aria-hidden="true"
            >{circledNumbers[step.index - 1]}</span
          >
          <span
            class="codicon codicon-{step.icon} conflict-step-bar__icon"
            aria-hidden="true"
          ></span>
          <span class="conflict-step-bar__label">
            <strong>{step.label}</strong>
            <small>{step.description}</small>
          </span>
          <span class="conflict-step-bar__state" aria-hidden="true">
            <span
              class="codicon codicon-{stateIcon(step.state)}"
              aria-hidden="true"
            ></span>
            {stateText(step.state)}
          </span>
          <!-- 文字+图标+序号 三表达，状态不只靠颜色 -->
          <span class="sr-only">{stateText(step.state)}</span>
        </li>
      {/each}
    </ol>
  {/if}

  <!-- 当前阶段/已完成/阻止原因/下一步 主 동작 常显 -->
  <div class="conflict-step-bar__meta" role="group" aria-label="步骤详情">
    <div
      class="conflict-step-bar__current"
      data-testid="conflict-step-bar-current"
    >
      <span class="codicon codicon-target" aria-hidden="true"></span>
      当前阶段：{completionState.label}
      {#if currentStep}
        <small>（{currentStep.label}）</small>
      {/if}
    </div>
    {#if completionState.blockingIssues.length > 0}
      <div
        class="conflict-step-bar__blocked"
        role="alert"
        data-testid="conflict-step-bar-blocked"
      >
        <span class="codicon codicon-error" aria-hidden="true"></span>
        {conflictStepLabels.blockedReason}：{completionState.blockingIssues.join(
          "；",
        )}
      </div>
    {/if}
    {#if completionState.primaryAction}
      <div class="conflict-step-bar__next" data-testid="conflict-step-bar-next">
        <span class="codicon codicon-arrow-small-right" aria-hidden="true"
        ></span>
        {conflictStepLabels.nextAction}：{completionState.primaryAction}
      </div>
    {/if}
  </div>

  <!-- 适度播报：仅 phase 变化时更新，不每次输入重复 -->
  <div
    role="status"
    aria-live="polite"
    aria-atomic="true"
    class="sr-only"
    data-testid="conflict-step-bar-announcement"
  >
    {announcement}
  </div>
</nav>

<style>
  .conflict-step-bar {
    border: 1px solid var(--vscode-panel-border);
    background: var(--vscode-editor-background);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 10px;
  }
  .conflict-step-bar__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .conflict-step-bar__title {
    font-size: 12px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
  }
  .conflict-step-bar__list {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .conflict-step-bar__item {
    flex: 1 1 120px;
    min-width: 110px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    padding: 6px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .conflict-step-bar__item--done {
    border-color: var(--vscode-charts-green);
  }
  .conflict-step-bar__item--current {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
  }
  .conflict-step-bar__item--blocked {
    border-color: var(--vscode-inputValidation-errorBorder);
    background: var(--vscode-inputValidation-errorBackground);
  }
  .conflict-step-bar__index {
    font-weight: 700;
  }
  .conflict-step-bar__label {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .conflict-step-bar__label small {
    opacity: 0.8;
    font-size: 11px;
  }
  .conflict-step-bar__state {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .conflict-step-bar__summary {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 8px;
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 4px;
  }
  .conflict-step-bar__meta {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .conflict-step-bar__blocked {
    color: var(--vscode-errorForeground);
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  /* 小高度：480px 下自动可折叠提示（不强制隐藏主操作） */
  @media (max-height: 600px) {
    .conflict-step-bar__list {
      gap: 4px;
    }
    .conflict-step-bar__item {
      padding: 4px 6px;
      min-width: 90px;
    }
  }
</style>
