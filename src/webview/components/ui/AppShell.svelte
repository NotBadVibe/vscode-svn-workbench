<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import type { WorkbenchState } from "../../app/workbenchState.svelte";
  import ScopeBar from "../svn/ScopeBar.svelte";
  import OnboardingStrip from "./OnboardingStrip.svelte";
  import { onboarding } from "../../app/onboarding.svelte";

  let {
    state: workbenchState,
    children,
  }: { state: WorkbenchState; children: Snippet } = $props();

  let now = $state(Date.now());
  const elapsedSeconds = $derived(
    workbenchState.progress
      ? Math.max(
          0,
          Math.floor((now - workbenchState.progress.startedAt) / 1000),
        )
      : 0,
  );

  /*
   * v0.0.17 批次 C（C-01/C-09）：全局推荐下一步带。Host 按最新候选状态
   * 统一生成，允许忽略；忽略仅本次会话内生效，且状态变化产生新 key 时
   * 重新展示（忽略不持久惩罚）。推荐只是推荐：点击只打开目标模块，
   * 不替用户执行、不扩大右键范围、不自动开始写操作。
   */
  let dismissedRecommendationKeys = $state<ReadonlySet<string>>(new Set());
  const visibleRecommendation = $derived.by(() => {
    const recommendation = workbenchState.scope?.recommendation;
    if (!recommendation) return undefined;
    if (dismissedRecommendationKeys.has(recommendation.key)) return undefined;
    return recommendation;
  });

  function dismissRecommendation(): void {
    const recommendation = workbenchState.scope?.recommendation;
    if (!recommendation) return;
    dismissedRecommendationKeys = new Set([
      ...dismissedRecommendationKeys,
      recommendation.key,
    ]);
  }

  /*
   * v0.0.18 批次 A（C-03）：引导第 1 步——进入工作台即完成；第 2 步在
   * Changes 模块看到候选文件时由 ChangesModule 埋点推进。
   */
  $effect(() => {
    if (workbenchState.connected && workbenchState.snapshot) {
      onboarding.recordStep("open-workbench");
    }
  });

  onMount(() => {
    const timer = window.setInterval(() => (now = Date.now()), 1000);
    return () => window.clearInterval(timer);
  });
</script>

<div class="workbench-shell">
  <main class="workbench-main">
    <ScopeBar
      scope={workbenchState.scope}
      taskId={workbenchState.taskId}
      onRefresh={() => workbenchState.action("refresh")}
      onSwitchProject={() => workbenchState.action("projects/switch")}
      onCopyText={(text) => workbenchState.action("copy-text", { text })}
    />
    {#if visibleRecommendation}
      <div
        class="recommendation-strip"
        role="status"
        aria-label="推荐下一步"
        data-recommendation-key={visibleRecommendation.key}
      >
        <span
          class="codicon codicon-lightbulb recommendation-strip__icon"
          aria-hidden="true"
        ></span>
        <div class="recommendation-strip__body">
          <strong>{visibleRecommendation.title}</strong>
          <span>{visibleRecommendation.reason}</span>
        </div>
        <button
          class="button button--primary"
          onclick={() =>
            workbenchState.openModule(
              visibleRecommendation.target.moduleId,
              visibleRecommendation.target.taskId,
            )}>{visibleRecommendation.actionLabel}</button
        >
        <button
          class="button button--secondary"
          aria-label="忽略此推荐"
          onclick={dismissRecommendation}>忽略</button
        >
      </div>
    {/if}
    {#if workbenchState.progress}
      <div class="progress-strip" role="status" aria-live="polite">
        <span class="loading-ring loading-ring--small" aria-hidden="true"
        ></span>
        <div class="progress-strip__content">
          <strong>{workbenchState.progress.title}</strong><span
            >阶段：{workbenchState.progress.stage ??
              workbenchState.progress.message ??
              "执行 SVN 命令"}</span
          ><span
            >范围：{workbenchState.progress.scope ??
              workbenchState.scope?.roots
                .map((root) => root.relativePath)
                .join("、") ??
              "当前范围"}</span
          ><span>已用时：{elapsedSeconds} 秒</span>
        </div>
        {#if workbenchState.progress.outputAvailable}<button
            class="button button--secondary"
            onclick={() => workbenchState.action("diagnostics/show-output")}
            >查看输出</button
          >{/if}
        {#if workbenchState.progress.cancellable}<button
            class="button button--secondary"
            onclick={() => workbenchState.action("operation/cancel")}
            >取消</button
          >{/if}
      </div>
    {/if}
    {#if workbenchState.notification}
      <div
        class={`result-strip result-strip--${workbenchState.notification.tone}`}
        role="status"
      >
        <span
          class={`codicon codicon-${workbenchState.notification.tone === "success" ? "pass-filled" : "warning"}`}
          aria-hidden="true"
        ></span><strong>{workbenchState.notification.title}</strong><span
          >{workbenchState.notification.message}</span
        >
      </div>
    {/if}
    <OnboardingStrip />
    <div class="workbench-content">
      {@render children()}
    </div>
  </main>
</div>
