<script lang="ts">
  import type { Snippet } from "svelte";

  /*
   * v0.0.8 BulkActionBar：列表内 Sticky 底栏，承载带明确数量的批量
   * 动作；不遮挡末行（占位由调用方布局保证）。
   */

  let {
    summary,
    children,
  }: {
    /** 左侧摘要，例如“已选 7”。 */
    summary: string;
    children: Snippet;
  } = $props();
</script>

<div class="bulk-action-bar" role="toolbar" aria-label="批量操作">
  <span class="bulk-action-bar__summary">{summary}</span>
  <span class="bulk-action-bar__actions">{@render children()}</span>
</div>
