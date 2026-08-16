/*
 * v0.0.8 高密度列表纯逻辑底座（无 Svelte/DOM 依赖，可单测）。
 * 排序/三态/刷新交集算法一律复用 src/selection 内核，这里只提供
 * 状态优先级表、筛选匹配、中部省略、键盘导航等纯函数。
 */

import type {
  WorkbenchFileStatus,
  WorkbenchFileView,
} from "@protocol/workbenchProtocol";
import {
  sortSelectionItems,
  type SortDirection,
  type SortField,
} from "../../../selection/selectionSort";
import {
  commitSelectionRuleSourceLabels,
  fileStatusLabels,
} from "../../i18n/terminology";
import { isImeComposing } from "../../i18n/keyboard";

/** 状态产品优先级（低值在前；冲突最高优先，未知状态恒排末尾）。 */
export const FILE_STATUS_ORDER = [
  "conflicted",
  "modified",
  "replaced",
  "added",
  "deleted",
  "missing",
  "unversioned",
  "external",
  "obstructed",
  "ignored",
  "normal",
] as const;

/** 文件展示主路径（项目内路径优先）。 */
export function displayPathOf(file: WorkbenchFileView): string {
  return file.projectRelativePath ?? file.relativePath;
}

/**
 * v0.0.10：搜索匹配的结构化输入。WorkbenchFileView 结构性满足该形状；
 * 变更集条目、冲突条目等富化视图（状态等字段可选）同样适用。
 */
export interface FileQuerySource {
  relativePath: string;
  projectRelativePath?: string;
  projectName?: string;
  repositoryName?: string;
  reason?: string;
  status?: WorkbenchFileStatus;
}

/** 搜索匹配：项目内路径、仓库内路径、文件名、状态、建议原因、项目与仓库名。 */
export function matchesFileQuery(
  file: FileQuerySource,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  const haystacks = [
    file.relativePath,
    file.projectRelativePath ?? "",
    file.reason ?? "",
    file.projectName ?? "",
    file.repositoryName ?? "",
    file.status ? (fileStatusLabels[file.status] ?? "") : "",
    file.status ?? "",
  ];
  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

/**
 * 中部省略：保留文件名（含扩展名）与靠近文件的辨识目录；空间允许时
 * 保留首段目录。仅在超过 maxLength 时省略。
 */
export function middleEllipsis(value: string, maxLength = 48): string {
  if (value.length <= maxLength) return value;
  const segments = value.split("/").filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    // 单段（纯文件名）：中部省略并保留扩展名（含点），
    // 不得只在末尾加省略号导致扩展名丢失。
    const dot = value.lastIndexOf(".");
    const extension = dot > 0 ? value.slice(dot) : "";
    const stem = dot > 0 ? value.slice(0, dot) : value;
    const headLength = Math.max(1, maxLength - extension.length - 1);
    if (stem.length + extension.length <= maxLength) return value;
    return `${stem.slice(0, headLength)}…${extension}`;
  }
  const fileName = segments[segments.length - 1];
  // 从靠近文件的目录开始尽量保留，超出预算的更早目录折叠为 “…”。
  const tail: string[] = [];
  let budget = maxLength - fileName.length - 4;
  for (let index = segments.length - 2; index >= 0 && budget > 0; index -= 1) {
    const segment = segments[index];
    if (segment.length + 1 > budget) break;
    tail.unshift(segment);
    budget -= segment.length + 1;
  }
  const tailPart = tail.length > 0 ? `${tail.join("/")}/` : "";
  const head = segments[0];
  const withHead = `${head}/…/${tailPart}${fileName}`;
  const result =
    tail.length === segments.length - 1 || withHead.length > maxLength
      ? `…/${tailPart}${fileName}`
      : withHead;
  return result.length < value.length ? result : value;
}

/** 文件名（"/" 分隔路径的最后一段）。 */
export function fileNameOf(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] || path;
}

/**
 * 共享排序：作用于完整筛选数据集（不遍历已挂载 DOM）；返回新数组，
 * 不改变选择/scope。includeRuleSource 仅 Commit 需要。
 */
