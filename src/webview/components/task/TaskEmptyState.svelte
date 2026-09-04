<script lang="ts">
  /*
   * v0.1.5 V015-B TaskEmptyState：空状态三句话。
   * - 必须同时回答“发生了什么（what）/ 是否正常（whyNormal）/
   *   现在能做什么（whatNow）”：缺一句即在 DEV 下警告（渲染不补文案）。
   * - `role="status"` 温和播报；动作为透传 `onAction(action, data)`。
   * - 文案全部来自 props 或 terminology，组件内不生造领域文案。
   */
  import { taskSkeletonLabels } from "../../i18n/terminology";
  import type { TaskActionItem } from "./taskTypes";

  let {
    icon,
    what,
    whyNormal,
    whatNow,
    actions,
    onAction,
    ariaLabel,
  }: {
    /** 可选 codicon 类名，纯装饰并 `aria-hidden`。 */
    icon?: string;
    /** 发生了什么。 */
    what: string;
    /** 是否正常（为什么这是预期状态）。 */
    whyNormal: string;
    /** 现在能做什么（明确下一步）。 */
    whatNow: string;
    /** 恢复 / 快捷动作（透传，不拼接 action 名）。 */
    actions: TaskActionItem[];
    /** 动作透传：`onAction(action, data)`。 */
    onAction: (action: string, data?: Record<string, unknown>) => void;
    /** 可访问名称，缺省使用 terminology 默认值。 */
    ariaLabel?: string;
  } = $props();

  /** 三句缺一句即 DEV 警告：空态必须回答三要素。 */
  $effect(() => {
    if (typeof import.meta === "undefined" || !import.meta.env?.DEV) return;
    const missing: string[] = [];
    if (!what) missing.push("what（发生了什么）");
    if (!whyNormal) missing.push("whyNormal（是否正常）");
    if (!whatNow) missing.push("whatNow（现在能做什么）");
    if (missing.length > 0) {
      console.warn(`[TaskEmptyState] 空态三句话缺失：${missing.join("、")}。`);
    }
  });
</script>

<div
  class="task-empty-state"
  role="status"
  aria-label={ariaLabel ?? taskSkeletonLabels.emptyState}
>
  {#if icon}
    <span class="codicon {icon}" aria-hidden="true"></span>
  {/if}
  <div class="task-empty-state__body">
    <p class="task-empty-state__what">{what}</p>
    <p class="task-empty-state__why">{whyNormal}</p>
    <p class="task-empty-state__now">{whatNow}</p>
    {#if actions.length > 0}
      <div class="task-empty-state__actions" role="group" aria-label={whatNow}>
        {#each actions as item, index (index)}
          <button
            type="button"
            class={item.kind === "primary"
              ? "button button--primary"
              : "button button--secondary"}
            onclick={() => onAction(item.action, item.data)}
          >
            {#if item.icon}
              <span class="codicon {item.icon}" aria-hidden="true"></span>
            {/if}
            {item.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  /* 只用 VS Code 主题变量；High Contrast 下文字与图标均可辨。 */
  .task-empty-state {
    display: flex;
    align-items: flex-start;
    gap: var(--space-xs);
    padding: var(--space-sm);
    border: 1px dashed var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    font-size: 13px;
  }
  .task-empty-state__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .task-empty-state__what {
    margin: 0;
    font-weight: 600;
  }
  .task-empty-state__why,
  .task-empty-state__now {
    margin: 0;
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .task-empty-state__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xs);
    margin-top: 4px;
  }
</style>
