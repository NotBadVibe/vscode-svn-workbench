<script lang="ts">
  /*
   * v0.0.10 共享搜索框：图标 + 输入 + 仅在有内容时出现的清除按钮。
   * 只做值绑定，不响应 Enter（IME 候选阶段的 Enter 不得触发搜索语义）；
   * 筛选由调用方对 value 派生，结果数量经 ResultCount 播报。
   */

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
</script>

<div class="search-field" class:search-field--compact={compact}>
  <span class="codicon codicon-search" aria-hidden="true"></span>
  <input bind:value type="text" aria-label={ariaLabel} {placeholder} />
  {#if value}
    <button
      type="button"
      class="icon-button icon-button--small"
      aria-label="清除筛选"
      onclick={() => (value = "")}
      ><span class="codicon codicon-close" aria-hidden="true"></span></button
    >
  {/if}
</div>