export function sortFileViews(
  files: readonly WorkbenchFileView[],
  options: {
    field: SortField;
    direction: SortDirection;
    includeRuleSource?: boolean;
  },
): WorkbenchFileView[] {
  const sortable = files.map((file) => ({
    // selectionKey 是 protocol 必填的 Host 身份键（SelectionKey 品牌），
    // 不得对 undefined/展示路径伪造 key。
    key: file.selectionKey,
    path: displayPathOf(file),
    fileName: fileNameOf(displayPathOf(file)),
    status: file.status,
    recommendation:
      file.selection === "selected" ? ("recommended" as const) : file.selection,
    ownership: file.projectName ?? file.repositoryName ?? "",
    ruleSource:
      options.includeRuleSource && file.evaluation?.ruleSource
        ? commitSelectionRuleSourceLabels[file.evaluation.ruleSource]
        : "",
  }));
  const sorted = sortSelectionItems(sortable, {
    field: options.field,
    direction: options.direction,
    statusOrder: FILE_STATUS_ORDER,
  });
  const order = new Map(sorted.map((item, index) => [item.key, index]));
  return [...files].sort(
    (left, right) =>
      (order.get(left.selectionKey) ?? 0) -
      (order.get(right.selectionKey) ?? 0),
  );
}

/**
 * 共享窗口计算（Changes/Commit 共用，避免第二套维护算法）：
 * 返回可见区间 [start, end)；总数不超过 virtualizeAfter 时全量渲染。
 */
export function windowedRows(options: {
  total: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  overscan: number;
  virtualizeAfter: number;
}): { start: number; end: number } {
  const {
    total,
    scrollTop,
    viewportHeight,
    rowHeight,
    overscan,
    virtualizeAfter,
  } = options;
  if (total <= virtualizeAfter) return { start: 0, end: total };
  return {
    start: Math.max(0, Math.floor(scrollTop / rowHeight) - overscan),
    end: Math.min(
      total,
      Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
    ),
  };
}

/** 一页可见行数（PageUp/PageDown 步长）。 */
export function pageSizeOf(viewportHeight: number, rowHeight: number): number {
  return Math.max(1, Math.floor(viewportHeight / rowHeight));
}

/** 拆分两行展示：文件名 + 项目内父目录。 */
export function splitPathForCell(path: string): {
  fileName: string;
  parentPath: string;
} {
  const fileName = fileNameOf(path);
  const parentPath = path
    .slice(0, path.length - fileName.length)
    .replace(/\/$/, "");
  return { fileName, parentPath };
}

/** 键盘事件是否发生在文本输入/编辑上下文或 IME 候选阶段（不得触发列表快捷键）。 */
export function isTextInputEvent(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true
  );
}

/** 列表快捷键总闸门：IME 候选与文本输入一律放行原文。 */
export function shouldHandleListKeydown(event: KeyboardEvent): boolean {
  return !isImeComposing(event) && !isTextInputEvent(event);
}

/** 线性导航：返回新的活动行索引（循环夹紧在 [0, length)）。 */
export function moveActiveIndex(
  current: number,
  delta: number,
  length: number,
): number {
  if (length <= 0) return -1;
  const next = current < 0 ? (delta > 0 ? 0 : length - 1) : current + delta;
  return Math.min(length - 1, Math.max(0, next));
}

/** Home/End 导航。 */
export function edgeActiveIndex(edge: "home" | "end", length: number): number {
  if (length <= 0) return -1;
  return edge === "home" ? 0 : length - 1;
}

/** Shift 连续选择：返回 anchor 到 active 之间（含两端）的有序项。 */
export function rangeItems<T>(
  orderedItems: readonly T[],
  anchorIndex: number,
  activeIndex: number,
): T[] {
  if (anchorIndex < 0 || activeIndex < 0) return [];
  const [start, end] =
    anchorIndex <= activeIndex
      ? [anchorIndex, activeIndex]
      : [activeIndex, anchorIndex];
  return orderedItems.slice(start, end + 1);
}
