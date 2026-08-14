/*
 * v0.0.8 文件选择适配层（Webview）。
 *
 * 只做 WorkbenchFileView → 选择内核输入的权威映射与 key ↔ relativePath
 * 的往返查表；不构造 identity 键（selectionKey 只能来自 Host 快照），
 * 不包含第二套三态/排序/刷新算法（全部复用 src/selection 内核）。
 */

import type { WorkbenchFileView } from "@protocol/workbenchProtocol";
import type {
  SelectableItem,
  SelectionKey,
} from "../../selection/selectionCore";

/** 列表动作上下文：actionability 按动作权威决定。 */
export type FileListMode = "commit" | "changes";

/**
 * 行级逐项选择资格（动作权威）：blocked 任何模式都不可选；excluded 在
 * Commit 下不可选，在 Changes 的非提交动作中可由用户逐项明确选择。
 */
export function canSelectIndividually(
  file: Pick<WorkbenchFileView, "selection">,
  mode: FileListMode,
): boolean {
  if (file.selection === "blocked") return false;
  if (mode === "commit" && file.selection === "excluded") return false;
  return true;
}

/**
 * 批量/三态的可操作性（动作权威）：逐项可选不等于批量可操作——excluded
 * 在任何批量动作中都不可操作；最终 payload 仍由 Host 按动作复验。
 */
export function isActionableForMode(
  file: Pick<WorkbenchFileView, "selection">,
  mode: FileListMode,
): boolean {
  if (!canSelectIndividually(file, mode)) return false;
  if (file.selection === "excluded") return false;
  return true;
}

/** 把快照文件映射为内核选择项；缺少 Host 身份键的文件不进入选择运算。 */
export function toSelectableItems(
  files: readonly WorkbenchFileView[],
  mode: FileListMode,
): SelectableItem[] {
  const items: SelectableItem[] = [];
  for (const file of files) {
    if (!file.selectionKey) continue;
    items.push({
      key: file.selectionKey,
      actionable: isActionableForMode(file, mode),
      blocked: file.selection === "blocked",
      excluded: file.selection === "excluded",
      needsReview: file.selection === "needsReview",
      recommended: file.selection === "selected",
    });
  }
  return items;
}

/** selectionKey → relativePath 查表（action payload 仍提交 relativePath）。 */
export function buildKeyPathMap(
  files: readonly WorkbenchFileView[],
): Map<SelectionKey, string> {
  const map = new Map<SelectionKey, string>();
  for (const file of files) {
    if (file.selectionKey) map.set(file.selectionKey, file.relativePath);
  }
  return map;
}

/** relativePath → selectionKey 反查表（Host 权威选择回显时使用）。 */
export function buildPathKeyMap(
  files: readonly WorkbenchFileView[],
): Map<string, SelectionKey> {
  const map = new Map<string, SelectionKey>();
  for (const file of files) {
    if (file.selectionKey) map.set(file.relativePath, file.selectionKey);
  }
  return map;
}

/** 克隆选择集合（组件内不直接构造可变集合，保持 lint 响应式约束）。 */
export function cloneSelection(
  selected: ReadonlySet<SelectionKey>,
): Set<SelectionKey> {
  return new Set(selected);
}

/** 把选择集合还原为 relativePath 列表；快照中已消失的 key 被丢弃。 */
export function pathsFromKeys(
  keys: Iterable<SelectionKey>,
  keyToPath: ReadonlyMap<SelectionKey, string>,
): string[] {
  const paths: string[] = [];
  for (const key of keys) {
    const path = keyToPath.get(key);
    if (path !== undefined) paths.push(path);
  }
  return paths;
}
