import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type {
  ChangelistsSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

const file = (path: string): WorkbenchFileView => ({
  relativePath: path,
  selectionKey: `test-wc::${path}` as never,
  status: "modified",
  selection: "selected",
});

const snapshot: ChangelistsSnapshot = {
  kind: "changelists",
  source: "local-rule",
  aiPrivacy: {
    model: "deepseek-v4-flash",
    fileLimit: 120,
    data: "文件相对路径、状态、类型和模块分组；不发送文件正文",
    historyIncluded: false,
  },
  groups: [],
  unassigned: [file("src/a.ts")],
  suggestions: [],
  warnings: [],
};

const receipt = {
  token: "split-receipt-1",
  receipt: {
    task: "changelist-split" as const,
    projectId: "p",
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
  files: [
    {
      candidateId: "cand-a",
      projectRelativePath: "src/a.ts" as never,
      status: "modified",
      state: "analyzed",
      diffHash: "d",
      charCount: 100,
      hunkCount: 1,
    },
  ],
  excludedCount: 0,
  historyIncluded: false,
  notSent: ["本地绝对路径（只发送项目内相对路径）"],
  retentionNote: "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
};

function renderWith(overrides: Partial<ChangelistsSnapshot> = {}) {
  const onAction = vi.fn();
  render(ChangelistsModule, {
    snapshot: { ...snapshot, ...overrides },
    onAction,
  });
  return onAction;
}

describe("ChangelistsModule 语义拆分（v0.0.12 批次 B）", () => {
  it("已勾选时“按改动意图拆分”按明确勾选集合请求回执，不直接调用模型", async () => {
    const onAction = renderWith();
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    // v0.1.6 V016-D：语义拆分收进 AssistancePanel，先展开「需要帮助」。
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    await fireEvent.click(
      screen.getByRole("button", { name: /按改动意图拆分/ }),
    );
    // V025-R50：回执按明确勾选集合生成。
    expect(onAction).toHaveBeenCalledWith("changelist/preview-receipt", {
      selectedPaths: ["src/a.ts"],
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/run-semantic",
      expect.anything(),
    );
  });

  it("空选择时要求明确选择分析范围，可显式选择全部候选", async () => {
    const onAction = renderWith();
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    await fireEvent.click(
      screen.getByRole("button", { name: /按改动意图拆分/ }),
    );
    // V025-R50：空选择不回退为全部候选，不发回执请求。
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/preview-receipt",
      expect.anything(),
    );
    expect(
      screen.getByRole("region", { name: "选择语义拆分分析范围" }),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: /分析当前范围全部候选/ }),
    );
    expect(onAction).toHaveBeenCalledWith("changelist/preview-receipt", {
      selectAll: true,
    });
  });

  it("改选后旧回执本地作废并通知 Host 放弃", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot,
      onAction,
      changelistReceipt: receipt,
    });
    expect(
      screen.getByRole("region", { name: "语义拆分外发回执" }),
    ).toBeInTheDocument();
    // V025-R50：勾选变化即作废旧回执（未确认前未外发）。
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    await vi.waitFor(() =>
      expect(onAction).toHaveBeenCalledWith("changelist/receipt-dismiss", {
        token: "split-receipt-1",
      }),
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/run-semantic",
      expect.anything(),
    );
  });

  it("回执面板展示任务/模型/预算，确认后发送 run-semantic", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot,
      onAction,
      changelistReceipt: receipt,
    });
    expect(
      screen.getByRole("region", { name: "语义拆分外发回执" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("语义拆分（changelist-split）"),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "开始语义拆分" }));
    // V025-R50：确认时回传当前选择（此处无勾选，Host 侧与回执绑定集合比对）。
    expect(onAction).toHaveBeenCalledWith("changelist/run-semantic", {
      receiptToken: "split-receipt-1",
      selectedPaths: [],
    });
  });

  it("“继续仅目录分组”放弃回执并按元数据分组", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, {
      snapshot,
      onAction,
      changelistReceipt: receipt,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "继续仅目录分组" }),
    );
    expect(onAction).toHaveBeenCalledWith("changelist/receipt-dismiss", {
      token: "split-receipt-1",
    });
    expect(onAction).toHaveBeenCalledWith("changelist/suggest", {
      mode: "metadata",
    });
  });

  it("语义建议展示目的与依赖", () => {
    renderWith({
      suggestions: [
        {
          id: "s1",
          title: "拆分 1：命令注册",
          summary: "1 个文件",
          message: "feat: 调整命令注册",
          paths: ["src/a.ts"],
          reason: "基于受限差异与已确认事实推断提交意图。",
          risks: [],
          purpose: "基于受限差异与已确认事实推断提交意图。",
          dependencies: ["依赖 1 条已确认事实"],
        },
      ],
    });
    expect(screen.getByText(/目的：基于受限差异/)).toBeInTheDocument();
    expect(screen.getByText("依赖 1 条已确认事实")).toBeInTheDocument();
  });
});
