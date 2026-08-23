import type { WorkbenchFileView } from "@protocol/workbenchProtocol";

/*
 * v0.0.17 批次 E（C-13）：文件类型筛选与命名筛选预设的共享纯逻辑。
 * 筛选只影响视图，不改变真实操作范围，也不与决策层的
 * commitSelection.pathRules 混用（后者是提交选择规则，不是视图筛选）。
 */

/** 无扩展名文件的筛选值。 */
export const NO_EXTENSION_KEY = "(no-extension)";

/** 从当前候选路径推导文件类型选项（扩展名 → 数量），不虚构取值。 */
export function deriveFileTypeOptions(
  files: WorkbenchFileView[],
): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const fileName = file.relativePath.split("/").pop() ?? file.relativePath;
    const dot = fileName.lastIndexOf(".");
    const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : NO_EXTENSION_KEY;
    counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({
      value,
      label: value === NO_EXTENSION_KEY ? "无扩展名" : value,
      count,
    }));
}

/** 简单通配符匹配：* 匹配任意字符（含空），匹配文件名（大小写不敏感）。 */
export function matchesFilePattern(fileName: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (!normalized) return false;
  const regex = new RegExp(
    `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, (char) =>
      char === "*" ? ".*" : `\\${char}`,
    )}$`,
  );
  return regex.test(fileName.toLowerCase());
}

export function matchesFilePatterns(
  relativePath: string,
  patterns: string[],
): boolean {
  if (patterns.length === 0) return true;
  const fileName = relativePath.split("/").pop() ?? relativePath;
  return patterns.some((pattern) => matchesFilePattern(fileName, pattern));
}

/**
 * 文件类型筛选值 → 等价 patterns（保存预设时使用）。
 * 无扩展名集合无法用文件名通配符精确表达，返回空数组，调用方禁止保存。
 */
export function fileTypeToPattern(typeKey: string): string[] {
  if (typeKey === "all") return ["*"];
  if (typeKey === NO_EXTENSION_KEY) return [];
  return [`*${typeKey}`];
}
