<script lang="ts">
  import { ONBOARDING_STEPS, onboarding } from "../../app/onboarding.svelte";

  /*
   * v0.0.18 批次 A（C-03）：三分钟闭环引导条。复用真实任务窗口，步骤
   * 推进由真实交互驱动；最后一步只做说明，不出现任何执行提交的按钮。
   * 可跳过；完成/跳过后引导条完全隐藏（无痕），重新打开走命令面板
   * “SVN：打开新手引导”（svnWorkbench.openGuide）。
   */
  const step = $derived(onboarding.currentStep);
  const stepNumber = $derived(
    step ? onboarding.state.completedSteps + 1 : ONBOARDING_STEPS.length,
  );
  const isLastStep = $derived(
    step?.id === "before-confirm" ||
      onboarding.state.completedSteps === ONBOARDING_STEPS.length - 1,
  );
</script>

{#if step}
  <div
    class="onboarding-strip"
    role="region"
    aria-label="新手引导"
    data-onboarding-step={step.id}
  >
    <span
      class="codicon codicon-rocket onboarding-strip__icon"
      aria-hidden="true"
    ></span>
    <div class="onboarding-strip__body">
      <span class="onboarding-strip__progress" role="status"
        >引导步骤 {stepNumber}/{ONBOARDING_STEPS.length}：{step.title}</span
      >
      <p>{step.description}</p>
    </div>
    <div class="onboarding-strip__actions">
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
