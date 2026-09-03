/**
 * v0.1.6 V016-B：ReceiptSummary 组件测试。
 * 覆盖：五要素展示（模型/数据类型/范围/预算/历史）/ 文件清单字符与截断 /
 * 确认与放弃事件透传 / token 不进组件（props 无 token 字段且渲染无泄漏）。
 *
 * 平台无关说明：文件名仅作展示字符串比较，不拼接路径分隔符。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/svelte";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ReceiptSummary from "../../../src/webview/components/assistance/ReceiptSummary.svelte";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    model: "demo-model",
    dataTypes: "仅文件信息",
    scopeText: "当前范围 2 个文件",
    budgetText: "单文件 6000 字符，共 40000 字符",
    historyIncluded: false,
    onConfirm: vi.fn(),
    onDiscard: vi.fn(),
    confirmLabel: "开始模型生成",
    ...overrides,
  };
}

describe("ReceiptSummary", () => {
  it("展示模型、数据类型、范围、预算与是否含历史", () => {
    render(ReceiptSummary, { props: baseProps() });
    const region = screen.getByRole("region", { name: "外发回执确认" });
    expect(region).toBeInTheDocument();
    expect(screen.getByText("demo-model")).toBeInTheDocument();
    expect(screen.getByText("仅文件信息")).toBeInTheDocument();
    expect(screen.getByText("当前范围 2 个文件")).toBeInTheDocument();
    expect(
      screen.getByText("单文件 6000 字符，共 40000 字符"),
    ).toBeInTheDocument();
    expect(screen.getByText("不包含历史")).toBeInTheDocument();
  });

  it("包含历史与附加说明如实展示", () => {
    render(ReceiptSummary, {
      props: baseProps({
        historyIncluded: true,
        receiptNote: "不会发送认证信息与本地绝对路径。",
      }),
    });
    expect(screen.getByText("包含历史")).toBeInTheDocument();
    expect(
      screen.getByText("不会发送认证信息与本地绝对路径。"),
    ).toBeInTheDocument();
  });

  it("文件清单展示字符数与截断标记", async () => {
    render(ReceiptSummary, {
      props: baseProps({
        files: [
          { name: "a.ts", characters: 1200, truncated: false },
          { name: "b.ts", characters: 6000, truncated: true },
        ],
      }),
    });
    const details = screen.getByText(/查看文件清单（2）/);
    expect(details).toBeInTheDocument();
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
    expect(screen.getByText(/1200 字符/)).toBeInTheDocument();
    expect(screen.getByText(/6000 字符（已截断）/)).toBeInTheDocument();
  });

  it("确认与放弃事件透传页面（由页面携带 token）", async () => {
    const onConfirm = vi.fn();
    const onDiscard = vi.fn();
    render(ReceiptSummary, { props: baseProps({ onConfirm, onDiscard }) });
    await fireEvent.click(screen.getByText("开始模型生成"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByText("放弃"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("token 不进组件：源码无 token 字段且渲染无泄漏", () => {
    // 平台无关：以进程工作目录为锚点逐段拼接（仓内既有模式）。
    const sourcePath = resolve(
      process.cwd(),
      "src",
      "webview",
      "components",
      "assistance",
      "ReceiptSummary.svelte",
    );
    const source = readFileSync(sourcePath, "utf8");
    // 回执 token 不得成为组件字段：拒绝 `token?:` / `token:` / `token =` 形态；
    // 中文注释中提及 token 概念不计入（组件不持有、不渲染 token 值）。
    expect(source).not.toMatch(/\btoken\s*[?:=]/i);
    const secretToken = "receipt-token-9f2c-secret";
    render(ReceiptSummary, { props: baseProps() });
    const region = screen.getByRole("region", { name: "外发回执确认" });
    expect(region.textContent).not.toContain(secretToken);
  });

  it("缺模型名时不虚构；放弃文案可覆盖", async () => {
    const onDiscard = vi.fn();
    render(ReceiptSummary, {
      props: {
        dataTypes: "含差异",
        scopeText: "当前范围 1 个文件",
        budgetText: "单文件 6000 字符",
        historyIncluded: false,
        onConfirm: vi.fn(),
        onDiscard,
        confirmLabel: "开始模型分析",
        cancelLabel: "继续仅本地检查",
      },
    });
    expect(screen.queryByText("demo-model")).toBeNull();
    await fireEvent.click(screen.getByText("继续仅本地检查"));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });
});
