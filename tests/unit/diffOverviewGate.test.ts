import { describe, expect, it } from "vitest";
import {
  decideDiffOverviewGate,
  V018D_OVERVIEW_BLOCK_THRESHOLD,
} from "../../src/webview/features/diff/diffPerformancePolicy";

describe("DiffOverview 阈值门控（V018-D 纪律修正）", () => {
  it("阈值集中为 100（含等于默认展开）", () => {
    expect(V018D_OVERVIEW_BLOCK_THRESHOLD).toBe(100);
  });

  it("99 块默认展开（未门控）", () => {
    const decision = decideDiffOverviewGate(99);
    expect(decision.gated).toBe(false);
    expect(decision.defaultExpanded).toBe(true);
    expect(decision.reasons).toEqual([]);
  });

  it("100 块默认展开（边界含等于）", () => {
    const decision = decideDiffOverviewGate(100);
    expect(decision.gated).toBe(false);
    expect(decision.defaultExpanded).toBe(true);
  });

  it("101 块默认折叠（门控，中文原因）", () => {
    const decision = decideDiffOverviewGate(101);
    expect(decision.gated).toBe(true);
    expect(decision.defaultExpanded).toBe(false);
    expect(decision.reasons.join("")).toContain("101");
    expect(decision.reasons.join("")).toContain("100");
  });

  it("空块与非法输入钳制为未门控", () => {
    expect(decideDiffOverviewGate(0).gated).toBe(false);
    expect(decideDiffOverviewGate(-5).blockCount).toBe(0);
  });
});
