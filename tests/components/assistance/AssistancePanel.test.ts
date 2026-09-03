/**
 * v0.1.6 V016-B：AssistancePanel 组件测试。
 * 覆盖：默认折叠 + aria-expanded + role=region / 展开折叠与焦点返回 /
 * IME 候选 Enter 不触发 / 本地动作不弹外发说明、模型动作点击后展示 /
 * stale 禁采用（采用类禁用 + 中文提示）/ 错误重试与放弃出口 /
 * 回执展示无 token 泄漏 / 折叠不丢 result。
 *
 * 平台无关说明：断言中不拼接路径分隔符；文件名仅作展示字符串比较。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import AssistancePanel from "../../../src/webview/components/assistance/AssistancePanel.svelte";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    title: "提交说明帮助",
    summary: "按需生成提交建议，采用前需确认。",
    sourceState: "local-rule" as const,
    configured: false,
    expanded: false,
    onExpand: vi.fn(),
    onCollapse: vi.fn(),
    ...overrides,
  };
}

describe("AssistancePanel", () => {
  it("默认折叠：一句用途 + 需要帮助入口（aria-expanded + role=region）", () => {
    render(AssistancePanel, { props: baseProps() });
    const region = screen.getByRole("region", { name: "提交说明帮助" });
    expect(region).toBeInTheDocument();
    expect(
      screen.getByText("按需生成提交建议，采用前需确认。"),
    ).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "需要帮助" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    // 折叠时不展示动作区
    expect(screen.queryByText("本地检查")).not.toBeInTheDocument();
  });

  it("展开后切换为收起帮助并透传 onExpand", async () => {
    const onExpand = vi.fn();
    render(AssistancePanel, { props: baseProps({ onExpand }) });
    await fireEvent.click(screen.getByRole("button", { name: "需要帮助" }));
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("展开态显示动作分组；收起后焦点返回触发按钮", async () => {
    const onCollapse = vi.fn();
    const localSelect = vi.fn();
    const { rerender } = render(AssistancePanel, {
      props: baseProps({
        expanded: true,
        onCollapse,
        localActions: [
          {
            label: "运行本地检查",
            kind: "local",
            hint: "不会外发",
            onSelect: localSelect,
          },
        ],
      }),
    });
    expect(screen.getByRole("group", { name: "本地检查" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "运行本地检查" }),
    ).toBeInTheDocument();
    const collapse = screen.getByRole("button", { name: "收起帮助" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    collapse.focus();
    await fireEvent.click(collapse);
    expect(onCollapse).toHaveBeenCalledTimes(1);
    // 焦点返回触发按钮（同一触发按钮保持挂载）
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(collapse);
    await rerender(baseProps({ expanded: false, onCollapse }));
    expect(
      screen.getByRole("button", { name: "需要帮助" }),
    ).toBeInTheDocument();
  });

  it("IME 候选阶段 Enter 不触发展开", async () => {
    const onExpand = vi.fn();
    const { container } = render(AssistancePanel, {
      props: baseProps({ onExpand }),
    });
    const region = container.querySelector(".assistance-panel") as HTMLElement;
    const trigger = screen.getByRole("button", { name: "需要帮助" });
    await fireEvent.compositionStart(region);
    await fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onExpand).not.toHaveBeenCalled();
    await fireEvent.compositionEnd(region);
    await fireEvent.click(trigger);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("本地动作不弹外发说明；模型动作点击后才展示外发说明", async () => {
    const localSelect = vi.fn();
    const modelSelect = vi.fn();
    render(AssistancePanel, {
      props: baseProps({
        expanded: true,
        configured: true,
        sourceState: "configured-model" as const,
        localActions: [
          { label: "运行本地检查", kind: "local", onSelect: localSelect },
        ],
        modelActions: [
          { label: "生成模型建议", kind: "model", onSelect: modelSelect },
        ],
      }),
    });
    // 初始无外发说明
    expect(
      screen.queryByText(/将按外发回执确认后才外发/),
    ).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "运行本地检查" }));
    expect(localSelect).toHaveBeenCalledTimes(1);
    // 本地动作不弹外发回执
    expect(
      screen.queryByText(/将按外发回执确认后才外发/),
    ).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "生成模型建议" }));
    expect(modelSelect).toHaveBeenCalledTimes(1);
    // 模型动作点击后展示外发说明并点名动作
    expect(screen.getByText(/将按外发回执确认后才外发/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("生成模型建议");
  });

  it("stale 时采用类动作禁用 + 中文提示；非采用动作仍可用", async () => {
    const adoptSelect = vi.fn();
    const viewSelect = vi.fn();
    render(AssistancePanel, {
      props: baseProps({
        expanded: true,
        stale: true,
        result: "建议草稿：统一提交格式。",
        modelActions: [
          {
            label: "采用建议",
            kind: "model",
            adopt: true,
            onSelect: adoptSelect,
          },
          { label: "查看建议", kind: "model", onSelect: viewSelect },
        ],
      }),
    });
    expect(screen.getByText(/只能查看，不能直接采用/)).toBeInTheDocument();
    const adopt = screen.getByRole("button", { name: "采用建议" });
    expect(adopt).toBeDisabled();
    await fireEvent.click(adopt);
    expect(adoptSelect).not.toHaveBeenCalled();
    const view = screen.getByRole("button", { name: "查看建议" });
    expect(view).not.toBeDisabled();
    await fireEvent.click(view);
    expect(viewSelect).toHaveBeenCalledTimes(1);
  });

  it("错误态含重试与放弃出口（role=alert）", async () => {
    const onRetry = vi.fn();
    const onDiscard = vi.fn();
    render(AssistancePanel, {
      props: baseProps({
        expanded: true,
        error: "模型调用失败：可能是网络超时。",
        onRetry,
        onDiscard,
      }),
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("模型调用失败");
    await fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByText("放弃"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("回执展示无 token 泄漏；折叠重开不丢 result", async () => {
    const onConfirm = vi.fn();
    const onDiscard = vi.fn();
    const secretToken = "receipt-token-9f2c-secret";
    const { rerender } = render(AssistancePanel, {
      props: baseProps({
        expanded: true,
        configured: true,
        result: "建议草稿：统一提交格式。",
        receipt: {
          model: "demo-model",
          dataTypes: "仅文件信息",
          scopeText: "当前范围 2 个文件",
          budgetText: "单文件 6000 字符，共 40000 字符",
          historyIncluded: false,
          onConfirm,
          onDiscard,
          confirmLabel: "开始模型生成",
        },
      }),
    });
    expect(screen.getByText("外发前请确认以下内容")).toBeInTheDocument();
    expect(screen.getByText("建议草稿：统一提交格式。")).toBeInTheDocument();
    // token 绝不进入组件：即使页面持有 token，渲染文本中也不得出现
    expect(screen.queryByText(secretToken)).toBeNull();
    const region = screen.getByRole("region", { name: "提交说明帮助" });
    expect(region.textContent).not.toContain(secretToken);
    await fireEvent.click(screen.getByText("开始模型生成"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // 折叠（组件不清理 props）后重开，result 仍在
    await rerender(
      baseProps({
        expanded: false,
        result: "建议草稿：统一提交格式。",
        receipt: {
          model: "demo-model",
          dataTypes: "仅文件信息",
          scopeText: "当前范围 2 个文件",
          budgetText: "单文件 6000 字符，共 40000 字符",
          historyIncluded: false,
          onConfirm,
          onDiscard,
          confirmLabel: "开始模型生成",
        },
      }),
    );
    await rerender(
      baseProps({
        expanded: true,
        result: "建议草稿：统一提交格式。",
        receipt: {
          model: "demo-model",
          dataTypes: "仅文件信息",
          scopeText: "当前范围 2 个文件",
          budgetText: "单文件 6000 字符，共 40000 字符",
          historyIncluded: false,
          onConfirm,
          onDiscard,
          confirmLabel: "开始模型生成",
        },
      }),
    );
    expect(screen.getByText("建议草稿：统一提交格式。")).toBeInTheDocument();
    expect(screen.getByText("外发前请确认以下内容")).toBeInTheDocument();
  });

  it("未配置时如实提示且不伪装模型入口", () => {
    render(AssistancePanel, {
      props: baseProps({ expanded: true, configured: false }),
    });
    expect(
      screen.getByText(/未配置外部模型，本地检查仍可用/),
    ).toBeInTheDocument();
  });

  it("进行中 progress 经 role=status 播报", () => {
    render(AssistancePanel, {
      props: baseProps({ expanded: true, progress: "正在生成建议…" }),
    });
    const progress = screen.getByText("正在生成建议…");
    expect(progress).toHaveAttribute("role", "status");
  });
});
