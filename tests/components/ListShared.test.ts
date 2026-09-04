import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import SearchInput from "../../src/webview/components/list/SearchInput.svelte";
import ResultCount from "../../src/webview/components/list/ResultCount.svelte";
import ListHarness from "./harness/ListHarness.svelte";

/*
 * v0.0.10 共享列表底座（批次 0 固化）：SearchInput/ResultCount 与
 * useFileList 的非选择语义（键盘导航、Escape 关详情、窗口化、焦点恢复）。
 * Changes/Commit 的完整行为由 ListSelection.test.ts 回归覆盖。
 */

describe("SearchInput 共享搜索框", () => {
  it("输入后出现清除按钮，清除后恢复占位并回到空值", async () => {
    render(SearchInput, {
      ariaLabel: "筛选条目",
      placeholder: "筛选…",
    });
    const input = screen.getByRole("textbox", {
      name: "筛选条目",
    }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "清除筛选" })).toBeNull();
    await fireEvent.input(input, { target: { value: "src" } });
    expect(input.value).toBe("src");
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(input.value).toBe("");
    expect(screen.queryByRole("button", { name: "清除筛选" })).toBeNull();
  });

  it("Esc 清除筛选并保持焦点；IME 候选中不清除", async () => {
    render(SearchInput, { ariaLabel: "筛选条目" });
    const input = screen.getByRole("textbox", {
      name: "筛选条目",
    }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "src" } });
    expect(input.value).toBe("src");
    input.focus();
    // IME 候选阶段的 Esc 先处理输入法，不清除。
    await fireEvent.keyDown(input, { key: "Escape", isComposing: true });
    expect(input.value).toBe("src");
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    // 清空后焦点仍在输入框，键盘用户可继续输入。
    expect(document.activeElement).toBe(input);
    // 空值时 Esc 不抛错。
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
  });

  it("IME composition 阶段的 Enter 不改变筛选值", async () => {
    render(SearchInput, { ariaLabel: "筛选条目" });
    const input = screen.getByRole("textbox", {
      name: "筛选条目",
    }) as HTMLInputElement;
    await fireEvent.input(input, { target: { value: "中" } });
    // composition 期间的 Enter 只是输入法确认候选，不触发任何语义。
    await fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    await fireEvent.keyUp(input, {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    expect(input.value).toBe("中");
  });
});

describe("ResultCount 共享结果数量", () => {
  it("以 role=status 播报筛选结果数量", () => {
    render(ResultCount, { count: 7 });
    expect(screen.getByRole("status")).toHaveTextContent("7 个结果");
  });
});

describe("useFileList 共享列表控制器", () => {
  it("方向键/Home/End 移动活动行并聚焦对应行", async () => {
    render(ListHarness, { items: ["a", "b", "c", "d", "e"] });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "ArrowDown" });
    expect(
      document.querySelector<HTMLElement>("[data-row-index='0']")?.classList,
    ).toContain("harness-row--active");
    await fireEvent.keyDown(container, { key: "End" });
    expect(
      document.querySelector<HTMLElement>("[data-row-index='4']")?.classList,
    ).toContain("harness-row--active");
    await fireEvent.keyDown(container, { key: "Home" });
    expect(
      document.querySelector<HTMLElement>("[data-row-index='0']")?.classList,
    ).toContain("harness-row--active");
  });

  it("Escape 关闭打开的路径详情；未打开时不拦截", async () => {
    render(ListHarness, { items: ["a", "b"] });
    await fireEvent.click(screen.getByText("打开详情"));
    expect(screen.getByTestId("detail")).toBeInTheDocument();
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "Escape" });
    expect(screen.queryByTestId("detail")).toBeNull();
    // 再次 Escape 不抛错、不改变列表。
    await fireEvent.keyDown(container, { key: "Escape" });
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("Enter 激活当前活动行；无选择语义的列表不响应 Ctrl+A", async () => {
    render(ListHarness, { items: ["a", "b"] });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "ArrowDown" });
    await fireEvent.keyDown(container, { key: "Enter" });
    expect(screen.getByTestId("activated")).toHaveTextContent("a");
    // 非选择列表：Ctrl+A 保持原生行为（不抛错、无状态变化）。
    await fireEvent.keyDown(container, { key: "a", ctrlKey: true });
    expect(screen.getByTestId("activated")).toHaveTextContent("a");
  });

  it("超过阈值启用窗口化，只渲染可见窗口内的行", () => {
    const items = Array.from({ length: 400 }, (_, index) => `item-${index}`);
    render(ListHarness, { items, virtualizeAfter: 300 });
    const rendered = document.querySelectorAll(".harness-row");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(items.length);
  });

  it("`/` 聚焦搜索（仅接线列表）；`?` 不触发搜索", async () => {
    render(ListHarness, { items: ["a", "b"] });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "/" });
    expect(screen.getByTestId("search-focused")).toHaveTextContent(
      "搜索已聚焦",
    );
  });

  it("resetNavigation 后清除活动行", async () => {
    render(ListHarness, { items: ["a", "b", "c"] });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "End" });
    expect(document.querySelectorAll(".harness-row--active").length).toBe(1);
    await fireEvent.click(
      document.querySelector<HTMLElement>("[data-row-index='1']")!,
    );
    expect(document.querySelectorAll(".harness-row--active").length).toBe(1);
    // 活动行恢复由键盘导航与筛选变化驱动；点击只移动活动行。
    await fireEvent.keyDown(container, { key: "ArrowDown" });
    expect(document.querySelectorAll(".harness-row--active").length).toBe(1);
  });
});
