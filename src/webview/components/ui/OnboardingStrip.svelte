<script lang="ts" module>
  import type { OnboardingBranch } from "../../app/onboarding.svelte";

  /** 只读导航目标：限定四个只读/处理模块，不含任何写操作。 */
  export interface OnboardingRecoveryTarget {
    moduleId: "history" | "update" | "conflicts" | "diagnostics";
    taskId: string;
    label: string;
  }

  /*
   * V024-R41：分支恢复目标（仅只读/处理模块导航，不含任何写操作）。
   * 导出供测试断言“恢复动作永不指向写操作”。
   */
  export const RECOVERY_TARGETS: Record<
    OnboardingBranch,
    OnboardingRecoveryTarget[]
  > = {
    clean: [
      { moduleId: "history", taskId: "history/revisions", label: "查看历史" },
      { moduleId: "update", taskId: "update/preview", label: "检查远端更新" },
    ],
    modified: [],
    conflict: [
      {
        moduleId: "conflicts",
        taskId: "conflicts/resolve",
        label: "处理冲突",
      },
    ],
    "non-svn": [
      {
        moduleId: "diagnostics",
        taskId: "diagnostics/environment",
        label: "打开环境诊断",
      },
    ],
    "cli-missing": [
      {
        moduleId: "diagnostics",
        taskId: "diagnostics/environment",
        label: "打开环境诊断",
      },
    ],
  };
</script>

<script lang="ts">
  import {
    ONBOARDING_BRANCH_COPY,
    ONBOARDING_STEPS,
    nextRequiredStep,
    onboarding,
    requiredStepsForBranch,
  } from "../../app/onboarding.svelte";

  /*
   * v0.0.18 批次 A（C-03）：三分钟闭环引导条。复用真实任务窗口，步骤
   * 推进由真实交互驱动；最后一步只做说明，不出现任何执行提交的按钮。
   * 可跳过；完成/跳过后引导条完全隐藏（无痕），重新打开走命令面板
   * “SVN：打开新手引导”（svnWorkbench.openGuide）。
   *
   * V024-R41：按工作副本状态分支展示。当前展示步骤 = 分支必需序列中首个
   * 仍未达到的步骤（随状态变化重新计算）；恢复按钮只做只读模块导航
   * （open-module 到历史/更新/冲突/诊断），不发起任何 SVN 调用与写操作。
   */

  let {
    branch,
    onNavigate,
  }: {
    /** 未传时跟随 onboarding store 的实时分支。 */
    branch?: OnboardingBranch;
    /** 只读导航回调（测试可注入断言）；不传则不渲染恢复按钮。 */
    onNavigate?: (target: OnboardingRecoveryTarget) => void;
  } = $props();

  const effectiveBranch = $derived(branch ?? onboarding.branch);
  const copy = $derived(ONBOARDING_BRANCH_COPY[effectiveBranch]);
  const required = $derived(requiredStepsForBranch(effectiveBranch));
  /*
   * 完成/跳过后无痕隐藏（沿用 store.active 语义）：分支只决定“显示哪一步”，
   * 不复活已结束的引导；跳过后不自动再次打开，重开走 restart。
   */
  const nextId = $derived(
    onboarding.active
      ? nextRequiredStep(onboarding.state, effectiveBranch)
      : undefined,
  );
  const step = $derived(
    nextId ? ONBOARDING_STEPS.find((item) => item.id === nextId) : undefined,
  );
  const stepNumber = $derived(
    step ? required.indexOf(step.id) + 1 : required.length,
  );
  const isLastStep = $derived(step?.id === "before-confirm");
  const recoveryTargets = $derived(RECOVERY_TARGETS[effectiveBranch]);
</script>

{#if step}
  <div
    class="onboarding-strip"
    role="region"
    aria-label="新手引导"
    data-onboarding-step={step.id}
    data-onboarding-branch={effectiveBranch}
  >
    <span
      class="codicon codicon-rocket onboarding-strip__icon"
      aria-hidden="true"
    ></span>
    <div class="onboarding-strip__body">
      <span class="onboarding-strip__progress" role="status"
        >引导步骤 {stepNumber}/{required.length}：{step.title}</span
      >
      <p>{step.description}</p>
      <p>{copy.statusLine} {copy.nextAction}</p>
    </div>
    <div class="onboarding-strip__actions">
      {#if onNavigate}
        {#each recoveryTargets as target (target.taskId)}
          <button
            class="button button--secondary"
            onclick={() => onNavigate?.(target)}>{target.label}</button
          >
        {/each}
      {/if}
      {#if isLastStep}
        <button
          class="button button--primary"
          onclick={() => onboarding.finish()}>完成引导（未执行任何提交）</button
        >
      {/if}
      <button class="button button--secondary" onclick={() => onboarding.skip()}
        >跳过引导</button
      >
    </div>
  </div>
{/if}
