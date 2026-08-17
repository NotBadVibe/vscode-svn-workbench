<script lang="ts">
  import { useFileList } from "../../../src/webview/components/list/useFileList.svelte";

  /*
   * v0.0.10 共享列表控制器测试 harness：最小化接入 useFileList 的
   * 非选择语义（键盘导航、Escape 关详情、窗口化），不带业务模块状态。
   */

  let {
    items,
    virtualizeAfter = 300,
  }: {
    items: string[];
    virtualizeAfter?: number;
  } = $props();

  let requestedDetail = $state<string | undefined>();
  let activated = $state<string | undefined>();
  let detailArrived = $state(false);

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
