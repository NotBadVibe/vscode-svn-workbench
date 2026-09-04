<script lang="ts">
  import { tick } from "svelte";
  import {
    blockFraction,
    overviewBlockAriaLabel,
    overviewStatusText,
    overviewSummaryLabel,
    type OverviewBlock,
  } from "./diffOverviewModel";
  import { overviewGateHint, overviewLabels } from "../../i18n/terminology";
  import { isImeComposing } from "../../i18n/keyboard";
  import {
    decideDiffOverviewGate,
    V018D_OVERVIEW_BLOCK_THRESHOLD,
  } from "./diffPerformancePolicy";

  /*
   * V018-D 共享定位器（v0.1.8 规划 §4.4，候选共享 DiffOverview.svelte）。
   * - 变更/冲突分布（分布条）+ 当前位置（aria-current + 自动滚入视口）+
   *   未处理块标记（状态图形+文字/aria，不只靠颜色）。
   * - 点击/键盘选择只通知父级导航索引；不触碰文件目标、操作范围与快照。
   * - 可折叠：720×480/200% 下收起，不占用主编辑区不可恢复空间。
   * - 滚动归属：列表为独立命名滚动区；禁止全局 overflow。
   */

  let {
    blocks,
    currentIndex = 0,
    totalLines = 1,
    onSelect,
  }: {
    blocks: OverviewBlock[];
    currentIndex?: number;
    totalLines?: number;
    onSelect: (index: number) => void;
  } = $props();

  /*
   * V018-D 纪律修正：超预算门控。实测 100 块导航 P95 约 132ms（略超 100ms
   * 预算）、500 块 P95 约 1428ms（no-go），故块数 > 阈值默认折叠（不渲染
   * 分布条与列表，折叠态零占位），用户可显式展开（展开时提示成本）。
   * 阈值集中在 diffPerformancePolicy.ts（V018D_OVERVIEW_BLOCK_THRESHOLD）。
   */
  const gate = $derived(
    decideDiffOverviewGate(blocks.length, V018D_OVERVIEW_BLOCK_THRESHOLD),
  );
  let userExpanded: boolean | undefined = $state(undefined);
  let prevGated: boolean | undefined = $state(undefined);
  const expanded = $derived(userExpanded ?? gate.defaultExpanded);
  const gateHint = $derived(
    gate.gated ? overviewGateHint(gate.blockCount, gate.threshold) : undefined,
  );
  // 块规模跨越阈值（如切换文件）时回到默认态，避免大档沿用小档的展开态。
  $effect(() => {
    const gated = gate.gated;
    if (prevGated === undefined) {
      prevGated = gated;
      return;
    }
    if (gated !== prevGated) {
      prevGated = gated;
      userExpanded = undefined;
    }
  });
  function toggleExpanded(): void {
    userExpanded = !expanded;
  }
  let listEl = $state<HTMLDivElement>();
  let railEl = $state<HTMLDivElement>();

  const summary = $derived(overviewSummaryLabel(currentIndex, blocks.length));

  function fractions(index: number): { top: number; height: number } {
    const block = blocks[index];
    if (!block) return { top: 0, height: 0 };
    return blockFraction(block.startLine, block.endLine, totalLines);
  }

  function select(index: number): void {
    if (index < 0 || index >= blocks.length) return;
    onSelect(index);
  }

  /** 分布条点击：按纵向占比就近选择块（只改导航索引）。 */
  function onRailClick(event: MouseEvent): void {
    const rail = railEl;
    if (!rail || blocks.length === 0) return;
    const rect = rail.getBoundingClientRect();
    if (rect.height <= 0) return;
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height),
    );
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 0; i < blocks.length; i += 1) {
      const center = fractions(i).top + fractions(i).height / 2;
      const distance = Math.abs(center - ratio);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    select(best);
  }

  function onRailKeydown(event: KeyboardEvent): void {
    if (isImeComposing(event)) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(currentIndex);
    }
  }

  /**
   * 列表键盘：方向键移动焦点，Home/End 跳转，PageUp/Down 分页（不只原生滚动）。
   * Roving tabindex：仅当前块可 Tab 到达，其余项经方向键移动焦点（500 块下
   * 不产生数百个 Tab 停留点）；程序化 focus 不受 tabindex=-1 限制。
   */
  function onListKeydown(event: KeyboardEvent): void {
    if (isImeComposing(event)) return;
    const buttons =
      listEl?.querySelectorAll<HTMLButtonElement>(
        "button[data-overview-index]",
      ) ?? [];
    if (buttons.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const activeIndex = Array.from(buttons).findIndex(
      (button) => button === active,
    );
    const focusAt = (index: number): void => {
      const clamped = Math.min(Math.max(0, index), buttons.length - 1);
      event.preventDefault();
      buttons[clamped].focus();
    };
    switch (event.key) {
      case "ArrowDown":
        focusAt(activeIndex < 0 ? currentIndex + 1 : activeIndex + 1);
        break;
      case "ArrowUp":
        focusAt(activeIndex < 0 ? currentIndex - 1 : activeIndex - 1);
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(buttons.length - 1);
        break;
      case "PageDown":
        focusAt((activeIndex < 0 ? currentIndex : activeIndex) + 10);
        break;
      case "PageUp":
        focusAt((activeIndex < 0 ? currentIndex : activeIndex) - 10);
        break;
      default:
        break;
    }
  }

  // 当前块变化时滚入列表视口（仅调整本列表 scrollTop，不带动外层滚动；
  // reduced-motion 下直接定位，无平滑滚动）。
  $effect(() => {
    const index = currentIndex;
    const list = listEl;
    if (!expanded || !list || blocks.length === 0) return;
    const clamped = Math.min(Math.max(0, index), blocks.length - 1);
    void tick().then(() => {
      const button = list.querySelector<HTMLButtonElement>(
        `button[data-overview-index="${clamped}"]`,
      );
      if (!button) return;
      const reduceMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduceMotion) {
        const top = button.offsetTop - list.clientHeight / 2;
        if (
          button.offsetTop < list.scrollTop ||
          button.offsetTop > list.scrollTop + list.clientHeight
        ) {
          list.scrollTop = Math.max(0, top);
        }
        return;
      }
      if (typeof button.scrollIntoView === "function") {
        button.scrollIntoView({ block: "nearest" });
      }
    });
  });
