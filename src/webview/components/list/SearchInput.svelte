<script lang="ts">
  /*
   * v0.0.10 共享搜索框：图标 + 输入 + 仅在有内容时出现的清除按钮。
   * 只做值绑定，不响应 Enter（IME 候选阶段的 Enter 不得触发搜索语义）；
   * 筛选由调用方对 value 派生，结果数量经 ResultCount 播报。
   * V017-B：Esc 清除筛选（集中 keymap `search/clear`），清空并保持焦点；
   * IME 候选阶段的 Esc 先处理输入法，不清除。
   */
  import { isImeComposing } from "../../i18n/keyboard";
  import { SHORTCUTS_BY_REGION } from "../../keyboard/shortcuts";

  /** 清除按钮 title 来自集中 keymap（`search/clear`），禁止硬编码。 */
  const clearTitle =
    SHORTCUTS_BY_REGION.search.find((def) => def.id === "clear")?.title ??
    "清除筛选";

  let {
    value = $bindable(""),
    ariaLabel,
    placeholder,
    compact = false,
  }: {
    value?: string;
    ariaLabel: string;
    placeholder?: string;
    compact?: boolean;
  } = $props();

  let inputEl = $state<HTMLInputElement | undefined>();
  let composing = $state(false);

  /** 供列表 `/` 聚焦搜索（集中 keymap `list/searchFocus`）复用。 */
  export function focusInput(): void {
    inputEl?.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    // IME 候选阶段先处理输入法，不清除筛选。
    if (
      composing ||
      isImeComposing(event as Pick<KeyboardEvent, "isComposing" | "keyCode">)
    )
      return;
    if (event.key === "Escape" && value) {
      event.preventDefault();
      value = "";
      // 清空后保持焦点，键盘用户可继续输入。
      inputEl?.focus();
    }
  }
</script>

<div class="search-field" class:search-field--compact={compact}>
  <span class="codicon codicon-search" aria-hidden="true"></span>
  <input
    bind:this={inputEl}
    bind:value
    type="text"
    aria-label={ariaLabel}
    {placeholder}
    onkeydown={onKeydown}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => (composing = false)}
  />
  {#if value}
    <button
      type="button"
      class="icon-button icon-button--small"
      aria-label="清除筛选"
      title={clearTitle}
      onclick={() => {
        value = "";
        inputEl?.focus();
      }}><span class="codicon codicon-close" aria-hidden="true"></span></button
    >
  {/if}
</div>
