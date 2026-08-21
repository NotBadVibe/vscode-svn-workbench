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

describe("DiagnosticsModule（v0.0.15 诊断动作协议化）", () => {
  const actionSnapshot: DiagnosticsSnapshot = {
    kind: "diagnostics",
    status: "fail",
    generatedAt: "2026-08-21T10:00:00.000Z",
    checks: [
      {
        id: "svn-cli",
        label: "SVN CLI",
        status: "fail",
        detail: "未找到 svn 可执行文件",
        action:
          "安装 SVN CLI，或配置 svnWorkbench.svn.path 指向 svn 可执行文件。",
        actions: [
          { id: "selectSvnExecutable", label: "选择 SVN 可执行文件" },
          {
            id: "openSettings",
            label: "打开设置",
            params: { query: "svnWorkbench.svn.path" },
          },
          { id: "copyDiagnostics", label: "复制诊断信息" },
          { id: "rerunDiagnostics", label: "重新检测" },
        ],
      },
      {
        id: "workspace",
        label: "工作区",
        status: "warn",
        detail: "1 个工作区均未检测到 SVN 工作副本",
        action: "确认打开的是 SVN 工作副本内的目录。",
        actions: [
          { id: "openFolder", label: "打开文件夹" },
          { id: "copyDiagnostics", label: "复制诊断信息" },
          { id: "rerunDiagnostics", label: "重新检测" },
        ],
      },
    ],
    acceptance: {
      summary: { sections: 1, items: 1, steps: 1, expectedResults: 1 },
      sections: [],
    },
    reportText: "诊断报告全文",
  };

  it("可点击动作：选择可执行文件与打开设置携带参数", async () => {
    const onAction = vi.fn();
    render(DiagnosticsModule, { snapshot: actionSnapshot, onAction });
    await fireEvent.click(
      screen.getAllByRole("button", { name: "选择 SVN 可执行文件" })[0],
    );
    expect(onAction).toHaveBeenCalledWith(
      "diagnostics/select-svn-executable",
      {},
    );
    await fireEvent.click(
      screen.getAllByRole("button", { name: "打开设置" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("diagnostics/open-settings", {
      query: "svnWorkbench.svn.path",
    });
  });

  it("四状态首屏：CLI 缺失时展示主/次动作与通用重试/复制入口", async () => {
    const onAction = vi.fn();
    render(DiagnosticsModule, { snapshot: actionSnapshot, onAction });
    expect(screen.getByText("SVN CLI 未找到")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "选择 SVN 可执行文件" }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByRole("button", { name: "打开设置" }).length,
    ).toBeGreaterThanOrEqual(2);
    // 通用入口
    expect(
      screen.getAllByRole("button", { name: "重新检测" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "复制诊断信息" }).length,
    ).toBeGreaterThan(0);
    await fireEvent.click(
      screen.getAllByRole("button", { name: "重新检测" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("diagnostics/run", {});
  });

  it("验收清单入口在开发环境可见（import.meta.env.DEV）", async () => {
    render(DiagnosticsModule, { snapshot: actionSnapshot, onAction: vi.fn() });
    // vitest 为 DEV 模式，应显示验收清单 Tab
    expect(screen.getByRole("tab", { name: "验收清单" })).toBeInTheDocument();
  });
});

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