</script>

<aside
  class="diff-overview"
  class:diff-overview--collapsed={!expanded}
  aria-label={overviewLabels.region}
  data-testid="diff-overview"
>
  <div class="diff-overview__header">
    <button
      type="button"
      class="button button--secondary diff-overview__toggle"
      aria-expanded={expanded}
      aria-label={expanded
        ? overviewLabels.toggleCollapse
        : overviewLabels.toggleExpand}
      data-testid="diff-overview-toggle"
      onclick={toggleExpanded}
    >
      <span
        class="codicon {expanded
          ? 'codicon-chevron-right'
          : 'codicon-chevron-left'}"
        aria-hidden="true"
      ></span>{expanded ? "收起" : "定位器"}
    </button>
    {#if expanded}
      <span class="diff-overview__summary" role="status">{summary}</span>
    {/if}
  </div>
  {#if expanded}
    <p class="diff-overview__hint muted">{overviewLabels.gotoBlockHint}</p>
    {#if gateHint}
      <p
        class="diff-overview__hint muted"
        role="note"
        data-testid="diff-overview-cost-hint"
      >
        {gateHint}
      </p>
    {/if}
    <div class="diff-overview__body">
      <!--
        svelte-ignore a11y_no_noninteractive_element_interactions -- 分布条点击定位为按钮列表的等效快捷入口。
        V018-D 回归修复（v017g-keyboard-paths PATH-2）：分布条曾以 tabindex=0 插入顺序 Tab 流，
        保存按钮禁用致焦点丢失后 Tab 从头重走，多出的停留点放大 pierre 宿主 Tab 陷阱的影响。
        分布条移出顺序 Tab（tabindex=-1，仍可点击；键盘经下方列表操作），定位器功能不变。
      -->
      <div
        class="diff-overview__rail"
        role="img"
        aria-label={`${overviewLabels.railGroup}：共 ${blocks.length} 块`}
        data-testid="diff-overview-rail"
        bind:this={railEl}
        onclick={onRailClick}
        onkeydown={onRailKeydown}
        tabindex="-1"
      >
        {#each blocks as block, index (block.key)}
          {@const frac = fractions(index)}
          <span
            class="diff-overview__tick diff-overview__tick--{block.status}"
            class:diff-overview__tick--current={index === currentIndex}
            style={`top: ${frac.top * 100}%; height: max(2px, ${frac.height * 100}%);`}
            aria-hidden="true"
          ></span>
        {/each}
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -- 定位列表为独立命名滚动区，需 Tab 可达。 -->
      <div
        class="diff-overview__list scroll-region"
        role="group"
        aria-label={overviewLabels.listGroup}
        tabindex="0"
        data-testid="diff-overview-list"
        bind:this={listEl}
        onkeydown={onListKeydown}
      >
        {#if blocks.length === 0}
          <p class="muted" role="status">暂无可定位的变更块</p>
        {:else}
          {#each blocks as block, index (block.key)}
            <button
              type="button"
              class="diff-overview__item diff-overview__item--{block.status}"
              class:diff-overview__item--current={index === currentIndex}
              tabindex={index === currentIndex ? 0 : -1}
              data-overview-index={index}
              aria-label={overviewBlockAriaLabel(index, blocks.length, block)}
              aria-current={index === currentIndex ? "true" : undefined}
              title={block.preview
                ? `${block.label}：${block.preview}`
                : block.label}
              onclick={() => select(index)}
            >
              <span class="diff-overview__status" aria-hidden="true"
                >{overviewStatusText(block.status)}</span
              >
              <span class="diff-overview__label">{block.label}</span>
              {#if index === currentIndex}
                <span class="diff-overview__current"
                  >{overviewLabels.current}</span
                >
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</aside>

<style>
  .diff-overview {
    display: flex;
    flex-direction: column;
    width: 176px;
    flex: none;
    min-height: 0;
    border-left: 1px solid var(--vscode-panel-border);
    padding: 6px;
    gap: 6px;
    background: var(--vscode-editor-background);
  }
  .diff-overview--collapsed {
    width: auto;
    border-left: none;
    padding: 6px 0;
  }
  .diff-overview__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .diff-overview__toggle {
    white-space: nowrap;
  }
  .diff-overview__summary {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff-overview__hint {
    font-size: 11px;
    margin: 0;
  }
  .diff-overview__body {
    display: flex;
    gap: 6px;
    min-height: 0;
    flex: 1;
  }
  .diff-overview__rail {
    position: relative;
    width: 14px;
    flex: none;
    min-height: 48px;
    align-self: stretch;
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
    background: var(--vscode-editorWidget-background);
    cursor: pointer;
  }
  .diff-overview__rail:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .diff-overview__tick {
    position: absolute;
    left: 2px;
    right: 2px;
    border-radius: 1px;
    background: var(--vscode-editor-foreground);
    opacity: 0.55;
  }
  .diff-overview__tick--conflict-unresolved {
    background: var(--vscode-errorForeground);
    opacity: 0.9;
  }
  .diff-overview__tick--whitespace-only {
    background: transparent;
    border: 1px dashed var(--vscode-editor-foreground);
    opacity: 0.7;
  }
  .diff-overview__tick--current {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
    opacity: 1;
  }
  .diff-overview__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    min-height: 48px;
    max-height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .diff-overview__list:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .diff-overview__item {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 3px 6px;
    font-size: 12px;
    text-align: left;
    color: var(--vscode-editor-foreground);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
  }
  .diff-overview__item:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .diff-overview__item:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .diff-overview__item--current {
    border-color: var(--vscode-focusBorder);
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .diff-overview__item--conflict-unresolved .diff-overview__status {
    color: var(--vscode-errorForeground);
  }
  /* V018-D 对比度修复：选中项整行使用选中前景（含状态符号），
     避免错误红字落在选中蓝底上；选中态仍有边框+底色+“当前”徽标三通道。 */
  .diff-overview__item--current .diff-overview__status {
    color: inherit;
  }
  .diff-overview__status {
    flex: none;
    font-size: 11px;
  }
  .diff-overview__label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .diff-overview__current {
    flex: none;
    font-size: 11px;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0 3px;
  }
  @media (max-width: 760px) {
    .diff-overview {
      width: 100%;
      border-left: none;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .diff-overview__body {
      max-height: 160px;
    }
  }
</style>
