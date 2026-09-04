/*
 * V018-E 同步只读比较窗格门控单测（v0.1.8 规划 §4.5 no-go）。
 *
 * 断言平台无关：只断言门控形状、恒 no-go 与中文原因存在，
 * 不含绝对毫秒/字节阈值，不读 DOM，不调用 pierre 私有 API。
 */
import { describe, expect, it } from "vitest";
import {
  decideV018ESyncPanes,
  V018E_EVIDENCE_NOTE,
  V018E_MULTICOLUMN_MIN_WIDTH_PX,
  V018E_SYNC_API_DISPOSITION,
  V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
  type V018ESyncPanesInput,
} from "../../src/webview/features/diff/diffPerformancePolicy";

const baseInput: V018ESyncPanesInput = {
  actualLines: 100,
  conflictBlocks: 5,
  hasBase: true,
  hasMine: true,
  hasTheirs: true,
  truncated: false,
  hasReadError: false,
  viewportWidthPx: 1440,
  userEnabled: true,
};

describe("V018-E 同步窗格门控（no-go，保留单视口）", () => {
  it("多栏门限为 1024px（含等于）", () => {
    expect(V018E_MULTICOLUMN_MIN_WIDTH_PX).toBe(1024);
  });

  it("跨窗格纵向同步处置为 no-go 且原因非空", () => {
    expect(V018E_SYNC_API_DISPOSITION.crossPaneVertical).toBe("no-go");
    expect(V018E_SYNC_API_DISPOSITION.reason.length).toBeGreaterThan(0);
  });

  it("证据说明指向静态审计 + 复用 V018-B 运行，无三实例运行", () => {
    expect(V018E_EVIDENCE_NOTE).toContain("无三实例");
  });

  it("最优输入仍不启用（no-go 恒门控），且含同步 API 原因", () => {
    const decision = decideV018ESyncPanes(baseInput);
    expect(decision.enabled).toBe(false);
    expect(decision.gated).toBe(true);
    expect(
      decision.reasons.some((reason) => reason.includes("ScrollSyncManager")),
    ).toBe(true);
  });

  it("缺 BASE 时给出内容不完整原因", () => {
    const decision = decideV018ESyncPanes({ ...baseInput, hasBase: false });
    expect(decision.enabled).toBe(false);
    expect(
      decision.reasons.some((reason) => reason.includes("只读来源不完整")),
    ).toBe(true);
  });

  it("截断或读取失败时 fail-closed", () => {
    for (const input of [
      { ...baseInput, truncated: true },
      { ...baseInput, hasReadError: true },
    ]) {
      const decision = decideV018ESyncPanes(input);
      expect(decision.enabled).toBe(false);
      expect(
        decision.reasons.some((reason) => reason.includes("只读来源不完整")),
      ).toBe(true);
    }
  });

  it("超完整模式上限（行数/块数/长行）给出预算原因", () => {
    const overLines = decideV018ESyncPanes({
      ...baseInput,
      actualLines: V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER.fullMaxLines + 1,
    });
    expect(
      overLines.reasons.some((reason) => reason.includes("不在预算内")),
    ).toBe(true);
    const overBlocks = decideV018ESyncPanes({
      ...baseInput,
      conflictBlocks:
        V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER.fullMaxConflictBlocks + 1,
    });
    expect(
      overBlocks.reasons.some((reason) => reason.includes("不在预算内")),
    ).toBe(true);
    const longLine = decideV018ESyncPanes({
      ...baseInput,
      maxLineLength: 1001,
    });
    expect(
      longLine.reasons.some((reason) => reason.includes("不在预算内")),
    ).toBe(true);
  });

  it("视口不足 1024px 或未知时回 Tabs/单视口", () => {
    for (const input of [
      { ...baseInput, viewportWidthPx: 1023 },
      { ...baseInput, viewportWidthPx: 720 },
      { ...baseInput, viewportWidthPx: undefined },
    ]) {
      const decision = decideV018ESyncPanes(input);
      expect(decision.enabled).toBe(false);
      expect(decision.reasons.some((reason) => reason.includes("单视口"))).toBe(
        true,
      );
    }
    const atThreshold = decideV018ESyncPanes({
      ...baseInput,
      viewportWidthPx: 1024,
    });
    expect(
      atThreshold.reasons.some((reason) => reason.includes("视口不足")),
    ).toBe(false);
  });

  it("默认关闭：未显式开启时给出默认关闭原因", () => {
    const decision = decideV018ESyncPanes({
      ...baseInput,
      userEnabled: false,
    });
    expect(decision.enabled).toBe(false);
    expect(decision.reasons.some((reason) => reason.includes("默认关闭"))).toBe(
      true,
    );
  });

  it("负数与小数输入被钳制，不抛异常且仍 no-go", () => {
    const decision = decideV018ESyncPanes({
      ...baseInput,
      actualLines: -5.7,
      conflictBlocks: -2,
      maxLineLength: -10,
      viewportWidthPx: 1439.6,
    });
    expect(decision.enabled).toBe(false);
    expect(decision.gated).toBe(true);
    expect(decision.reasons.length).toBeGreaterThan(0);
  });
});
