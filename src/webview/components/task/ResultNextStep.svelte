<script lang="ts">
  /*
   * v0.1.5 V015-B ResultNextStep：结果出口（发生了什么 / 下一步 / 恢复）。
   * - 成功提示先给结果再给下一步；`tone` 为 success 时 `role="status"`，
   *   为 error 时 `role="alert"`（其余 tone 同 success，走 `status` 播报）。
   * - 本组件不 import 任何 Host 模块、不拼接协议 action 名称：点击只经
   *   `onAction(action, data)` 原样透传，由页面决定映射到哪个 Host 动作。
   * - `actions` 约定为 1 个 primary + 最多 2 个 secondary：缺 primary、
   *   多 primary 或 secondary 超限时在 DEV 下警告，同时渲染溢出提示
   *   （v0.1.6 V016-F1：不再静默取首/截断，渲染侧只缩小不扩大）。
   * - 文案全部来自 props 或 terminology，组件内不生造领域文案。
   */
  import {
    taskExtraPrimaryLabel,
    taskSecondaryOverflowLabel,
    taskSkeletonLabels,
  } from "../../i18n/terminology";
  import type { TaskActionItem } from "./taskTypes";

  /** 结果出口动作：`action` 为不透明标识，只透传不解释。 */
  export type ResultAction = TaskActionItem;
  /** 结果语气：success → status，error → alert。 */
  export type ResultNextStepTone = "success" | "info" | "warning" | "error";

  let {
    tone,
    result,
    nextStep,
    recoveryHint,
    actions,
    onAction,
    ariaLabel,
  }: {
    /** 结果语气。 */
    tone: ResultNextStepTone;
    /** 发生了什么（结果先行）。 */
    result: string;
    /** 明确下一步（与当前来路相关，不使用通用“完成”）。 */
    nextStep: string;
    /** 适用恢复出口说明（可选）。 */
    recoveryHint?: string;
    /** 1 个 primary + 最多 2 个 secondary。 */
    actions: ResultAction[];
    /** 动作透传：`onAction(action, data)`，不拼接、不改写。 */
    onAction: (action: string, data?: Record<string, unknown>) => void;
    /** 可访问名称，缺省使用 terminology 默认值。 */
    ariaLabel?: string;
  } = $props();

  const role = $derived(tone === "error" ? "alert" : "status");

  const primaryAction = $derived(
    actions.find((item) => item.kind === "primary"),
  );
  const secondaryActions = $derived(
    actions.filter((item) => item.kind !== "primary").slice(0, 2),
  );
  /** v0.1.6 V016-F1：多 primary 只取首个、secondary 超限截断时给出文字提示。 */
  const extraPrimaryCount = $derived(
    actions.filter((item) => item.kind === "primary").length > 1
      ? actions.filter((item) => item.kind === "primary").length - 1
      : 0,
  );
  const secondaryOverflow = $derived(
    actions.filter((item) => item.kind !== "primary").length > 2
      ? actions.filter((item) => item.kind !== "primary").length - 2
      : 0,
  );
  $effect(() => {
    if (typeof import.meta === "undefined" || !import.meta.env?.DEV) return;
    if (!primaryAction) {
      console.warn("[ResultNextStep] 缺少 kind=primary 的主动作。");
    }
    if (extraPrimaryCount > 0) {
      console.warn(
        "[ResultNextStep] primary 动作只能有 1 个，已取首个，其余未显示。",
      );
    }
    if (actions.filter((item) => item.kind !== "primary").length > 2) {
      console.warn("[ResultNextStep] secondary 动作最多 2 个，已截断。");
    }
  });
</script>

<div
  class="result-next-step result-next-step--{tone}"
  {role}
  aria-label={ariaLabel ?? taskSkeletonLabels.result}
>
  <p class="result-next-step__result">{result}</p>
  <p class="result-next-step__next">{nextStep}</p>
  {#if recoveryHint}
    <p class="result-next-step__recovery">{recoveryHint}</p>
  {/if}
  <div class="result-next-step__actions" role="group" aria-label={result}>
    {#if primaryAction}
      <button
        type="button"
        class="button button--primary"
        onclick={() => onAction(primaryAction.action, primaryAction.data)}
      >
        {#if primaryAction.icon}
          <span class="codicon {primaryAction.icon}" aria-hidden="true"></span>
        {/if}
        {primaryAction.label}
      </button>
    {/if}
    {#each secondaryActions as item, index (index)}
      <button
        type="button"
        class="button button--secondary"
        onclick={() => onAction(item.action, item.data)}
      >
        {#if item.icon}
          <span class="codicon {item.icon}" aria-hidden="true"></span>
        {/if}
        {item.label}
      </button>
    {/each}
    {#if extraPrimaryCount > 0}
      <span class="result-next-step__overflow" role="status"
        >{taskExtraPrimaryLabel(extraPrimaryCount)}</span
      >
    {/if}
    {#if secondaryOverflow > 0}
      <span class="result-next-step__overflow" role="status"
        >{taskSecondaryOverflowLabel(secondaryOverflow)}</span
      >
    {/if}
  </div>
</div>

<style>
  /* 只用 VS Code 主题变量；状态同时用文字与图标，不只靠颜色。 */
  .result-next-step {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
    transition: border-color 120ms ease-in-out;
  }
  .result-next-step--success {
    border-left: 4px solid var(--vscode-testing-iconPassed);
  }
  .result-next-step--info {
    border-left: 4px solid var(--vscode-textLink-foreground);
  }
  .result-next-step--warning {
    border-left: 4px solid var(--vscode-inputValidation-warningBorder);
  }
  .result-next-step--error {
    border-left: 4px solid var(--vscode-inputValidation-errorBorder);
  }
  .result-next-step__result {
    margin: 0;
    font-weight: 600;
  }
  .result-next-step__next,
  .result-next-step__recovery {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .result-next-step__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-top: 4px;
  }
  .result-next-step__overflow {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  @media (prefers-reduced-motion: reduce) {
    .result-next-step {
      transition: none;
    }
  }
</style>
