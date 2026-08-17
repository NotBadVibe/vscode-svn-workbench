import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DiagnosticsModule from "../../src/webview/features/diagnostics/DiagnosticsModule.svelte";
import type { DiagnosticsSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.10 跨模块列表迁移：诊断提供“只看需要处理”、状态筛选、结果
 * 数量与复制单项；总体状态不只靠颜色（文字 + 图标）。
 */

const snapshot: DiagnosticsSnapshot = {
  kind: "diagnostics",
  status: "warn",
  generatedAt: "2026-08-16T10:00:00.000Z",
  checks: [
    {
      id: "svn-cli",
      status: "pass",
      label: "SVN 命令行",
      detail: "svn 1.14 已就绪。",
    },
    {
      id: "workspace",
      status: "warn",
      label: "多根工作区",
      detail: "存在 2 个工作副本。",
      action: "确认项目根设置。",
    },
    {
      id: "ai-key",
      status: "fail",
      label: "AI 密钥",
      detail: "未配置 API Key。",
      action: "AI 功能不可用，核心 SVN 流程不受影响。",
    },
  ],
  acceptance: {
    summary: { sections: 1, items: 1, steps: 1, expectedResults: 1 },
    sections: [],
  },
  reportText: "诊断报告",
};

describe("DiagnosticsModule（v0.0.10 列表迁移）", () => {
  it("只看需要处理时隐藏通过项并播报结果数量", async () => {
    render(DiagnosticsModule, { snapshot, onAction: vi.fn() });
    expect(screen.getByText("3 项检查")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "只看需要处理" }));
    expect(screen.getByText("2 项检查")).toBeInTheDocument();
    expect(screen.queryByText("SVN 命令行")).toBeNull();
    expect(screen.getByText("多根工作区")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "只看需要处理" }));
    expect(screen.getByText("3 项检查")).toBeInTheDocument();
  });

  it("状态筛选只保留所选状态", async () => {
    render(DiagnosticsModule, { snapshot, onAction: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "失败" }));
    expect(screen.getByText("1 项检查")).toBeInTheDocument();
    expect(screen.getByText("AI 密钥")).toBeInTheDocument();
    expect(screen.queryByText("多根工作区")).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByText("3 项检查")).toBeInTheDocument();
  });

  it("复制单项包含状态、详情与建议动作", async () => {
    const onAction = vi.fn();
    render(DiagnosticsModule, { snapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "复制检查项 多根工作区" }),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "[提醒] 多根工作区\n存在 2 个工作副本。\n建议：确认项目根设置。",
    });
  });

  it("状态不只靠颜色：图标带文字标签", () => {
    render(DiagnosticsModule, { snapshot, onAction: vi.fn() });
    expect(screen.getAllByRole("img", { name: "通过" }).length).toBe(1);
    expect(screen.getAllByRole("img", { name: "提醒" }).length).toBe(1);
    expect(screen.getAllByRole("img", { name: "失败" }).length).toBe(1);
  });
});
