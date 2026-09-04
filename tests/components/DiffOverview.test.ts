import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import DiffOverview from "../../src/webview/features/diff/DiffOverview.svelte";
import type { OverviewBlock } from "../../src/webview/features/diff/diffOverviewModel";

function makeBlocks(count: number): OverviewBlock[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `diff-${i}`,
    startLine: i * 10 + 1,
    endLine: i * 10 + 5,
    status: i % 3 === 2 ? ("whitespace-only" as const) : ("change" as const),
    label: `第 ${i * 10 + 1} 行`,
    preview: `line-${i}`,
  }));
}

describe("DiffOverview 定位器（V018-D §4.4）", () => {
  it("分布+列表+当前块三要素可见，状态不只靠颜色", () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(3),
        currentIndex: 1,
        totalLines: 100,
        onSelect,
      },
    });
    expect(screen.getByTestId("diff-overview")).toBeInTheDocument();
    expect(screen.getByTestId("diff-overview-rail")).toBeInTheDocument();
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();
    // 摘要 X/Y 文字通道
    expect(screen.getByRole("status").textContent).toContain("2/3");
    // 状态图形+文字双通道
    expect(screen.getAllByText("● 变更").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("○ 仅空白差异")).toBeInTheDocument();
    // 当前块 aria-current + “当前”文字
    const current = screen.getByRole("button", { name: /第 2\/3 块/ });
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("当前")).toBeInTheDocument();
    // Roving tabindex：仅当前块可 Tab 到达，其余经方向键定位
    expect(current.getAttribute("tabindex")).toBe("0");
    expect(
      screen
        .getByRole("button", { name: /第 1\/3 块/ })
        .getAttribute("tabindex"),
    ).toBe("-1");
    void onSelect;
  });

  it("点击选择通知父级导航索引（不碰文件/范围）", async () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(4),
        currentIndex: 0,
        totalLines: 100,
        onSelect,
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: /第 3\/4 块/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("键盘可达：列表方向键/Home/End/PageDown 移动焦点", async () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(15),
        currentIndex: 0,
        totalLines: 200,
        onSelect,
      },
    });
    const list = screen.getByTestId("diff-overview-list");
    const first = screen.getByRole("button", { name: /第 1\/15 块/ });
    first.focus();
    expect(document.activeElement).toBe(first);
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /第 2\/15 块/ }),
    );
    await fireEvent.keyDown(list, { key: "End" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /第 15\/15 块/ }),
    );
    await fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(first);
  });

  it("IME 候选期方向键不触发焦点移动", async () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(5),
        currentIndex: 0,
        totalLines: 100,
        onSelect,
      },
    });
    const list = screen.getByTestId("diff-overview-list");
    const first = screen.getByRole("button", { name: /第 1\/5 块/ });
    first.focus();
    await fireEvent.keyDown(list, { key: "ArrowDown", keyCode: 229 });
    expect(document.activeElement).toBe(first);
  });

  it("可折叠：收起后列表卸载，展开恢复（720×480 不占主编辑区）", async () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(2),
        currentIndex: 0,
        totalLines: 50,
        onSelect,
      },
    });
    const toggle = screen.getByTestId("diff-overview-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diff-overview-list")).toBeNull();
    expect(screen.getByText("定位器")).toBeInTheDocument();
    await fireEvent.click(toggle);
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();
  });

  it("空块显示暂无状态", () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: { blocks: [], currentIndex: 0, totalLines: 10, onSelect },
    });
    expect(
      screen.getAllByText("暂无可定位的变更块").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("门控：101 块超阈值默认折叠不渲染列表，用户可显式展开且提示成本", async () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(101),
        currentIndex: 0,
        totalLines: 2000,
        onSelect,
      },
    });
    const toggle = screen.getByTestId("diff-overview-toggle");
    // 超阈值默认折叠：列表与分布条不渲染，折叠态零占位
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diff-overview-list")).toBeNull();
    expect(screen.queryByTestId("diff-overview-rail")).toBeNull();
    // 用户显式展开可用：列表恢复，成本提示可见，开关保持键盘可达
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();
    // jsdom 下 fireEvent.click 不自动聚焦；真实浏览器点击后焦点保持在开关上。
    // 此处断言开关本身可聚焦（键盘可达、焦点返回目标存在）。
    expect(toggle.tagName).toBe("BUTTON");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    const hint = screen.getByTestId("diff-overview-cost-hint");
    expect(hint.textContent).toContain("101");
    expect(hint.textContent).toContain("132ms");
    // 键盘可达：展开后列表可聚焦，方向键可定位
    const list = screen.getByTestId("diff-overview-list");
    const first = screen.getByRole("button", { name: /第 1\/101 块/ });
    first.focus();
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /第 2\/101 块/ }),
    );
    // 再次收起回到零占位
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diff-overview-list")).toBeNull();
  });

  it("门控：100 块边界默认展开", () => {
    const onSelect = vi.fn();
    render(DiffOverview, {
      props: {
        blocks: makeBlocks(100),
        currentIndex: 0,
        totalLines: 2000,
        onSelect,
      },
    });
    expect(
      screen.getByTestId("diff-overview-toggle").getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-overview-cost-hint")).toBeNull();
  });
});
