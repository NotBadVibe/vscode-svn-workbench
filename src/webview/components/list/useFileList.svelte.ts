/*
 * v0.0.10 共享列表行控制器（v0.0.8 底座固化）。
 *
 * 把 Changes/Commit 原本复制级重复的键盘导航、活动行焦点、窗口化与
 * 路径详情开合收敛为单一实现，供跨模块列表迁移复用：
 * - 手势语义与 v0.0.8 一致：IME/输入框闸门、Escape 先于空列表早退关闭
 *   路径详情并恢复触发点焦点、Ctrl/⌘+A 幂等选择、PageUp/PageDown 按一页
 *   可见行数分页、Shift+方向键连续选择、Shift+F10/Menu 行菜单；
 * - 模块通过 options 省略不适用能力（选择、行菜单、路径详情），但不得
 *   改变共享手势的含义；渲染标记仍由各模块持有（列表列差异大，不抽
 *   通用 DataList）。
 * - V017-B：`/` 聚焦搜索由 `onFocusSearch` 接线（仅有搜索框的列表），
 *   未接线时无绑定，帮助中亦不出现。
 */

import {
  edgeActiveIndex,
  moveActiveIndex,
  pageSizeOf,
  rangeItems,
  shouldHandleListKeydown,
  windowedRows,
} from "./listModel";

export interface UseFileListOptions<T> {
  /** 排序/筛选后的完整行集合（响应式读取，排序由调用方完成）。 */
  rows: () => readonly T[];
  /** 单行高度（像素，随密度变化）。 */
  rowHeight: () => number;
  /** 超过该数量启用窗口化渲染。 */
  virtualizeAfter?: number;
  /** 窗口化前后额外渲染的行数。 */
  overscan?: number;
  /** 请求 Host 计算路径详情（file/path-detail）；结果由模块标记到达。 */
  onPathDetailRequest?: (relativePath: string) => void;
  /** 路径详情未打开时的 Escape 扩展行为；返回 true 表示已处理。 */
  onEscape?: () => boolean;
  /** Enter：打开当前活动行（如 Diff）。 */
  onActivate?: (row: T, index: number) => void;
  /** Ctrl/⌘+A：幂等选择当前筛选可操作项（幂等语义由调用方保证）。 */
  onSelectAll?: () => void;
  /** Shift+方向键/Home/End：连续选择（只加入调用方判定的可操作项）。 */
  onSelectRange?: (rows: readonly T[], index: number) => void;
  /** Space：切换当前活动行选择。 */
  onToggleActive?: (row: T, index: number) => void;
  /** Shift+F10/Menu：打开活动行菜单；返回 true 才阻止默认。 */
  onOpenRowMenu?: (row: T, index: number) => boolean;
  /**
   * V017-B `/` 聚焦搜索（集中 keymap `list/searchFocus`）：仅有搜索框的
   * 列表接线；未提供时 `/` 无绑定（帮助中亦不出现）。
   */
  onFocusSearch?: () => void;
}

export interface FileListController<T> {
  /** 列表滚动容器（bind:this 绑定）。 */
  element: HTMLDivElement | undefined;
  readonly activeIndex: number;
  /** Shift 连续选择的锚点（行点击与非 Shift 导航时更新）。 */
  readonly anchorIndex: number;
  readonly detailOpen: boolean;
  readonly isVirtualized: boolean;
  readonly visibleWindow: { start: number; end: number };
  readonly visibleRows: Array<{ row: T; index: number }>;
  handleScroll(event: Event): void;
  handleKeydown(event: KeyboardEvent): void;
  /** 键盘导航：滚动活动行进可视区并聚焦已挂载行。 */
  setActiveRow(index: number): void;
  /** 行点击：记录活动行与选择锚点，不移动焦点。 */
  markActive(index: number): void;
  /** 筛选/排序变化：回到顶部并清除活动行。 */
  resetNavigation(): void;
  requestPathDetail(
    relativePath: string,
    trigger?: HTMLButtonElement | null,
  ): void;
  /** Host 路径详情结果到达时展开。 */
  markPathDetailArrived(): void;
  closePathDetail(): void;
}

