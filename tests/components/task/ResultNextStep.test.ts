/**
 * v0.1.5 V015-B：ResultNextStep 组件测试。
 * 覆盖：tone→role 映射、结果/下一步/恢复三段渲染、1 primary + ≤2 secondary、
 * onAction(action, data) 透传、不 import Host（源码静态断言）。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量；
 * 源码位置经 URL 解析，不拼接路径分隔符。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ResultNextStep from "../../../src/webview/components/task/ResultNextStep.svelte";
import type { TaskActionItem } from "../../../src/webview/components/task/taskTypes";

function actions(): TaskActionItem[] {
  return [
    { label: "处理 2 个冲突", action: "view-conflicts", kind: "primary" },
    { label: "查看本地修改", action: "open-changes", kind: "secondary" },
    {
      label: "复制诊断信息",
      action: "copy-diagnostics",
      data: { reason: "update-conflict" },
      kind: "secondary",
    },
  ];
}

describe("ResultNextStep", () => {
  it("success 走 role=status，error 走 role=alert", () => {
    const onAction = vi.fn();
    const { unmount } = render(ResultNextStep, {
      props: {
        tone: "success",
        result: "更新完成，2 个文件存在冲突。",
        nextStep: "先处理冲突，再重新提交。",
        actions: actions(),
        onAction,
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "更新完成，2 个文件存在冲突。",
    );
    unmount();
    render(ResultNextStep, {
      props: {
        tone: "error",
        result: "提交失败。",
        nextStep: "检查网络后重试。",
        actions: actions(),
        onAction,
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("提交失败。");
  });

  it("渲染结果 / 下一步 / 恢复三段", () => {
    render(ResultNextStep, {
      props: {
        tone: "success",
        result: "更新完成。",
        nextStep: "查看本地修改确认结果。",
        recoveryHint: "如需回退，使用历史恢复入口。",
        actions: actions(),
        onAction: vi.fn(),
      },
    });
    expect(screen.getByText("更新完成。")).toBeInTheDocument();
    expect(screen.getByText("查看本地修改确认结果。")).toBeInTheDocument();
    expect(
      screen.getByText("如需回退，使用历史恢复入口。"),
    ).toBeInTheDocument();
  });

  it("点击只透传 onAction(action, data)，不拼接 action 名", async () => {
    const onAction = vi.fn();
    render(ResultNextStep, {
      props: {
        tone: "success",
        result: "更新完成。",
        nextStep: "处理冲突。",
        actions: actions(),
        onAction,
      },
    });
    await fireEvent.click(screen.getByText("处理 2 个冲突"));
    expect(onAction).toHaveBeenCalledWith("view-conflicts", undefined);
    await fireEvent.click(screen.getByText("复制诊断信息"));
    expect(onAction).toHaveBeenCalledWith("copy-diagnostics", {
      reason: "update-conflict",
    });
  });

  it("缺少 primary 时 DEV 警告", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(ResultNextStep, {
        props: {
          tone: "success",
          result: "完成。",
          nextStep: "下一步。",
          actions: [{ label: "次要动作", action: "noop", kind: "secondary" }],
          onAction: vi.fn(),
        },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("缺少 kind=primary"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("secondary 超过 2 个时截断并渲染溢出提示", () => {
    render(ResultNextStep, {
      props: {
        tone: "success",
        result: "完成。",
        nextStep: "下一步。",
        actions: [
          { label: "主动作", action: "a", kind: "primary" },
          { label: "次要一", action: "b", kind: "secondary" },
          { label: "次要二", action: "c", kind: "secondary" },
          { label: "次要三", action: "d", kind: "secondary" },
        ],
        onAction: vi.fn(),
      },
    });
    expect(screen.getByText("次要一")).toBeInTheDocument();
    expect(screen.getByText("次要二")).toBeInTheDocument();
    expect(screen.queryByText("次要三")).toBeNull();
    // v0.1.6 V016-F1：截断不再静默。
    expect(screen.getByText("另有 1 个次要操作未显示")).toBeInTheDocument();
  });

  it("多个 primary 时只取首个并渲染溢出提示", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(ResultNextStep, {
        props: {
          tone: "success",
          result: "完成。",
          nextStep: "下一步。",
          actions: [
            { label: "主要一", action: "a", kind: "primary" },
            { label: "主要二", action: "b", kind: "primary" },
          ],
          onAction: vi.fn(),
        },
      });
      expect(screen.getByText("主要一")).toBeInTheDocument();
      expect(screen.queryByText("主要二")).toBeNull();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("primary 动作只能有 1 个"),
      );
      expect(
        screen.getByText("另有 1 个主要操作未显示，仅展示首个"),
      ).toBeInTheDocument();
    } finally {
      warn.mockRestore();
    }
  });

  it("组件不 import Host、不拼 action 名（源码静态断言）", () => {
    const sourcePath = resolve(
      process.cwd(),
      "src",
      "webview",
      "components",
      "task",
      "ResultNextStep.svelte",
    );
    const source = readFileSync(sourcePath, "utf8");
    const scriptBlock = source.slice(0, source.indexOf("</script>"));
    expect(scriptBlock).not.toMatch(
      /from\s+["'][^"']*(vscode|extension\/|svn\/|SvnCommand)[^"']*["']/,
    );
    expect(scriptBlock).toContain("onAction(action");
  });
});
