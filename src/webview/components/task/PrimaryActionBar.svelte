<script lang="ts">
  /*
   * v0.1.5 V015-B PrimaryActionBar：唯一主动作 + 有限次级动作。
   * - `primary` 为类型级单个对象，保证同页只有一个主操作（primary 唯一性）。
   * - `secondary` 最多 2 个：超出部分截断并在 DEV 下警告（只缩小不扩大）。
   * - `busy` / `stale` 时 primary 强制禁用，并用 `role="status"` 文字播报，
   *   stale 下点击不触发回调（旧预览 / 旧 token 不得继续可用）。
   * - 中文 IME 保护：复用 `keyboard.ts` 的 `isImeComposing` 模式，
   *   `compositionstart → Enter → compositionend` 序列中 Enter 不触发。
   * - 本组件零 `position: sticky` / `overflow`：滚动归属由页面显式声明。
   * - 布局约束：`role="toolbar"`，按钮原生可聚焦，无焦点陷阱。
   */
  import { isImeComposing } from "../../i18n/keyboard";
  import { taskSkeletonLabels } from "../../i18n/terminology";
  import type { TaskBarAction } from "./taskTypes";

  let {
    primary,
    secondary = [],
    countText,
    busy = false,
    busyText,
    stale = false,
    staleText,
    ariaLabel,
  }: {
    /** 唯一主动作（类型级单个对象，不接受数组）。 */
    primary: TaskBarAction;
    /** 次级动作，最多 2 个，超出截断。 */
    secondary?: TaskBarAction[];
    /** 数量说明（如“已选择 2/5 个文件”），与主动作数量口径一致。 */
    countText?: string;
    /** 执行中：primary 禁用 + 状态播报。 */
    busy?: boolean;
    /** 执行中文案，缺省使用 terminology 默认值。 */
    busyText?: string;
    /** 已过期：primary 禁用 + 状态播报，点击不触发。 */
    stale?: boolean;
    /** 过期文案，缺省使用 terminology 默认值。 */
    staleText?: string;
    /** 工具栏可访问名称，缺省使用 terminology 默认值。 */
    ariaLabel?: string;
  } = $props();

  /** 候选阶段标记：`oncompositionstart/end` 跟踪（OperationIntentDialog 同模式）。 */
  let isComposing = $state(false);

  /** 次级动作上限 2 个：超出截断，DEV 下警告（只缩小不扩大）。 */
  const visibleSecondary = $derived(secondary.slice(0, 2));
  $effect(() => {
    if (
      typeof import.meta !== "undefined" &&
      import.meta.env?.DEV &&
      secondary.length > 2
    ) {
      console.warn(
        `[PrimaryActionBar] secondary 最多 2 个，已截断（收到 ${secondary.length} 个）。`,
      );
    }
  });

  /** busy / stale 时 primary 强制禁用（页面侧 `disabled` 只可再收紧）。 */
  const primaryDisabled = $derived(busy || stale || primary.disabled === true);
  const primaryTitle = $derived(
    stale
      ? (staleText ?? taskSkeletonLabels.staleFallback)
      : (primary.disabledReason ?? undefined),
  );

  /** busy / stale 的文字播报（`role="status"`，不只靠禁用态颜色）。 */
  const statusText = $derived(
    stale
      ? (staleText ?? taskSkeletonLabels.staleFallback)
      : busy
        ? (busyText ?? taskSkeletonLabels.busyFallback)
        : undefined,
  );

  /** IME 候选阶段 Enter 不触发（与 `isImeComposing` 双保险）。 */
  function guardComposingKey(event: KeyboardEvent): boolean {
    if (isComposing || isImeComposing(event)) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  function handlePrimaryClick(): void {
    // stale / busy / 候选阶段的点击一律不触发（fail-closed）。
    if (isComposing || busy || stale) return;
    primary.onClick();
  }

  function handleSecondaryClick(item: TaskBarAction): void {
    if (isComposing) return;
    item.onClick();
  }
</script>

<div
  class="primary-action-bar"
  role="toolbar"
  aria-label={ariaLabel ?? taskSkeletonLabels.actionBar}
  oncompositionstart={() => (isComposing = true)}
  oncompositionend={() => (isComposing = false)}
>
  {#if countText}
    <span class="primary-action-bar__count">{countText}</span>
  {/if}
  <span class="primary-action-bar__buttons">
    <button
      type="button"
      class="button button--primary"
      disabled={primaryDisabled}
      aria-disabled={primaryDisabled}
      title={primaryTitle}
      onkeydown={(event) => {
        if (event.key === "Enter") guardComposingKey(event);
      }}
      onclick={handlePrimaryClick}
    >
      {#if primary.icon}
        <span class="codicon {primary.icon}" aria-hidden="true"></span>
      {/if}
      {primary.label}
    </button>
    {#each visibleSecondary as item, index (index)}
      <button
        type="button"
        class="button button--secondary"
        disabled={item.disabled}
        aria-disabled={item.disabled === true}
        title={item.disabledReason}
        onkeydown={(event) => {
          if (event.key === "Enter") guardComposingKey(event);
        }}
        onclick={() => handleSecondaryClick(item)}
      >
        {#if item.icon}
          <span class="codicon {item.icon}" aria-hidden="true"></span>
        {/if}
        {item.label}
      </button>
    {/each}
  </span>
  {#if statusText}
    <span class="primary-action-bar__status" role="status">{statusText}</span>
  {/if}
</div>

<style>
  /* 只用 VS Code 主题变量；本组件不声明 sticky / overflow。 */
  .primary-action-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
  }
  .primary-action-bar__count {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
  .primary-action-bar__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .primary-action-bar__status {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }
</style>
