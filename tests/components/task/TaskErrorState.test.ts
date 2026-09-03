/**
 * v0.1.5 V015-B：TaskErrorState 组件测试。
 * 覆盖：role=alert、错误三段式、无恢复动作警告、diagnosticText 密钥模式
 * 拒绝渲染（fail-closed）、确认令牌不计入密钥、动作透传。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import TaskErrorState from "../../../src/webview/components/task/TaskErrorState.svelte";

const baseProps = {
  what: "提交失败。",
  cause: "网络中断，远端无响应。",
  recovery: "检查网络后点击“重试提交”。",
  actions: [{ label: "重试提交", action: "retry", kind: "primary" as const }],
  onAction: vi.fn(),
};

describe("TaskErrorState", () => {
  it("role=alert 并渲染错误三段式", () => {
    render(TaskErrorState, { props: { ...baseProps, onAction: vi.fn() } });
    const box = screen.getByRole("alert");
    expect(box).toHaveAttribute("aria-label", "错误说明");
    expect(box).toHaveTextContent("提交失败。");
    expect(box).toHaveTextContent("网络中断，远端无响应。");
    expect(box).toHaveTextContent("检查网络后点击“重试提交”。");
  });

  it("actions 为空时 DEV 警告（错误页不得没有出口）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(TaskErrorState, {
        props: { ...baseProps, actions: [], onAction: vi.fn() },
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("缺少恢复动作"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("普通诊断文本正常渲染", () => {
    render(TaskErrorState, {
      props: {
        ...baseProps,
        diagnosticText: "svn: E170013 无法连接到版本库",
        onAction: vi.fn(),
      },
    });
    expect(
      screen.getByText("svn: E170013 无法连接到版本库"),
    ).toBeInTheDocument();
  });

  it.each([
    ["apiKey 赋值", "请求失败，apiKey=sk-abc123，请检查配置"],
    ["password 赋值", "认证失败，password: s3cr3t"],
    ["passwd", "passwd 文件读取失败"],
    ["私钥块", "-----BEGIN RSA PRIVATE KEY-----\nfakekey"],
  ])("diagnosticText 命中密钥模式时拒绝渲染原文：%s", (_name, text) => {
    render(TaskErrorState, {
      props: { ...baseProps, diagnosticText: text, onAction: vi.fn() },
    });
    // 原文不得出现在界面上（fail-closed）
    expect(screen.queryByText(text)).toBeNull();
    // 显示脱敏提示而非原文
    expect(
      screen.getByText(
        "诊断信息疑似包含密钥，已隐藏以保护安全。请复制前自行脱敏。",
      ),
    ).toBeInTheDocument();
  });

  it("确认令牌不计入密钥模式（正常诊断不受影响）", () => {
    const tokenText = "确认令牌 tok-123 已过期，范围变化后请重新生成预览。";
    render(TaskErrorState, {
      props: { ...baseProps, diagnosticText: tokenText, onAction: vi.fn() },
    });
    expect(screen.getByText(tokenText)).toBeInTheDocument();
  });

  it("恢复动作点击透传 onAction(action, data)", async () => {
    const onAction = vi.fn();
    render(TaskErrorState, {
      props: {
        ...baseProps,
        actions: [
          { label: "重试提交", action: "retry", kind: "primary" },
          { label: "复制诊断信息", action: "copy-diagnostics" },
        ],
        onAction,
      },
    });
    await fireEvent.click(screen.getByText("重试提交"));
    expect(onAction).toHaveBeenCalledWith("retry", undefined);
    await fireEvent.click(screen.getByText("复制诊断信息"));
    expect(onAction).toHaveBeenCalledWith("copy-diagnostics", undefined);
  });
});
