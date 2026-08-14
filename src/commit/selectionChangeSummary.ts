/*
 * v0.0.8 选择变更摘要（纯函数）：本地规则或 AI 建议更新选择时，说明
 * 新增、移除与保留的手动选择。
 */

export interface SelectionChangeSummary {
  added: number;
  kept: number;
  removed: number;
}

export function summarizeSelectionChange(
  previous: readonly string[],
  next: readonly string[],
): SelectionChangeSummary {
  const previousSet = new Set(previous);
  const nextSet = new Set(next);
  return {
    added: next.filter((item) => !previousSet.has(item)).length,
    kept: previous.filter((item) => nextSet.has(item)).length,
    removed: previous.filter((item) => !nextSet.has(item)).length,
  };
}

/** 中文摘要句：新增 X、保留 Y、移除 Z 个手动选择。 */
export function describeSelectionChange(
  previous: readonly string[],
  next: readonly string[],
): string {
  const summary = summarizeSelectionChange(previous, next);
  return `新增 ${summary.added} 个、保留 ${summary.kept} 个手动选择、移除 ${summary.removed} 个`;
}
