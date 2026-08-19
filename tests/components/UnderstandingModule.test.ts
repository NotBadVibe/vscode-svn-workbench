import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import UnderstandingModule from "../../src/webview/features/understanding/UnderstandingModule.svelte";
import type { ChangeUnderstandingSnapshot } from "../../src/protocol/workbenchProtocol";

const snapshot: ChangeUnderstandingSnapshot = {
  kind: "change-understanding",
  state: "idle",
  source: "local-rule",
  binding: {
    repositoryUuid: "uuid-1",
    scopeHash: "scope-1",
    candidateHash: "candidates-1",
    revision: "7",
    generatedAt: "2026-08-18T10:00:00.000Z",
  },
  receipt: {
    task: "understand-changes",
    projectId: "project-1",
    model: "deepseek-v4-flash",
    dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
    files: 1,
    totalBudget: 40000,
    perFileBudget: 6000,
    historyIncluded: false,
  },
  coverage: {
    total: 1,
    analyzed: 1,
    truncated: 0,
    binary: 0,
    readFailed: 0,
    budgetExcluded: 0,
  },
  coverageFiles: [
    {
      candidateId: "cand-a",
      projectRelativePath: "src/a.ts" as never,
      status: "modified",
      state: "analyzed",
      diffHash: "deadbeef",
      charCount: 120,
      hunkCount: 1,
    },
  ],
  changes: [
    {
      id: "local-1",
      statement: "修改了 1 个文件：src/a.ts。",
      source: "local-rule",
      status: "confirmed",
      confidenceReason: "差异正文已本地核对。",
      evidence: [
        {
          candidateId: "cand-a",
          hunkId: "hunk-1",
          projectRelativePath: "src/a.ts",
        },
      ],
      invalidEvidence: [],
      limitations: [],
      nextAction: "打开证据核对具体改动。",
    },
  ],
  findings: [
    {
      id: "model-f1",
      category: "evidence-gap",
      statement: "src/b.ts 差异被截断，具体行为无法判断。",
      source: "configured-model",
      severity: "warning",
      consequence: "提交说明可能遗漏行为变化。",
      evidence: [],
      invalidEvidence: [],
      limitations: [],
      nextAction: "重试失败项。",
    },
  ],
  verification: [
    {
      id: "verify-1",
      title: "类型与组件回归",
      reason: "检测到 TypeScript 变更。",
      command: "npm run check && npm run test:unit",
      gate: "general",
    },
  ],
  userConfirmations: [],
  limitations: [],
  warnings: [],
};

const receiptView = {
  token: "receipt-token-1",
  receipt: snapshot.receipt,
  coverage: snapshot.coverage,
  files: snapshot.coverageFiles,
  excludedCount: 0,
  historyIncluded: false,
  notSent: ["本地绝对路径（只发送项目内相对路径）"],
  retentionNote: "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
};

function renderUnderstanding(
  overrides: Partial<ChangeUnderstandingSnapshot> = {},
) {
  const onAction = vi.fn();
  render(UnderstandingModule, {
    snapshot: { ...snapshot, ...overrides },
    onAction,
  });
  return onAction;
}

describe("UnderstandingModule 变更解读", () => {
  it("首屏展示用途、范围与“只运行本地检查 / 查看并开始分析”", () => {
    renderUnderstanding();
    expect(
      screen.getByText(/理解当前修改、找出需要确认的风险/),
    ).toBeInTheDocument();
    expect(screen.getByText(/AI 不会修改文件或执行提交/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "只运行本地检查" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看并开始分析（1）" }),
    ).toBeInTheDocument();
  });

  it("“只运行本地检查”发送 run-local", async () => {
    const onAction = renderUnderstanding();
    await fireEvent.click(
      screen.getByRole("button", { name: "只运行本地检查" }),
    );
    expect(onAction).toHaveBeenCalledWith("understanding/run-local", {});
  });

  it("回执面板展示任务/模型/预算，确认后发送 run-model", async () => {
    const onAction = renderUnderstanding();
    const { rerender } = render(UnderstandingModule, {
      snapshot,
      onAction,
      understandingReceipt: receiptView,
    });
    void rerender;
    expect(
      screen.getByRole("region", { name: "变更解读外发回执" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("变更解读（understand-changes）"),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "开始模型分析" }));
    expect(onAction).toHaveBeenCalledWith("understanding/run-model", {
      receiptToken: "receipt-token-1",
    });
  });

  it("结果展示改了什么/需要你确认/影响与验证/会话内确认，证据可打开差异", async () => {
    const onAction = renderUnderstanding({ state: "ready", source: "mixed" });
    expect(
      screen.getByRole("heading", { name: "这次改了什么" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "需要你确认" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "影响与验证" }),
    ).toBeInTheDocument();
    // 证据打开差异。
    await fireEvent.click(screen.getByRole("button", { name: "打开差异" }));
    expect(onAction).toHaveBeenCalledWith("understanding/open-evidence", {
      candidateId: "cand-a",
      hunkId: "hunk-1",
      projectRelativePath: "src/a.ts",
    });
  });

  it("确认事实（IME 保护）+ 清除会话内确认", async () => {
    const onAction = renderUnderstanding({ state: "ready" });
    const input = screen.getByLabelText("输入要确认的事实");
    await fireEvent.input(input, { target: { value: "事实 A。" } });
    // IME 候选阶段 Enter 不触发确认。
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, "isComposing", { value: true });
    input.dispatchEvent(composing);
    expect(onAction).not.toHaveBeenCalledWith(
      "understanding/confirm-fact",
      expect.anything(),
    );
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("understanding/confirm-fact", {
      statement: "事实 A。",
    });
  });

  it("待复核确认展示标记", () => {
    renderUnderstanding({
      state: "stale",
      stale: true,
      userConfirmations: [
        {
          id: "u1",
          statement: "事实 A。",
          confirmedAt: "2026-08-18T00:00:00.000Z",
          candidateHash: "old",
          needsReview: true,
        },
      ],
    });
    expect(screen.getByText("待复核")).toBeInTheDocument();
    expect(screen.getByText(/不会静默沿用/)).toBeInTheDocument();
  });

  it("过期结果只读：禁止打开证据", () => {
    renderUnderstanding({ state: "stale", stale: true });
    expect(screen.getByRole("button", { name: "打开差异" })).toBeDisabled();
  });
});
