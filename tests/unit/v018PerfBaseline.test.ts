/*
 * V018-A 基线单测：fixture 确定性、P50/P95 计算、阈值策略纯函数。
 * 断言平台无关（只比较相对关系与确定性，不含绝对毫秒/字节阈值）。
 */
import { describe, expect, it } from "vitest";
import {
  buildV018BaselineMatrix,
  generateV018ConflictFixture,
  generateV018DiffFixture,
  V018_CONFLICT_BLOCK_TIERS,
  V018_CONFLICT_LINE_TIERS,
  V018_DIFF_LINE_TIERS,
  V018_FIXED_SEED,
  type V018ConflictSpec,
  type V018DiffSpec,
} from "../performance/v018PerfFixtures";
import {
  collectV018Metadata,
  isV018StableGateMetric,
  summarizeV018Runs,
  v018MetricStabilityNote,
  v018Percentile,
} from "../performance/v018PerfStats";
import {
  suggestDiffPerformanceMode,
  V018_CANDIDATE_BUDGETS,
} from "../../src/webview/features/diff/diffPerformancePolicy";

const diffSpec: V018DiffSpec = {
  language: "ts",
  lines: 1000,
  changeRatio: 0.1,
  longLines: false,
  eol: "lf",
  noTrailingNewline: false,
  seed: V018_FIXED_SEED,
};

const conflictSpec: V018ConflictSpec = {
  language: "ts",
  lines: 1000,
  conflictBlocks: 10,
  eol: "lf",
  longLines: false,
  seed: V018_FIXED_SEED,
};

describe("V018-A 普通 Diff fixture 确定性", () => {
  it("同 seed 同输出（字节级一致）", () => {
    const first = generateV018DiffFixture(diffSpec);
    const second = generateV018DiffFixture(diffSpec);
    expect(second.original).toBe(first.original);
    expect(second.modified).toBe(first.modified);
    expect(second.hunkCount).toBe(first.hunkCount);
  });

  it("不同 seed 输出不同（变更侧与 BASE 侧无关，比较 modified）", () => {
    const other = generateV018DiffFixture({ ...diffSpec, seed: 1 });
    expect(other.modified).not.toBe(generateV018DiffFixture(diffSpec).modified);
  });
});

describe("V018-A 冲突 fixture 确定性", () => {
  it("同 seed 同输出且块数精确", () => {
    const first = generateV018ConflictFixture(conflictSpec);
    const second = generateV018ConflictFixture(conflictSpec);
    expect(second.content).toBe(first.content);
    expect(first.actualBlocks).toBe(10);
    expect(first.content).toContain("<<<<<<< mine");
    expect(first.content).toContain(">>>>>>> theirs");
  });

  it("不同 seed 输出不同", () => {
    const other = generateV018ConflictFixture({ ...conflictSpec, seed: 7 });
    expect(other.content).not.toBe(
      generateV018ConflictFixture(conflictSpec).content,
    );
  });

  it("块放不下时实际行数上浮且如实记录（500 块 × 1000 行）", () => {
    const fixture = generateV018ConflictFixture({
      ...conflictSpec,
      lines: 1000,
      conflictBlocks: 500,
    });
    expect(fixture.actualBlocks).toBe(500);
    expect(fixture.actualLines).toBeGreaterThanOrEqual(500 * 7);
  });
});

describe("V018-A P50/P95 计算", () => {
  it("ceil 口径分位数正确", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(v018Percentile(values, 0.5)).toBe(5);
    expect(v018Percentile(values, 0.95)).toBe(10);
    expect(v018Percentile([], 0.5)).toBe(0);
  });

  it("汇总满足 min ≤ P50 ≤ P95 ≤ max", () => {
    const summary = summarizeV018Runs([12, 3, 7, 25, 9, 4]);
    expect(summary.runs).toBe(6);
    expect(summary.min).toBeLessThanOrEqual(summary.p50);
    expect(summary.p50).toBeLessThanOrEqual(summary.p95);
    expect(summary.p95).toBeLessThanOrEqual(summary.max);
    expect(summarizeV018Runs([]).runs).toBe(0);
  });
});

describe("V018-A 门禁稳定性划分", () => {
  it("稳定指标进门禁，易抖指标只记趋势", () => {
    expect(isV018StableGateMetric("fixtureBuild")).toBe(true);
    expect(isV018StableGateMetric("heapUsed")).toBe(false);
    expect(isV018StableGateMetric("firstPlainRender")).toBe(false);
    expect(v018MetricStabilityNote("fixtureBuild")).toContain("稳定指标");
    expect(v018MetricStabilityNote("longTask")).toContain("趋势观察");
  });

  it("运行元数据字段齐全且不虚构", () => {
    const metadata = collectV018Metadata({});
    expect(metadata.nodeVersion).toBe(process.version);
    expect(metadata.vscodeVersion).toBe("unknown");
    expect(metadata.measuredAt).not.toBe("");
  });
});

describe("V018-A 阈值策略纯函数", () => {
  it("小文件保持完整模式且无降级原因", () => {
    expect(
      suggestDiffPerformanceMode({ lines: 100, conflictBlocks: 0 }),
    ).toEqual({ mode: "full", reasons: [] });
  });

  it("超行数进入精简模式并给出中文原因", () => {
    const decision = suggestDiffPerformanceMode({
      lines: 6000,
      conflictBlocks: 0,
    });
    expect(decision.mode).toBe("reduced");
    expect(decision.reasons).toContain("行数超过完整模式上限");
  });

  it("超冲突块数进入精简模式并给出中文原因", () => {
    const decision = suggestDiffPerformanceMode({
      lines: 100,
      conflictBlocks: 200,
    });
    expect(decision.mode).toBe("reduced");
    expect(decision.reasons).toContain("冲突块数超过完整模式上限");
  });

  it("双超二级上限进入简化模式", () => {
    const decision = suggestDiffPerformanceMode({
      lines: 20000,
      conflictBlocks: 600,
    });
    expect(decision.mode).toBe("simplified");
    expect(decision.reasons.length).toBeGreaterThan(0);
  });

  it("候选预算与规划 §3 一致", () => {
    expect(V018_CANDIDATE_BUDGETS.diff5000FirstVisibleP95Ms).toBe(800);
    expect(V018_CANDIDATE_BUDGETS.conflict100FirstActionableP95Ms).toBe(1000);
    expect(V018_CANDIDATE_BUDGETS.blockActionP95Ms).toBe(100);
    expect(V018_CANDIDATE_BUDGETS.inputP95Ms).toBe(50);
    expect(V018_CANDIDATE_BUDGETS.navigationP95Ms).toBe(100);
    expect(V018_CANDIDATE_BUDGETS.highlightLongTaskMs).toBe(50);
  });
});

describe("V018-A 基线矩阵", () => {
  it("普通 Diff 4 行档 + 语言/EOL 变体，冲突 3 块档 × 3 行档", () => {
    const matrix = buildV018BaselineMatrix();
    const diffs = matrix.filter((item) => item.kind === "diff");
    const conflicts = matrix.filter((item) => item.kind === "conflict");
    for (const lines of V018_DIFF_LINE_TIERS) {
      expect(diffs.some((item) => item.id === `diff-ts-${lines}-mid`)).toBe(
        true,
      );
    }
    expect(conflicts.length).toBe(
      V018_CONFLICT_BLOCK_TIERS.length * V018_CONFLICT_LINE_TIERS.length,
    );
    const ids = new Set(matrix.map((item) => item.id));
    expect(ids.size).toBe(matrix.length);
  });
});
