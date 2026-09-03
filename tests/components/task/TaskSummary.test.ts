/**
 * v0.1.5 V015-B：TaskSummary 组件测试。
 * 覆盖：tone→role 映射、variant 缺省 compact、compact 截断 + title、
 * 同页 full≤1 约定注释（静态断言源码注释存在）、三主题结构可辨。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import TaskSummary from "../../../src/webview/components/task/TaskSummary.svelte";

describe("TaskSummary", () => {
  it("缺省为 compact，info/success 走 role=status", () => {
    render(TaskSummary, { props: { status: "已生成预览，共 3 个文件" } });
    const box = screen.getByRole("status");
    expect(box).toHaveClass("task-summary--compact");
    expect(box).toHaveAttribute("aria-label", "任务状态摘要");
    expect(screen.getByText("已生成预览，共 3 个文件")).toBeInTheDocument();
  });

  it("error/warning 走 role=alert", () => {
    const { unmount: unmountError } = render(TaskSummary, {
      props: { status: "提交失败", tone: "error" },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    unmountError();
    render(TaskSummary, { props: { status: "存在风险", tone: "warning" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("success 仍走 role=status（结果播报不打断）", () => {
    render(TaskSummary, { props: { status: "更新完成", tone: "success" } });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("compact 下超长文本截断并经 title 查看完整值", () => {
    const long = "这是一个非常长的任务状态描述".repeat(10);
    render(TaskSummary, { props: { status: long, reason: long } });
    const status = screen.getByText(long, {
      selector: ".task-summary__status",
    });
    expect(status).toHaveAttribute("title", long);
  });

  it("full 形态渲染全宽类（强状态专用，同页 full≤1 见源码注释）", () => {
    // 平台无关：以进程工作目录为锚点逐段拼接（仓内既有模式），不写 POSIX 字面量。
    const sourcePath = resolve(
      process.cwd(),
      "src",
      "webview",
      "components",
      "task",
      "TaskSummary.svelte",
    );
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain("同页最多 1 处");
    render(TaskSummary, {
      props: { status: "提交失败", tone: "error", variant: "full" },
    });
    expect(screen.getByRole("alert")).toHaveClass("task-summary--full");
  });

  it("三主题结构可辨：文字 + 图标 + tone 样式钩子（不只靠颜色）", () => {
    for (const tone of ["info", "success", "warning", "error"] as const) {
      const { unmount } = render(TaskSummary, {
        props: { status: `状态-${tone}`, tone, icon: "codicon-info" },
      });
      const box =
        tone === "error" || tone === "warning"
          ? screen.getByRole("alert")
          : screen.getByRole("status");
      // 文字存在
      expect(box).toHaveTextContent(`状态-${tone}`);
      // 图标存在且纯装饰（读屏不重复播报）
      const icon = box.querySelector(".codicon");
      expect(icon).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
      // tone 修饰类作为主题样式钩子存在
      expect(box).toHaveClass(`task-summary--${tone}`);
      unmount();
    }
  });

  it("支持自定义可访问名称", () => {
    render(TaskSummary, {
      props: { status: "就绪", ariaLabel: "提交任务状态" },
    });
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-label",
      "提交任务状态",
    );
  });
});
