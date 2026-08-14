/*
 * v0.0.8 批次 1 自然稳定排序（纯逻辑，无 DOM/VS Code/Svelte 依赖）。
 *
 * 契约来源：releases/v0.0.8 §5（排序契约）与 UX08-SORT-01/02。
 *
 * - 路径/文件名/归属：大小写不敏感、numeric natural compare（file2 < file10），
 *   相等时以原始输入位置稳定兜底；
 * - 状态与选择建议：显式产品优先级表（低值在前），未知/缺省值恒排末尾，
 *   降序只反转已定义值次序，未知值仍排末尾；
 * - 排序返回新数组，不修改输入，不改变任何 selection/key/scope 数据；
 * - 本模块不读取 process.platform/cwd，不做任何文件系统操作。
 */

import type { SelectionKey } from "./selectionCore";

/** 选择建议的产品优先级（低值在前；推荐 < 需确认 < 排除 < 阻止）。 */
export const RECOMMENDATION_ORDER = [
  "recommended",
  "needsReview",
  "excluded",
  "blocked",
] as const;

export type SelectionRecommendation = (typeof RECOMMENDATION_ORDER)[number];

export type SortField =
  | "path"
  | "fileName"
  | "status"
  | "recommendation"
  | "ownership"
  | "ruleSource";

export type SortDirection = "asc" | "desc";

/** 可排序项；key 只随行携带，排序绝不修改它。 */
export interface SelectionSortable {
  key: SelectionKey;
  /** 展示用项目内路径（比较基准，不是 identity）。 */
  path: string;
  /** 文件名；缺省时取 path 的最后一段。 */
  fileName?: string;
  /** 状态标识（比较用产品优先级表，不按中文文案字典序）。 */
  status?: string;
  /** 选择建议；缺省视为未知值。 */
  recommendation?: SelectionRecommendation;
  /** 项目/仓库归属标识（展示名或归属键）。 */
  ownership?: string;
  /** 规则来源标识（Commit 最终决策来源）。 */
  ruleSource?: string;
}

export interface SelectionSortOptions {
  field: SortField;
  direction: SortDirection;
  /** 状态产品优先级表（升序等级，低值在前）；缺省时全部状态视为未知值。 */
  statusOrder?: readonly string[];
  /** 建议产品优先级表；缺省用 RECOMMENDATION_ORDER。 */
  recommendationOrder?: readonly SelectionRecommendation[];
}

/**
 * 大小写不敏感、numeric natural compare（逐字符扫描）：
 * - 数字段整体按数值比较（file2 < file10），前导零不改变数值；
 * - 非数字字符按小写化后的码点比较；
 * - 前缀相同且长度不同时短者在前；
 * - 全等返回 0（由稳定排序按原始位置兜底）。
 */
export function naturalCompare(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const isDigit = (char: string): boolean => char >= "0" && char <= "9";
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const aIsDigit = isDigit(a[i]);
    const bIsDigit = isDigit(b[j]);
    if (aIsDigit && bIsDigit) {
      let aEnd = i;
      let bEnd = j;
      while (aEnd < a.length && isDigit(a[aEnd])) aEnd += 1;
      while (bEnd < b.length && isDigit(b[bEnd])) bEnd += 1;
      const aDigits = a.slice(i, aEnd).replace(/^0+/, "") || "0";
      const bDigits = b.slice(j, bEnd).replace(/^0+/, "") || "0";
      if (aDigits.length !== bDigits.length) {
        return aDigits.length - bDigits.length;
      }
      if (aDigits !== bDigits) return aDigits < bDigits ? -1 : 1;
      i = aEnd;
      j = bEnd;
      continue;
    }
    if (aIsDigit !== bIsDigit) {
      // 一侧是数字另一侧是普通字符：按码点比较当前字符即可确定。
      return a[i] < b[j] ? -1 : 1;
    }
    if (a[i] !== b[j]) return a[i] < b[j] ? -1 : 1;
    i += 1;
    j += 1;
  }
  return a.length - i - (b.length - j);
}

/** path 的最后一段（兼容 "/" 与 "\" 分隔）；空串返回原值。 */
export function fileNameOf(path: string): string {
  const segments = path.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last === undefined || last === "" ? path : last;
}

/** 优先级表索引；未知/缺省值返回 -1（恒排末尾）。 */
function orderIndex(
  value: string | undefined,
  order: readonly string[] | undefined,
): number {
  if (value === undefined || order === undefined) return -1;
  const index = order.indexOf(value);
  return index < 0 ? -1 : index;
}

/**
 * 优先级比较：低索引在前；未知值（-1）恒排末尾，不随方向反转；
 * 两侧都未知时返回 0（稳定兜底）。
 */
function priorityCompare(
  leftIndex: number,
  rightIndex: number,
  direction: SortDirection,
): number {
  if (leftIndex === -1 && rightIndex === -1) return 0;
  if (leftIndex === -1) return 1;
  if (rightIndex === -1) return -1;
  return direction === "asc" ? leftIndex - rightIndex : rightIndex - leftIndex;
}

function compareByField(
  left: SelectionSortable,
  right: SelectionSortable,
  options: SelectionSortOptions,
): number {
  switch (options.field) {
    case "path":
      return naturalCompare(left.path, right.path);
    case "fileName":
      return naturalCompare(
        left.fileName ?? fileNameOf(left.path),
        right.fileName ?? fileNameOf(right.path),
      );
    case "status":
      return priorityCompare(
        orderIndex(left.status, options.statusOrder),
        orderIndex(right.status, options.statusOrder),
        options.direction,
      );
    case "recommendation":
      return priorityCompare(
        orderIndex(
          left.recommendation,
          options.recommendationOrder ?? RECOMMENDATION_ORDER,
        ),
        orderIndex(
          right.recommendation,
          options.recommendationOrder ?? RECOMMENDATION_ORDER,
        ),
        options.direction,
      );
    case "ownership":
      return naturalCompare(left.ownership ?? "", right.ownership ?? "");
    case "ruleSource":
      return naturalCompare(left.ruleSource ?? "", right.ruleSource ?? "");
  }
}

/**
 * 比较两个可排序项：字段值比较；相等（含未知值之间）返回 0，
 * 由稳定排序按原始输入位置兜底。
 */
export function compareSelectionItems(
  left: SelectionSortable,
  right: SelectionSortable,
  options: SelectionSortOptions,
): number {
  let result = compareByField(left, right, options);
  // 文本字段（path/fileName/ownership）无未知值语义，降序直接反转；
  // 优先级字段的未知值末尾语义已在 priorityCompare 内处理。
  if (
    options.direction === "desc" &&
    result !== 0 &&
    (options.field === "path" ||
      options.field === "fileName" ||
      options.field === "ownership" ||
      options.field === "ruleSource")
  ) {
    result = -result;
  }
  return result;
}

/**
 * 稳定排序：返回新数组，不修改输入。相等项保持原始相对顺序；
 * 排序不触碰 key 与任何选择数据。
 */
export function sortSelectionItems(
  items: readonly SelectionSortable[],
  options: SelectionSortOptions,
): SelectionSortable[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        compareSelectionItems(left.item, right.item, options) ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

/** 恢复调用方原始默认顺序（返回新数组，内容与输入一致）。 */
export function toDefaultOrder<T>(items: readonly T[]): T[] {
  return [...items];
}
