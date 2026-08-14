<script lang="ts">
  import type {
    SortDirection,
    SortField,
  } from "../../../selection/selectionSort";

  /*
   * v0.0.8 SortHeader：语义列头（role=columnheader + aria-sort），排序
   * 方向同时有图标与中文文字；首次点击明确默认方向（升序），再次反向。
   */

  let {
    label,
    field,
    activeField,
    direction,
    onToggle,
  }: {
    label: string;
    field: SortField;
    activeField?: SortField | undefined;
    direction: SortDirection;
    onToggle: (field: SortField) => void;
  } = $props();

  const active = $derived(activeField === field);
  const ariaSort = $derived(
    active ? (direction === "asc" ? "ascending" : "descending") : "none",
  );
</script>

<div class="sort-header" role="columnheader" aria-sort={ariaSort as never}>
  <button
    type="button"
    class="sort-header__button"
    class:sort-header__button--active={active}
    onclick={() => onToggle(field)}
  >
    <span>{label}</span>
    <span
      class="codicon"
      class:codicon-arrow-up={active && direction === "asc"}
      class:codicon-arrow-down={active && direction === "desc"}
      class:codicon-arrow-both={!active}
      aria-hidden="true"
    ></span>
    <span class="sort-header__direction"
      >{active ? (direction === "asc" ? "升序" : "降序") : "未排序"}</span
    >
  </button>
</div>
