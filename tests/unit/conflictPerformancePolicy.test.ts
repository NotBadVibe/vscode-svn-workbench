import { describe, expect, it } from "vitest";
import {
  decideConflictPerformanceMode,
  V018C_LONG_LINE_THRESHOLD,
  V018C_REDUCED_CONTEXT_LINES,
  V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
} from "../../src/webview/features/diff/diffPerformancePolicy";

const T = V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER;

describe("V018-C 冲突三档阈值判定", () => {
  it("低于阈值=完整统一视图（10 块/1000 行）", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 1000, conflictBlocks: 10 },
      T,
    );
    expect(d.mode).toBe("full");
    expect(d.reasons).toEqual([]);
    expect(d.disableHighlight).toBe(false);
    expect(d.maxContextLines).toBeNull();
    expect(d.hideInactiveSourcePanes).toBe(false);
    expect(d.recommendSimplified).toBe(false);
  });

  it("边界含等于：100 块/5000 行仍为 full", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 5000, conflictBlocks: 100 },
      T,
    );
    expect(d.mode).toBe("full");
  });

  it("接近阈值档：101 块进入 reduced（关高亮/减上下文/隐藏来源）", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 1200, conflictBlocks: 101 },
      T,
    );
    expect(d.mode).toBe("reduced");
    expect(d.reasons).toContain("冲突块数超过完整模式上限");
    expect(d.disableHighlight).toBe(true);
    expect(d.maxContextLines).toBe(V018C_REDUCED_CONTEXT_LINES);
    expect(d.hideInactiveSourcePanes).toBe(true);
    expect(d.recommendSimplified).toBe(false);
  });

  it("接近阈值档：5001 行进入 reduced", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 5001, conflictBlocks: 10 },
      T,
    );
    expect(d.mode).toBe("reduced");
    expect(d.reasons).toContain("行数超过完整模式上限");
  });

  it("长行维度：小文件+超长行至少进入 reduced", () => {
    const d = decideConflictPerformanceMode(
      {
        actualLines: 50,
        conflictBlocks: 1,
        maxLineLength: V018C_LONG_LINE_THRESHOLD + 1,
      },
      T,
    );
    expect(d.mode).toBe("reduced");
    expect(d.disableHighlight).toBe(true);
  });

  it("长行边界：恰等于阈值不降级", () => {
    const d = decideConflictPerformanceMode(
      {
        actualLines: 50,
        conflictBlocks: 1,
        maxLineLength: V018C_LONG_LINE_THRESHOLD,
      },
      T,
    );
    expect(d.mode).toBe("full");
  });

  it("超阈值档：501 块进入 simplified（保留草稿+简化出口）", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 3501, conflictBlocks: 501 },
      T,
    );
    expect(d.mode).toBe("simplified");
    expect(d.reasons).toContain("冲突块数超过精简模式上限");
    expect(d.recommendSimplified).toBe(true);
    expect(d.disableHighlight).toBe(true);
  });

  it("超阈值档：10001 行进入 simplified", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 10001, conflictBlocks: 10 },
      T,
    );
    expect(d.mode).toBe("simplified");
    expect(d.reasons).toContain("行数超过精简模式上限");
  });

  it("reduced 上限边界：500 块/10000 行仍为 reduced", () => {
    const d = decideConflictPerformanceMode(
      { actualLines: 10000, conflictBlocks: 500 },
      T,
    );
    expect(d.mode).toBe("reduced");
    expect(d.recommendSimplified).toBe(false);
  });
});