export function useFileList<T>(
  options: UseFileListOptions<T>,
): FileListController<T> {
  const virtualizeAfter = options.virtualizeAfter ?? 300;
  const overscan = options.overscan ?? 8;

  let element = $state<HTMLDivElement | undefined>();
  let activeIndex = $state(-1);
  let anchorIndex = $state(-1);
  let scrollTop = $state(0);
  let viewportHeight = $state(500);
  let detailOpen = $state(false);
  let pathDetailTrigger: HTMLButtonElement | null = null;

  const visibleWindow = $derived(
    windowedRows({
      total: options.rows().length,
      scrollTop,
      viewportHeight,
      rowHeight: options.rowHeight(),
      overscan,
      virtualizeAfter,
    }),
  );

  const visibleRows = $derived.by(() => {
    const rows = options.rows();
    return rows
      .slice(visibleWindow.start, visibleWindow.end)
      .map((row, offset) => ({ row, index: visibleWindow.start + offset }));
  });

  function handleScroll(event: Event): void {
    const target = event.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    viewportHeight = target.clientHeight || viewportHeight;
  }

  function setActiveRow(index: number): void {
    activeIndex = index;
    // 虚拟化下先把活动行滚动进可视区，再聚焦已挂载行。
    if (element) {
      const rowHeight = options.rowHeight();
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      let nextScrollTop: number | undefined;
      if (top < element.scrollTop) nextScrollTop = top;
      if (bottom > element.scrollTop + element.clientHeight) {
        nextScrollTop = bottom - element.clientHeight;
      }
      if (nextScrollTop !== undefined) {
        element.scrollTop = nextScrollTop;
        // 同步组件滚动状态：真实浏览器经 scroll 事件更新；程序化滚动
        // （键盘导航）直接同步，窗口立即重算。
        scrollTop = nextScrollTop;
      }
    }
    requestAnimationFrame(() => {
      element
        ?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
        ?.focus();
    });
  }

  function markActive(index: number): void {
    activeIndex = index;
    anchorIndex = index;
  }

  function resetNavigation(): void {
    scrollTop = 0;
    activeIndex = -1;
    if (element) element.scrollTop = 0;
  }

  function requestPathDetail(
    relativePath: string,
    trigger?: HTMLButtonElement | null,
  ): void {
    pathDetailTrigger = trigger ?? null;
    options.onPathDetailRequest?.(relativePath);
  }

  function markPathDetailArrived(): void {
    detailOpen = true;
  }

  function closePathDetail(): void {
    detailOpen = false;
    // 关闭详情后恢复触发按钮焦点，列表滚动位置不变。
    pathDetailTrigger?.focus();
  }

  /** 键盘：活动行与选择分离；Shift 连续选择；Ctrl/⌘+A 只选当前筛选可操作项。 */
  function handleKeydown(event: KeyboardEvent): void {
    if (!shouldHandleListKeydown(event)) return;
    // Escape 必须先于空列表早退处理：详情响应到达后候选刷新为空时仍可关闭。
    if (event.key === "Escape") {
      if (detailOpen) {
        event.preventDefault();
        closePathDetail();
      } else {
        options.onEscape?.();
      }
      return;
    }
    const rows = options.rows();
    const count = rows.length;
    if (count === 0) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      if (!options.onSelectAll) return;
      // 幂等“选择当前筛选可操作项”：已全选时连按不反向清空。
      event.preventDefault();
      options.onSelectAll();
      return;
    }
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") {
      nextIndex = moveActiveIndex(activeIndex, 1, count);
    } else if (event.key === "ArrowUp") {
      nextIndex = moveActiveIndex(activeIndex, -1, count);
    } else if (event.key === "PageDown" || event.key === "PageUp") {
      // 无活动行时保留原生区域滚动（局部滚动验收）；有活动行时按一页
      // 可见行数分页导航并滚动到目标行。
      if (activeIndex < 0) return;
      event.preventDefault();
      const page = pageSizeOf(viewportHeight, options.rowHeight());
      const direction = event.key === "PageDown" ? page : -page;
      setActiveRow(moveActiveIndex(activeIndex, direction, count));
      return;
    } else if (event.key === "Home") {
      nextIndex = edgeActiveIndex("home", count);
    } else if (event.key === "End") {
      nextIndex = edgeActiveIndex("end", count);
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      if (event.shiftKey) {
        if (options.onSelectRange) {
          const anchor = anchorIndex < 0 ? activeIndex : anchorIndex;
          options.onSelectRange(rangeItems(rows, anchor, nextIndex), nextIndex);
        }
      } else {
        anchorIndex = nextIndex;
      }
      setActiveRow(nextIndex);
      return;
    }
    if (event.key === " " && activeIndex >= 0 && options.onToggleActive) {
      event.preventDefault();
      options.onToggleActive(rows[activeIndex], activeIndex);
      return;
    }
    if (
      (event.key === "F10" && event.shiftKey) ||
      event.key === "ContextMenu"
    ) {
      // Shift+F10 / Menu：打开活动行的操作菜单。
      // 仅当找到活动行并实际打开菜单时才阻止默认（无活动行放行原行为）。
      const row = rows[activeIndex];
      if (row !== undefined && options.onOpenRowMenu?.(row, activeIndex)) {
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter" && activeIndex >= 0 && options.onActivate) {
      event.preventDefault();
      options.onActivate(rows[activeIndex], activeIndex);
      return;
    }
    // V017-B `/` 聚焦搜索：列表容器聚焦且不在输入/IME 候选中（总闸门已保证）。
    if (event.key === "/" && options.onFocusSearch) {
      event.preventDefault();
      options.onFocusSearch();
    }
  }

  return {
    get element() {
      return element;
    },
    set element(next: HTMLDivElement | undefined) {
      element = next;
    },
    get activeIndex() {
      return activeIndex;
    },
    get anchorIndex() {
      return anchorIndex;
    },
    get detailOpen() {
      return detailOpen;
    },
    get isVirtualized() {
      return options.rows().length > virtualizeAfter;
    },
    get visibleWindow() {
      return visibleWindow;
    },
    get visibleRows() {
      return visibleRows;
    },
    handleScroll,
    handleKeydown,
    setActiveRow,
    markActive,
    resetNavigation,
    requestPathDetail,
    markPathDetailArrived,
    closePathDetail,
  };
}
