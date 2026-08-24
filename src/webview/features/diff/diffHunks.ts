/**
 * v0.0.6 页内编辑差异导航/逐块采用的轻量 hunk 计算（Webview 端，纯函数可测）。
 *
 * 基于行级 LCS 计算 BASE(original) 与工作副本(modified) 之间的差异块，
 * 每个 hunk 记录 NEW 侧（工作副本）行号区间，用于“上一个/下一个差异”
 * 与“还原此块为 BASE”。
 */

export interface DiffHunk {
  /** 该块在 NEW 侧（工作副本）的起止行号（1-based，含）。 */
  newStart: number;
  newEnd: number;
  /** 该块在 OLD 侧（BASE）的起止行号（1-based，含）。 */
  oldStart: number;
  oldEnd: number;
  /** NEW 侧该块的完整内容（含末尾换行）。 */
  newLines: string[];
  /** OLD 侧该块的完整内容。 */
  oldLines: string[];
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\n/);
}

/** 计算差异块（NEW 侧行号连续区间合并）。 */
export function computeDiffHunks(
  original: string,
  modified: string,
): DiffHunk[] {
  const oldLines = splitLines(original);
  const newLines = splitLines(modified);
  const lcs = computeLcs(oldLines, newLines);
  const hunks: DiffHunk[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let lcsIndex = 0;
  let current: DiffHunk | undefined;
  const flush = (): void => {
    if (
      current !== undefined &&
      current.oldLines.length + current.newLines.length > 0
    ) {
      hunks.push(current);
    }
    current = undefined;
  };
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    const inLcs =
      lcsIndex < lcs.length &&
      oldLine === lcs[lcsIndex] &&
      newLine === lcs[lcsIndex];
    if (inLcs) {
      flush();
      oldIndex += 1;
      newIndex += 1;
      lcsIndex += 1;
    } else if (
      oldIndex < oldLines.length &&
      (lcsIndex >= lcs.length || oldLine !== lcs[lcsIndex])
    ) {
      if (current === undefined) {
        current = {
          newStart: newIndex + 1,
          newEnd: newIndex + 1,
          oldStart: oldIndex + 1,
          oldEnd: oldIndex + 1,
          newLines: [],
          oldLines: [],
        };
      }
      current.oldLines.push(oldLine);
      current.oldEnd = oldIndex + 1;
      oldIndex += 1;
    } else if (newIndex < newLines.length) {
      if (current === undefined) {
        current = {
          newStart: newIndex + 1,
          newEnd: newIndex + 1,
          oldStart: oldIndex + 1,
          oldEnd: oldIndex + 1,
          newLines: [],
          oldLines: [],
        };
      }
      current.newLines.push(newLine);
      current.newEnd = newIndex + 1;
      newIndex += 1;
    } else {
      // 防御：剩余都算差异
      if (oldIndex < oldLines.length) {
        if (current === undefined) {
          current = {
            newStart: newIndex + 1,
            newEnd: newIndex + 1,
            oldStart: oldIndex + 1,
            oldEnd: oldIndex + 1,
            newLines: [],
            oldLines: [],
          };
        }
        current.oldLines.push(oldLines[oldIndex]);
        current.oldEnd = oldIndex + 1;
        oldIndex += 1;
      }
    }
  }
  flush();
  return hunks;
}

const PATCH_HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/**
 * v0.1.0：从 unified patch 文本解析差异块位置（修订比较模式的导航）。
 * 只读取 @@ 头中的行号区间；newLines/oldLines 留空（patch 模式为只读，
 * 不参与逐块采用）。
 */
export function computePatchHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  PATCH_HUNK_HEADER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATCH_HUNK_HEADER.exec(patch)) !== null) {
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);
    hunks.push({
      newStart,
      newEnd: newStart + Math.max(newCount, 1) - 1,
      oldStart,
      oldEnd: oldStart + Math.max(oldCount, 1) - 1,
      newLines: [],
      oldLines: [],
    });
  }
  return hunks;
}

function computeLcs(left: string[], right: string[]): string[] {
  const m = left.length;
  const n = right.length;
  if (m === 0 || n === 0) return [];
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] =
        left[i] === right[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (left[i] === right[j]) {
      result.push(left[i]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
}
