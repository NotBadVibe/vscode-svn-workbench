import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import type { CommitSnapshot } from "../../src/protocol/workbenchProtocol";

const baseSnapshot: CommitSnapshot = {
  kind: "commit",
  files: [
    {
      relativePath: "src/a.ts",
      selectionKey: "test-wc::src/a.ts" as never,
      status: "modified",
      selection: "selected",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
    },
    {
      relativePath: "src/b.ts",
      selectionKey: "test-wc::src/b.ts" as never,
      status: "modified",
      selection: "selected",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
    },
  ],
  summary: { total: 2, selected: 2, needsReview: 0, excluded: 0, blocked: 0 },
  selectedPaths: ["src/a.ts", "src/b.ts"],
  message: "feat(core): update",
  messageIssues: [],
  conventionHint: "前缀：feat",
  selectionAi: { configured: false },
  aiPrivacy: [],
  templates: [],
};

function renderHandoff(overrides: Partial<CommitSnapshot> = {}) {
  const onAction = vi.fn();
  const view = render(CommitModule, {
    snapshot: { ...baseSnapshot, ...overrides },
    onAction,
  });
  return { onAction, ...view };
}

describe("CommitModule 交接显示（v0.1.4 V014-E2）", () => {
  it("交接进入时摘要条显示来源行与带入数量", () => {
    renderHandoff({
      handoff: {
        source: "changes",
        selectionVersion: 1,
        requestedCount: 2,
        keptCount: 2,
        removedEntries: [],
        receivedAt: "2026-09-03T10:00:00.000Z",
      },
    });
    // 紧凑模式摘要条区域保持。
    expect(
      screen.getByRole("region", { name: "待提交文件摘要" }),
    ).toBeInTheDocument();
    expect(screen.getByText("来自本地修改，范围未扩大")).toBeInTheDocument();
    expect(screen.getByText("已带入 2 个文件")).toBeInTheDocument();
  });

  it("收缩交接展示请求/带入数量与逐条移除原因（role=status 播报，原因文字+图标）", () => {
    const { container } = renderHandoff({
      handoff: {
        source: "changes",
        selectionVersion: 1,
        requestedCount: 3,
        keptCount: 2,
        removedEntries: [
          {
            path: "dist/out.js",
            reason: "excluded",
            message: "“dist/out.js”已变为排除项",
          },
        ],
        receivedAt: "2026-09-03T10:00:00.000Z",
      },
    });
    expect(screen.getByText(/已带入 2 个文件/)).toBeInTheDocument();
    expect(screen.getByText(/共请求 3 个/)).toBeInTheDocument();
    const removed = screen.getByRole("status", { name: "交接时移除的文件" });
    expect(removed).toBeInTheDocument();
    expect(removed).toHaveTextContent("“dist/out.js”已变为排除项");
    // reason 仅作图标/分组：有文字标签，不只靠颜色。
    expect(removed).toHaveTextContent("已排除");
    // 仍在摘要条内，属 secondary 信息。
    expect(
      screen.getByRole("region", { name: "待提交文件摘要" }).contains(removed),
    ).toBe(true);
    expect(
      container.querySelectorAll(".commit-compact .button--primary"),
    ).toHaveLength(1);
  });

  it("非法 handoff 按无交接处理（不展示来源行）", () => {
    renderHandoff({
      handoff: {
        source: "history",
        selectionVersion: 1,
        requestedCount: 2,
        keptCount: 2,
        removedEntries: [],
        receivedAt: "2026-09-03T10:00:00.000Z",
      } as unknown as CommitSnapshot["handoff"],
    });
    expect(
      screen.queryByText("来自本地修改，范围未扩大"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "待提交文件摘要" }),
    ).toBeInTheDocument();
  });

  it("无 handoff 时回到常态（交接清除后无来源行）", () => {
    renderHandoff();
    expect(
      screen.queryByText("来自本地修改，范围未扩大"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "交接时移除的文件" }),
    ).not.toBeInTheDocument();
  });

  it("feedback 含冲突指引时摘要区显示处理冲突次级入口并打开冲突模块", async () => {
    const { onAction, container } = renderHandoff({
      preview: undefined,
      feedback: {
        tone: "warning",
        message:
          "选择已变化，旧提交预览已失效（“src/a.ts”为阻止项，暂不能提交）。请先到冲突模块处理冲突，再重新预检；提交说明草稿已保留，请确认当前选择后重新预览。",
      },
    });
    const entry = screen.getByRole("button", { name: "处理冲突" });
    // 次级入口位于摘要条内，不抢唯一主操作。
    expect(
      screen.getByRole("region", { name: "待提交文件摘要" }).contains(entry),
    ).toBe(true);
    expect(entry.classList.contains("button--secondary")).toBe(true);
    await fireEvent.click(entry);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
    // 旧 preview 区保持空态：不渲染旧预览主操作，唯一主操作仍是新预览。
    expect(
      screen.queryByRole("button", { name: /确认提交/ }),
    ).not.toBeInTheDocument();
    const previewButton = screen.getByRole("button", {
      name: "预览提交 2 个文件",
    });
    expect(previewButton.classList.contains("button--primary")).toBe(true);
    expect(
      container.querySelectorAll(".commit-compact .button--primary"),
    ).toHaveLength(1);
  });

  it("无冲突指引时不显示处理冲突入口", () => {
    renderHandoff({
      feedback: {
        tone: "warning",
        message: "提交选择规则已更新，候选分类已按新规则刷新。",
      },
    });
    expect(
      screen.queryByRole("button", { name: "处理冲突" }),
    ).not.toBeInTheDocument();
  });
});
