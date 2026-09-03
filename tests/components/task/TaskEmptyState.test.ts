/**
 * v0.1.5 V015-B：TaskEmptyState 组件测试。
 * 覆盖：role=status、三句话渲染、三句缺一句即 DEV 警告、
 * 动作透传、图标装饰不重复播报。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TaskEmptyState from "../../../src/webview/components/task/TaskEmptyState.svelte";

describe("TaskEmptyState", () => {
  it("role=status 并同时回答三句话", () => {
    render(TaskEmptyState, {
      props: {
        what: "尚未生成更新预览。",
        whyNormal: "检查是只读的，这是进入更新任务的正常起点。",
        whatNow: "点击“生成更新预览”查看远端变化。",
        actions: [
          {
            label: "生成更新预览",
            action: "preview-update",
            kind: "primary",
          },
        ],
        onAction: vi.fn(),
      },
    });
    const box = screen.getByRole("status");
    expect(box).toHaveAttribute("aria-label", "空状态说明");
    expect(box).toHaveTextContent("尚未生成更新预览。");
    expect(box).toHaveTextContent("检查是只读的，这是进入更新任务的正常起点。");
    expect(box).toHaveTextContent("点击“生成更新预览”查看远端变化。");
  });

  it.each([
    ["what 缺失", { what: "", whyNormal: "正常。", whatNow: "下一步。" }],
    [
      "whyNormal 缺失",
      { what: "发生了什么。", whyNormal: "", whatNow: "下一步。" },
    ],
    [
      "whatNow 缺失",
      { what: "发生了什么。", whyNormal: "正常。", whatNow: "" },
    ],
  ])("三句缺一句即 DEV 警告：%s", (_name, sentences) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(TaskEmptyState, {
        props: { ...sentences, actions: [], onAction: vi.fn() },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("空态三句话缺失"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("三句齐全时不警告", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(TaskEmptyState, {
        props: {
          what: "发生了什么。",
          whyNormal: "正常。",
          whatNow: "下一步。",
          actions: [],
          onAction: vi.fn(),
        },
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("动作点击透传 onAction(action, data)", async () => {
    const onAction = vi.fn();
    render(TaskEmptyState, {
      props: {
        what: "发生了什么。",
        whyNormal: "正常。",
        whatNow: "下一步。",
        actions: [
          { label: "查看历史", action: "open-history", data: { tab: "log" } },
        ],
        onAction,
      },
    });
    await fireEvent.click(screen.getByText("查看历史"));
    expect(onAction).toHaveBeenCalledWith("open-history", { tab: "log" });
  });

  it("图标纯装饰：aria-hidden，不只靠颜色表达状态", () => {
    render(TaskEmptyState, {
      props: {
        icon: "codicon-inbox",
        what: "发生了什么。",
        whyNormal: "正常。",
        whatNow: "下一步。",
        actions: [],
        onAction: vi.fn(),
      },
    });
    const box = screen.getByRole("status");
    const icon = box.querySelector(".codicon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });
});
