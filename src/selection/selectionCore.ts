/*
 * v0.0.8 批次 1 选择集合核心（纯逻辑，无 DOM/VS Code/Svelte 依赖）。
 *
 * 契约来源：releases/v0.0.8 §4（全选与选择语义）。
 *
 * - 选择身份复用批次 0 的 PathIdentityKey 品牌（SelectionKey 为别名）：
 *   普通 string/DisplayPath 编译期不能直接赋给 SelectionKey；模块不把
 *   DisplayPath 当 identity，也不读取 process.platform/cwd；
 * - actionability 是针对当前动作的调用方权威输入（SelectableItem.actionable
 *   必填）：Commit 调用方对 excluded 传 actionable=false，允许的非提交动作
 *   可传 actionable=true；模块只做 fail-closed 运算，不从 excluded/needsReview
 *   自动推断可操作性；blocked 是二次 fail-closed（即使 actionable=true 也不
 *   可操作）；
 * - 当前筛选可操作项 = actionable=true 且非 blocked；三态只基于它；表头
 *   toggle 只影响本次传入的可见快照，筛选外隐藏选择保留，新出现项不会因
 *   过去全选而自动加入；
 * - blocked 永不被批量加入；excluded/needsReview 不进入推荐自动加入；
 * - 所有函数不变异入参 Set/数组，返回新集合。
 */

import type { DisplayPath, PathIdentityKey } from "../scope/pathBrands";

type Assert<T extends true> = T;

/** 选择身份：复用批次 0 的路径身份品牌，普通 string/DisplayPath 不可直接赋值。 */
export type SelectionKey = PathIdentityKey;

/** 编译期契约：SelectionKey（=PathIdentityKey）与 DisplayPath 互不兼容。 */
export type SelectionKeyNotDisplayPath = Assert<
  [SelectionKey] extends [DisplayPath] ? false : true
>;
export type DisplayPathNotSelectionKey = Assert<
  [DisplayPath] extends [SelectionKey] ? false : true
>;

/** 表头三态；只基于当前筛选可操作项。 */
export type TriState = "none" | "partial" | "all";

/**
 * 可见项的最小输入：key 必须稳定（由调用方从 working-copy/repository
 * identity 与规范化仓库内路径生成），actionable 是针对当前动作的调用方
 * 权威输入（必填）；其余属性缺省均为 false。
 */
export interface SelectableItem {
  key: SelectionKey;
  /**
   * 当前动作下是否可操作（调用方权威判定）。模块只做 fail-closed 运算：
   * 缺省不假定可操作；excluded/needsReview 是否可操作由调用方按动作传入。
   */
  actionable: boolean;
  /** 阻止项：二次 fail-closed，永不被批量加入；刷新时由调用方判定后移除。 */
  blocked?: boolean;
  /** 排除项：不进入推荐提交；可操作性由调用方按动作判定。 */
  excluded?: boolean;
  /** 需要确认：保留原状态，不被偷偷改成 recommended/selected。 */
  needsReview?: boolean;
  /** 本地规则推荐（recommended 初始化/合并的来源）。 */
  recommended?: boolean;
}

/** 该项是否属于“当前筛选可操作项”（fail-closed：actionable 且非 blocked）。 */
export function isActionable(item: SelectableItem): boolean {
  return item.actionable === true && item.blocked !== true;
}

/** 可见快照中可操作项的 key 集合（新 Set，不修改入参）。 */
export function actionableKeys(
  visible: readonly SelectableItem[],
): ReadonlySet<SelectionKey> {
  const keys = new Set<SelectionKey>();
  for (const item of visible) {
    if (isActionable(item)) keys.add(item.key);
  }
  return keys;
}

/**
 * 三态：none/partial/all 只基于当前筛选可操作项。
 * 筛选外隐藏选择与不可操作项不参与计算。
 */
export function computeTriState(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): TriState {
  let actionableCount = 0;
  let selectedCount = 0;
  for (const item of visible) {
    if (!isActionable(item)) continue;
    actionableCount += 1;
    if (selected.has(item.key)) selectedCount += 1;
  }
  if (actionableCount === 0) return "none";
  if (selectedCount === 0) return "none";
  if (selectedCount === actionableCount) return "all";
  return "partial";
}

/**
 * 表头 toggle：none/partial -> 全选本次可见快照的可操作项；
 * all -> 从 selected 移除本次快照的可操作项。
 * 隐藏选择保留；不可操作项（含 blocked）永不触碰。返回新 Set。
 */
export function toggleActionable(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): ReadonlySet<SelectionKey> {
  const keys = actionableKeys(visible);
  const next = new Set(selected);
  if (computeTriState(visible, selected) === "all") {
    for (const key of keys) next.delete(key);
  } else {
    for (const key of keys) next.add(key);
  }
  return next;
}

/**
 * 推荐初始化/合并：把本地规则推荐、当前动作可操作（actionable 且非 blocked）
 * 且非 excluded/needsReview 的可见项加入 selected。只加不减：用户手动保留项
 * 与隐藏选择不被覆盖、不被移除。needsReview/excluded/blocked 永不被推荐自动
 * 加入；新出现项若未被推荐不会自动加入。
 */
export function mergeRecommendedSelection(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): ReadonlySet<SelectionKey> {
  const next = new Set(selected);
  for (const item of visible) {
    if (
      item.recommended === true &&
      isActionable(item) &&
      !item.excluded &&
      !item.needsReview
    ) {
      next.add(item.key);
    }
  }
  return next;
}

/** 隐藏选择：已选但不在当前可见快照中的 key（新 Set）。 */
export function hiddenSelectionKeys(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): ReadonlySet<SelectionKey> {
  const visibleKeys = new Set(visible.map((item) => item.key));
  const hidden = new Set<SelectionKey>();
  for (const key of selected) {
    if (!visibleKeys.has(key)) hidden.add(key);
  }
  return hidden;
}

/** 隐藏选择数量。 */
export function countHiddenSelection(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): number {
  return hiddenSelectionKeys(visible, selected).size;
}

/** 清除隐藏选择：返回 selected ∩ 当前可见（新 Set）。 */
export function clearHiddenSelection(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): ReadonlySet<SelectionKey> {
  const visibleKeys = new Set(visible.map((item) => item.key));
  const next = new Set<SelectionKey>();
  for (const key of selected) {
    if (visibleKeys.has(key)) next.add(key);
  }
  return next;
}

/** 只看已选：返回可见项中属于 selected 的项（新数组，保持可见顺序）。 */
export function filterOnlySelected(
  visible: readonly SelectableItem[],
  selected: ReadonlySet<SelectionKey>,
): SelectableItem[] {
  return visible.filter((item) => selected.has(item.key));
}

/** 清空全部：空选择集合。 */
export function emptySelection(): ReadonlySet<SelectionKey> {
  return new Set<SelectionKey>();
}
