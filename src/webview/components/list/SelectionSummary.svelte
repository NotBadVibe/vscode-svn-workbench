<script lang="ts">
  /*
   * v0.0.8 SelectionSummary：已选 N、当前筛选可操作 M、隐藏 K 的权威
   * 摘要与“只看已选 / 清除隐藏 / 清空全部 / 推荐项”入口；刷新移除
   * 说明经 role=status 播报。
   */

  let {
    selectedCount,
    actionableCount,
    hiddenCount,
    onlySelected = false,
    recommendedAvailable = true,
    announcement = "",
    onToggleOnlySelected,
    onClearHidden,
    onClearAll,
    onSelectRecommended,
  }: {
    selectedCount: number;
    actionableCount: number;
    hiddenCount: number;
    onlySelected?: boolean;
    recommendedAvailable?: boolean;
    announcement?: string;
    onToggleOnlySelected: () => void;
    onClearHidden: () => void;
    onClearAll: () => void;
    onSelectRecommended?: () => void;
  } = $props();
</script>

<div class="selection-summary">
  <span class="selection-summary__counts">
    已选 {selectedCount} · 当前筛选可操作 {actionableCount} · 隐藏 {hiddenCount}
  </span>
  <span class="selection-summary__actions">
    <button
      type="button"
      class:active={onlySelected}
      onclick={onToggleOnlySelected}
      aria-pressed={onlySelected}>只看已选</button
    >
    <button type="button" disabled={hiddenCount === 0} onclick={onClearHidden}
      >清除隐藏选择</button
    >
    <button type="button" disabled={selectedCount === 0} onclick={onClearAll}
      >清空全部</button
    >
    {#if onSelectRecommended}
      <button
        type="button"
        disabled={!recommendedAvailable}
        onclick={onSelectRecommended}>选择推荐项</button
      >
    {/if}
  </span>
  {#if announcement}
    <span class="selection-summary__announcement" role="status"
      >{announcement}</span
    >
  {/if}
</div>
