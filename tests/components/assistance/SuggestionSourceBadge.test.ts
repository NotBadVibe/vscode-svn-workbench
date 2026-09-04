/**
 * v0.1.6 V016-B：SuggestionSourceBadge 组件测试。
 * 覆盖：四来源如实标注 / 本地结果禁止 AI 字样 / 模型名展示 /
 * 降级原因完整展示 / 过期标记 / 中文时间。
 *
 * 平台无关说明：本组件不处理文件路径，断言中不使用任何路径字面量。
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SuggestionSourceBadge from "../../../src/webview/components/assistance/SuggestionSourceBadge.svelte";

describe("SuggestionSourceBadge", () => {
  it("本地检查：显示本地检查且不含 AI 字样", () => {
    render(SuggestionSourceBadge, { props: { source: "local-rule" } });
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("本地检查");
    expect(badge.textContent ?? "").not.toMatch(/AI|智能/);
    expect(badge).toHaveAttribute("aria-label", "结果来源：本地检查");
  });

  it("模型建议：显示模型名", () => {
    render(SuggestionSourceBadge, {
      props: { source: "configured-model", model: "demo-model" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "模型建议（demo-model）",
    );
  });

  it("模型建议缺模型名时不虚构", () => {
    render(SuggestionSourceBadge, {
      props: { source: "configured-model" },
    });
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("模型建议");
    expect(badge.textContent ?? "").not.toContain("（");
  });

  it("降级：完整标注降级原因，不简称 AI 分析", () => {
    render(SuggestionSourceBadge, {
      props: {
        source: "local-rule-fallback",
        fallbackReason: "模型超时，已保留本地结果。",
      },
    });
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("模型不可用，已保留本地结果");
    expect(badge).toHaveTextContent("模型超时，已保留本地结果。");
  });

  it("未配置：如实提示不伪装", () => {
    render(SuggestionSourceBadge, { props: { source: "unconfigured" } });
    const badge = screen.getByRole("status");
    expect(badge).toHaveTextContent("未配置外部模型");
    expect(badge.textContent ?? "").not.toMatch(/AI 已审查|智能分析/);
  });

  it("过期标记：结果已过期", () => {
    render(SuggestionSourceBadge, {
      props: { source: "configured-model", model: "demo-model", stale: true },
    });
    expect(screen.getByRole("status")).toHaveTextContent("结果已过期");
  });

  it("生成时间按中文格式展示", () => {
    const generatedAt = new Date("2026-08-23T17:05:00+08:00").getTime();
    render(SuggestionSourceBadge, {
      props: { source: "local-rule", generatedAt },
    });
    expect(screen.getByRole("status").textContent ?? "").toContain("2026");
  });
});
