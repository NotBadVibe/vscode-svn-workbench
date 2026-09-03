<script lang="ts">
  /*
   * v0.1.5 V015-B TaskSummary：任务状态摘要（状态 / 原因 / 唯一下一步）。
   * - 约定：同一页面 `variant="full"` 最多使用 1 处，且只用于强状态
   *  （error / warning）；普通推荐一律使用紧凑 `compact`，避免首屏重复
   *   标题与范围信息。
   * - 状态不只靠颜色：文字 + 图标（icon 装饰，`aria-hidden`）+ tone 文案。
   * - `tone` 为 error / warning 时 `role="alert"`，否则 `role="status"`。
   * - `compact` 下超长文本截断（CSS 省略），完整值经 `title` 可查看。
   * - 文案全部来自 props 或 terminology，组件内不生造领域文案。
   */
  import { taskSkeletonLabels } from "../../i18n/terminology";

  /** 状态强弱：error / warning 走 `role="alert"` 并建议配 `variant="full"`。 */
  export type TaskSummaryTone = "info" | "success" | "warning" | "error";
  /** 展示形态：缺省 `compact`；`full` 为全宽强状态，同页最多 1 处。 */
  export type TaskSummaryVariant = "compact" | "full";

  let {
    status,
    reason,
    nextStep,
    icon,
    variant = "compact",
    tone = "info",
    ariaLabel,
  }: {
    /** 当前状态一句话（如“已生成预览，共 3 个文件”）。 */
    status: string;
    /** 为什么是这个状态（可选）。 */
    reason?: string;
    /** 唯一建议下一步（可选）。 */
    nextStep?: string;
    /** 可选 codicon 类名（如 `codicon-info`），纯装饰。 */
    icon?: string;
    /** 缺省 `compact`。 */
    variant?: TaskSummaryVariant;
    /** 缺省 `info`。 */
    tone?: TaskSummaryTone;
    /** 可访问名称，缺省使用 terminology 默认值。 */
    ariaLabel?: string;
  } = $props();

  const role = $derived(
    tone === "error" || tone === "warning" ? "alert" : "status",
  );
</script>

<div
  class="task-summary task-summary--{tone} task-summary--{variant}"
  {role}
  aria-label={ariaLabel ?? taskSkeletonLabels.summary}
>
  {#if icon}
    <span class="codicon {icon}" aria-hidden="true"></span>
  {/if}
  <div class="task-summary__body">
    <span
      class="task-summary__status"
      title={variant === "compact" ? status : undefined}
    >
      {status}
    </span>
    {#if reason}
      <span
        class="task-summary__reason"
        title={variant === "compact" ? reason : undefined}
      >
        {reason}
      </span>
    {/if}
    {#if nextStep}
      <span
        class="task-summary__next"
        title={variant === "compact" ? nextStep : undefined}
      >
        {nextStep}
      </span>
    {/if}
  </div>
</div>

<style>
  /* 只用 VS Code 主题变量，保证 Light / Dark / High Contrast 下可辨。 */
  .task-summary {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
    transition: border-color 120ms ease-in-out;
  }
  .task-summary--full {
    border-left-width: 4px;
  }
  .task-summary--info {
    border-left-color: var(--vscode-textLink-foreground);
  }
  .task-summary--success {
    border-left-color: var(--vscode-testing-iconPassed);
  }
  .task-summary--warning {
    border-left-color: var(--vscode-inputValidation-warningBorder);
  }
  .task-summary--error {
    border-left-color: var(--vscode-inputValidation-errorBorder);
  }
  .task-summary__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .task-summary__status {
    font-weight: 600;
  }
  .task-summary__reason,
  .task-summary__next {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
  /* compact 下超长截断 + title 查看完整值；full 不截断。 */
  .task-summary--compact .task-summary__status,
  .task-summary--compact .task-summary__reason,
  .task-summary--compact .task-summary__next {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (prefers-reduced-motion: reduce) {
    .task-summary {
      transition: none;
    }
  }
</style>
