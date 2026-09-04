<script lang="ts">
  import { useFileList } from "../../../src/webview/components/list/useFileList.svelte";

  /*
   * v0.0.10 共享列表控制器测试 harness：最小化接入 useFileList 的
   * 非选择语义（键盘导航、Escape 关详情、窗口化），不带业务模块状态。
   */

  let {
    items,
    virtualizeAfter = 300,
    enableSelectAll = false,
  }: {
    items: string[];
    virtualizeAfter?: number;
    /** V017-G2 P1-4：Ctrl+A 幂等回调计数开关（默认关闭，保持原非选择语义）。 */
    enableSelectAll?: boolean;
  } = $props();

  let requestedDetail = $state<string | undefined>();
  let activated = $state<string | undefined>();
  let detailArrived = $state(false);
  /** V017-B `/` 聚焦搜索接线指示（默认接线，用于覆盖 keymap 绑定）。 */
  let searchFocused = $state(false);
  /** V017-G2 P1-4：Ctrl+A 回调次数（幂等：连按累加，不反向清空）。 */
  let selectAllCount = $state(0);

  const list = useFileList<string>({
    rows: () => items,
    rowHeight: () => 48,
    virtualizeAfter,
    onPathDetailRequest: (relativePath) => {
      requestedDetail = relativePath;
    },
    onActivate: (item) => {
      activated = item;
    },
    onFocusSearch: () => {
      searchFocused = true;
    },
    ...(enableSelectAll
      ? {
          onSelectAll: () => {
            selectAllCount += 1;
          },
        }
      : {}),
  });
</script>

<button
  type="button"
  class="harness-detail-trigger"
  onclick={() => {
    list.requestPathDetail(items[0]);
    detailArrived = true;
    list.markPathDetailArrived();
  }}
>
  打开详情
</button>
{#if detailArrived && list.detailOpen}
  <div class="harness-detail" data-testid="detail">详情</div>
{/if}
{#if requestedDetail}
  <span data-testid="requested-detail">{requestedDetail}</span>
{/if}
{#if activated}
  <span data-testid="activated">{activated}</span>
{/if}
{#if searchFocused}
  <span data-testid="search-focused">搜索已聚焦</span>
{/if}
{#if enableSelectAll}
  <span data-testid="select-all-count">{selectAllCount}</span>
{/if}
<div
  class="harness-list"
  role="list"
  tabindex="0"
  bind:this={list.element}
  onscroll={list.handleScroll}
  onkeydown={list.handleKeydown}
>
  {#each list.visibleRows as { row, index } (row)}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -- 行点击只设置活动行；键盘操作由列表容器统一处理。 -->
    <div
      class="harness-row"
      class:harness-row--active={list.activeIndex === index}
      role="listitem"
      data-row-index={index}
      tabindex="-1"
      onclick={() => list.markActive(index)}
    >
      {row}
    </div>
  {/each}
</div>
