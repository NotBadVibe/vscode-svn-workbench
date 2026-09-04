import { describe, expect, it } from "vitest";
import {
  blockFraction,
  buildConflictOverviewBlocks,
  buildDiffOverviewBlocks,
  countWhitespaceOnlyConflictBlocks,
  overviewBlockAriaLabel,
  overviewStatusText,
  overviewSummaryLabel,
} from "../../src/webview/features/diff/diffOverviewModel";
import type { DiffHunk } from "../../src/webview/features/diff/diffHunks";

function makeHunk(newStart: number, newEnd: number): DiffHunk {
  return {
    newStart,
    newEnd,
    oldStart: newStart,
    oldEnd: newEnd,
    newLines: [`line-${newStart}`],
    oldLines: [],
  };
}

function makeConflictText(blocks: number): string {
  const parts: string[] = [];
  for (let i = 0; i < blocks; i += 1) {
    parts.push(
      `<<<<<<< .mine\nmine-${i}  x\n||||||| .r1\nbase-${i}\n=======\ntheirs-${i}\n>>>>>>> .r2`,
    );
  }
  return `${parts.join("\n")}\n`;
}

describe("diffOverviewModel 定位器纯模型（V018-D §4.4）", () => {
  it("blockFraction 钳制到 0..1", () => {
    expect(blockFraction(1, 10, 100)).toEqual({ top: 0, height: 0.1 });
    expect(blockFraction(-5, 9999, 100).top).toBeGreaterThanOrEqual(0);
    expect(blockFraction(-5, 9999, 100).height).toBeLessThanOrEqual(1);
    expect(blockFraction(1, 1, 0)).toEqual({ top: 0, height: 1 });
  });

  it("状态双通道：图形+文字，不只靠颜色", () => {
    expect(overviewStatusText("change")).toContain("变更");
    expect(overviewStatusText("conflict-unresolved")).toContain("未处理");
    expect(overviewStatusText("whitespace-only")).toContain("仅空白");
  });

  it("aria-label 含位置与状态", () => {
    const blocks = buildDiffOverviewBlocks([makeHunk(5, 7)]);
    expect(overviewBlockAriaLabel(0, 1, blocks[0])).toContain("第 1/1 块");
    expect(overviewBlockAriaLabel(0, 1, blocks[0])).toContain("第 5 行");
  });

  it("普通 Diff 块行号与预览稳定", () => {
    const blocks = buildDiffOverviewBlocks([makeHunk(2, 2), makeHunk(20, 25)]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].key).toBe("diff-0");
    expect(blocks[1].startLine).toBe(20);
    expect(blocks[1].endLine).toBe(25);
    expect(blocks.every((b) => b.status === "change")).toBe(true);
  });

  it("冲突块行号换算且不改 marker", () => {
    const text = makeConflictText(3);
    const blocks = buildConflictOverviewBlocks(text, false);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[1].startLine).toBeGreaterThan(blocks[0].startLine);
    expect(blocks.every((b) => b.status === "conflict-unresolved")).toBe(true);
    expect(text).toContain("<<<<<<< .mine");
  });

  it("忽略空白时纯空白冲突块标为 whitespace-only（文本不变）", () => {
    const text = [
      "<<<<<<< .mine",
      "same  text",
      "||||||| .r1",
      "same\ttext",
      "=======",
      "same text",
      ">>>>>>> .r2",
      "",
    ].join("\n");
    const plain = buildConflictOverviewBlocks(text, false);
    const ignored = buildConflictOverviewBlocks(text, true);
    expect(plain[0].status).toBe("conflict-unresolved");
    expect(ignored[0].status).toBe("whitespace-only");
    expect(countWhitespaceOnlyConflictBlocks(text)).toBe(1);
  });

  it("损坏文本返回空数组（fail-closed）", () => {
    expect(buildConflictOverviewBlocks("not a conflict", false)).toEqual([]);
    expect(countWhitespaceOnlyConflictBlocks("not a conflict")).toBe(0);
  });

  it("摘要 X/Y 文字通道", () => {
    expect(overviewSummaryLabel(0, 0)).toContain("暂无");
    expect(overviewSummaryLabel(1, 5)).toBe("定位器 2/5 块");
  });

  it("100/500 块模型构建满足导航预算（P95 ≤100ms，纯函数）", () => {
    for (const count of [100, 500]) {
      const text = makeConflictText(count);
      const samples: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const start = performance.now();
        const blocks = buildConflictOverviewBlocks(text, true);
        // 模拟导航：占比 + aria 全量计算
        for (let j = 0; j < blocks.length; j += 1) {
          blockFraction(blocks[j].startLine, blocks[j].endLine, 10000);
          overviewBlockAriaLabel(j, blocks.length, blocks[j]);
        }
        samples.push(performance.now() - start);
        expect(blocks).toHaveLength(count);
      }
      samples.sort((a, b) => a - b);
      const p95 =
        samples[
          Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)
        ];
      expect(p95).toBeLessThan(100);
    }
  });
});
