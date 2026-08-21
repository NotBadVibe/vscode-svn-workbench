import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ActivityModule from "../../src/webview/features/activity/ActivityModule.svelte";
import type { ActivitySnapshot } from "../../src/protocol/workbenchProtocol";

const baseSnapshot: ActivitySnapshot = {
  kind: "activity",
  generatedAt: new Date().toISOString(),
  records: [
    {
      id: "1",
      capturedAt: new Date(Date.now() - 2 * 60000).toISOString(),
      kind: "operation-execution",
      moduleId: "commit",
      taskId: "commit/compose",
      scopeHash: "hash-a",
      repositoryUuid: "uuid-1",
      scopeLabel: "提交 3 个文件",
      impactedCount: 3,
      previewSummary: "svn commit 3 files",
      result: "failed",
      errorReason: "远端已更新",
      nextActions: [
        { id: "retry", label: "重试" },
        { id: "open-output", label: "打开日志" },
        { id: "copy-diagnostics", label: "复制诊断信息" },
      ],
      nonRecoverable: true,
      nonRecoverableReason: "此操作不能在工作台中一键撤销",
    },
    {
      id: "2",
      capturedAt: new Date().toISOString(),
      kind: "draft-checkpoint",
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
      scopeHash: "hash-a",
      repositoryUuid: "uuid-1",
      scopeLabel: "冲突草稿 src/conflict/example.ts",
      impactedCount: 1,
      previewSummary: "已保存草稿",
      nextActions: [{ id: "open-output", label: "打开日志" }],
    },
  ],
};

describe("ActivityModule（v0.0.16 时间线视图）", () => {
  it("展示记录列表、错误内联与非可撤销文案", () => {
    render(ActivityModule, { snapshot: baseSnapshot, onAction: vi.fn() });
    expect(screen.getByText("提交 3 个文件")).toBeInTheDocument();
    expect(screen.getByText(/失败原因/)).toBeInTheDocument();
    expect(
      screen.getByText(/此操作不能在工作台中一键撤销/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("每条记录的可执行下一步触发对应动作", async () => {
    const onAction = vi.fn();
    render(ActivityModule, { snapshot: baseSnapshot, onAction });
    await fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onAction).toHaveBeenCalledWith("activity/retry", { recordId: "1" });
    await fireEvent.click(
      screen.getAllByRole("button", { name: "打开日志" })[0],
    );
    expect(onAction).toHaveBeenCalledWith(
      "activity/open-output",
      expect.objectContaining({ recordId: "1" }),
    );
  });

  it("空态提示本次会话暂无记录", () => {
    render(ActivityModule, {
      snapshot: { ...baseSnapshot, records: [] },
      onAction: vi.fn(),
    });
    expect(screen.getByText(/暂无操作记录/)).toBeInTheDocument();
  });

  it("复制诊断等动作不泄露凭据", async () => {
    const onAction = vi.fn();
    render(ActivityModule, { snapshot: baseSnapshot, onAction });
    await fireEvent.click(screen.getByRole("button", { name: "复制诊断信息" }));
    expect(onAction).toHaveBeenCalledWith("activity/copy-diagnostics", {
      recordId: "1",
    });
    // 不应出现撤销远端提交类误导文案
    expect(screen.queryByText(/撤销远端提交/)).toBeNull();
  });
});
