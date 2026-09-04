/*
 * V018-B 虚拟化与 Worker 决策单测（v0.1.8 规划 §4.2 go/no-go）。
 *
 * 断言平台无关：只断言决策形状、渲染器恒定与中文原因存在，
 * 不含绝对毫秒/字节阈值（绝对数在 .validation 证据中，不进断言）。
 */
import { describe, expect, it } from "vitest";
import {
  decideV018BRenderer,
  V018B_EVIDENCE_FILES,
  V018B_EVIDENCE_RUN,
  V018B_WORKER_DISPOSITION,
  V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
} from "../../src/webview/features/diff/diffPerformancePolicy";

describe("V018-B 渲染器门控（no-go）", () => {
  it("任意输入恒返回 FileDiff + 虚拟化 no-go", () => {
    for (const input of [
      { lines: 100, editMode: false, patchBranch: false },
      { lines: 6000, editMode: false, patchBranch: false },
      { lines: 6000, editMode: false, patchBranch: true },
      { lines: 6000, editMode: true, patchBranch: false },
      { lines: 20000, editMode: true, patchBranch: true },
    ]) {
      const decision = decideV018BRenderer(input);
      expect(decision.renderer).toBe("filediff");
      expect(decision.virtualization).toBe("no-go");
      expect(decision.reasons.length).toBeGreaterThan(0);
    }
  });

  it("编辑态给出布局失效风险原因", () => {
    const decision = decideV018BRenderer({
      lines: 100,
      editMode: true,
      patchBranch: false,
    });
    expect(decision.reasons.some((reason) => reason.includes("编辑态"))).toBe(
      true,
    );
  });

  it("patch 只读分支同样保持 FileDiff 并说明原因", () => {
    const decision = decideV018BRenderer({
      lines: 100,
      editMode: false,
      patchBranch: true,
    });
    expect(decision.reasons.some((reason) => reason.includes("patch"))).toBe(
      true,
    );
  });

  it("超完整模式上限行数给出降级方向（降高亮与上下文，不切换渲染器）", () => {
    const decision = decideV018BRenderer({
      lines: V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER.fullMaxLines + 1,
      editMode: false,
      patchBranch: false,
    });
    expect(
      decision.reasons.some((reason) => reason.includes("不切换渲染器")),
    ).toBe(true);
    expect(decision.renderer).toBe("filediff");
  });

  it("小文件只含首屏门禁原因（无多余降级）", () => {
    const decision = decideV018BRenderer({
      lines: 100,
      editMode: false,
      patchBranch: false,
    });
    expect(decision.reasons).toHaveLength(1);
  });
});

describe("V018-B Worker 处置（不启用，CSP 不动）", () => {
  it("禁用且无 CSP 变更，原因非空", () => {
    expect(V018B_WORKER_DISPOSITION.enabled).toBe(false);
    expect(V018B_WORKER_DISPOSITION.cspChange).toBe("none");
    expect(V018B_WORKER_DISPOSITION.reason.length).toBeGreaterThan(0);
  });
});

describe("V018-B 证据指针", () => {
  it("指向普通 evidence 运行目录与三个数据文件", () => {
    expect(V018B_EVIDENCE_RUN).toContain(".validation/evidence/v0.1.8/");
    expect([...V018B_EVIDENCE_FILES]).toEqual([
      "v018-browser.json",
      "v018-spike.json",
      "v018-spike-dom.json",
    ]);
  });
});
