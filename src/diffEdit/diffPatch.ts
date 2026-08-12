/**
 * 最小 unified diff 生成器（草稿导出/恢复对比用）。
 * 基于行级 LCS，输出 `--- a/... +++ b/...` + `@@ -a,b +c,d @@` 头与 +/- 行，
 * 供用户审阅或 `svn patch` 风格人工使用；不作为权威 SVN 语义。
 */

export function diffLines(
  base: string[],
  edited: string[],
  filePath: string,
): string {
  const lcs = computeLcs(base, edited);
  const patch: string[] = [];
  patch.push(`--- a/${filePath}`);
  patch.push(`+++ b/${filePath}`);
  const hunks: Array<Array<{ line: string; type: " " | "+" | "-" }>> = [];
  let current: Array<{ line: string; type: " " | "+" | "-" }> | undefined;
  const pushLine = (line: string, type: " " | "+" | "-"): void => {
    if (type === " ") {
      if (current !== undefined && current.length > 0) hunks.push(current);
      current = undefined;
    } else {
      current = current ?? [];
      current.push({ line, type });
    }
  };
  let bi = 0;
  let ei = 0;
  let li = 0;
  while (bi < base.length || ei < edited.length) {
    if (li < lcs.length && base[bi] === lcs[li] && edited[ei] === lcs[li]) {
      pushLine(base[bi], " ");
      bi += 1;
      ei += 1;
      li += 1;
    } else if (bi < base.length && (li >= lcs.length || base[bi] !== lcs[li])) {
      pushLine(base[bi], "-");
      bi += 1;
    } else {
      pushLine(edited[ei], "+");
      ei += 1;
    }
  }
  if (current !== undefined && current.length > 0) hunks.push(current);

  let baseLine = 1;
  let editedLine = 1;
  for (const hunk of hunks) {
    const minusCount = hunk.filter((line) => line.type === "-").length;
    const plusCount = hunk.filter((line) => line.type === "+").length;
    patch.push(`@@ -${baseLine},${minusCount} +${editedLine},${plusCount} @@`);
    for (const line of hunk) {
      patch.push(`${line.type}${line.line}`);
      if (line.type !== "+") baseLine += 1;
      if (line.type !== "-") editedLine += 1;
    }
  }
  if (hunks.length === 0) {
    return `--- a/${filePath}\n+++ b/${filePath}\n（无差异）\n`;
  }
  return `${patch.join("\n")}\n`;
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
