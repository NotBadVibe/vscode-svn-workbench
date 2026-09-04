/**
 * v0.1.5 V015-B：PrimaryActionBar 组件测试。
 * 覆盖：primary 唯一性（类型级单对象 + secondary>2 警告截断）、
 * 数量 countText 一致、busy/stale 三态、焦点可达无陷阱、IME 序列、
 * 零 sticky/overflow（样式块静态断言）。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量；
 * 源码位置经 URL 解析，不拼接路径分隔符。
 */
import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  createEvent,
} from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import PrimaryActionBar from "../../../src/webview/components/task/PrimaryActionBar.svelte";
import type { TaskBarAction } from "../../../src/webview/components/task/taskTypes";

function primaryAction(overrides: Partial<TaskBarAction> = {}): TaskBarAction {
  return { label: "确认提交 3 个文件", onClick: vi.fn(), ...overrides };
}

describe("PrimaryActionBar", () => {
  it("渲染唯一 primary，secondary 按序渲染", async () => {
    const primary = primaryAction();
    render(PrimaryActionBar, {
      props: {
        primary,
        secondary: [
          { label: "查看预览", onClick: vi.fn() },
          { label: "取消", onClick: vi.fn() },
        ],
        countText: "已选择 3/5 个文件",
      },
    });
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar).toHaveAttribute("aria-label", "任务操作栏");
    // 主操作唯一：primary 样式按钮只有 1 个
    expect(toolbar.querySelectorAll(".button--primary")).toHaveLength(1);
    expect(screen.getByText("确认提交 3 个文件")).toBeInTheDocument();
    expect(screen.getByText("查看预览")).toBeInTheDocument();
    expect(screen.getByText("取消")).toBeInTheDocument();
    // 数量文案与主动作数量口径一致展示
    expect(screen.getByText("已选择 3/5 个文件")).toBeInTheDocument();
    await fireEvent.click(screen.getByText("确认提交 3 个文件"));
    expect(primary.onClick).toHaveBeenCalledTimes(1);
  });

  it("secondary 超过 2 个时 DEV 警告并截断，同时渲染溢出提示", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(PrimaryActionBar, {
        props: {
          primary: primaryAction(),
          secondary: [
            { label: "次要一", onClick: vi.fn() },
            { label: "次要二", onClick: vi.fn() },
            { label: "次要三", onClick: vi.fn() },
          ],
        },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("secondary 最多 2 个"),
      );
      // 只缩小不扩大：第三个次级动作不渲染
      expect(screen.getByText("次要一")).toBeInTheDocument();
      expect(screen.getByText("次要二")).toBeInTheDocument();
      expect(screen.queryByText("次要三")).toBeNull();
      // v0.1.6 V016-F1：截断不再静默，溢出数量走 role=status 文字播报。
      expect(screen.getByRole("status")).toHaveTextContent(
        "另有 1 个次要操作未显示",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("secondary 不超限时不渲染溢出提示", () => {
    render(PrimaryActionBar, {
      props: {
        primary: primaryAction(),
        secondary: [{ label: "次要一", onClick: vi.fn() }],
      },
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("busy 三态：primary 禁用 + 文案 + role=status 播报", () => {
    const primary = primaryAction();
    render(PrimaryActionBar, {
      props: { primary, busy: true, busyText: "正在提交…" },
    });
    const button = screen.getByText("确认提交 3 个文件");
    expect(button).toBeDisabled();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("正在提交…");
  });

  it("stale 三态：primary 禁用 + 文案 + 点击不触发", async () => {
    const primary = primaryAction();
    render(PrimaryActionBar, {
      props: { primary, stale: true, staleText: "结果已过期，请重新检查。" },
    });
    const button = screen.getByText("确认提交 3 个文件");
    expect(button).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "结果已过期，请重新检查。",
    );
    await fireEvent.click(button);
    expect(primary.onClick).not.toHaveBeenCalled();
  });

  it("常态点击触发 primary.onClick", async () => {
    const primary = primaryAction();
    render(PrimaryActionBar, { props: { primary } });
    await fireEvent.click(screen.getByText("确认提交 3 个文件"));
    expect(primary.onClick).toHaveBeenCalledTimes(1);
  });

  it("焦点：全部按钮 Tab 可达、无陷阱", () => {
    render(PrimaryActionBar, {
      props: {
        primary: primaryAction(),
        secondary: [{ label: "查看预览", onClick: vi.fn() }],
      },
    });
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBe(2);
    for (const button of buttons) {
      // 无 tabindex=-1，原生 button 可经 Tab 到达
      expect(button.getAttribute("tabindex")).not.toBe("-1");
      (button as HTMLElement).focus();
      expect(document.activeElement).toBe(button);
    }
  });

  it("IME：compositionstart→Enter→compositionend 序列中 Enter 不触发 onClick", async () => {
    const primary = primaryAction();
    const { container } = render(PrimaryActionBar, { props: { primary } });
    const toolbar = container.querySelector('[role="toolbar"]') as HTMLElement;
    const button = screen.getByText("确认提交 3 个文件");
    // 进入中文候选
    await fireEvent.compositionStart(toolbar);
    // 候选阶段 Enter：keydown 被拦截
    const enterEvent = createEvent.keyDown(button, {
      key: "Enter",
      keyCode: 229,
    });
    await fireEvent(button, enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    // 候选阶段的点击也不触发（fail-closed）
    await fireEvent.click(button);
    expect(primary.onClick).not.toHaveBeenCalled();
    // 候选结束，点击恢复
    await fireEvent.compositionEnd(toolbar);
    await fireEvent.click(button);
    expect(primary.onClick).toHaveBeenCalledTimes(1);
  });

  it("组件零 position:sticky/overflow（样式块静态断言，滚动由页面声明）", () => {
    const sourcePath = resolve(
      process.cwd(),
      "src",
      "webview",
      "components",
      "task",
      "PrimaryActionBar.svelte",
    );
    const source = readFileSync(sourcePath, "utf8");
    const styleBlock = source.slice(source.indexOf("<style>"));
    expect(styleBlock).not.toMatch(/position\s*:/);
    expect(styleBlock).not.toMatch(/overflow\s*:/);
  });
});
