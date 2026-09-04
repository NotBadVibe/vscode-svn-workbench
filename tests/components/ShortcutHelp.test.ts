/**
 * V017-B 上下文帮助组件：展开/关闭/焦点返回/IME。
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import ShortcutHelp from "../../src/webview/components/help/ShortcutHelp.svelte";

describe("ShortcutHelp", () => {
  it("只显示当前区域绑定（conflicts 不含列表全选）", async () => {
    render(ShortcutHelp, { region: "conflicts", open: true });
    expect(screen.getByTestId("shortcut-help-panel")).toHaveAttribute(
      "aria-label",
      "冲突快捷键",
    );
    expect(
      screen.getByTestId("shortcut-item-saveCheckpoint"),
    ).toHaveTextContent("保存检查点");
    expect(
      screen.getByTestId("shortcut-item-saveCheckpoint"),
    ).toHaveTextContent("Ctrl/⌘+S");
    expect(
      screen.queryByTestId("shortcut-item-selectAll"),
    ).not.toBeInTheDocument();
  });

  it("列表区域无搜索框时不含 `/`，有搜索框时含", async () => {
    const first = render(ShortcutHelp, { region: "list", open: true });
    expect(
      screen.queryByTestId("shortcut-item-searchFocus"),
    ).not.toBeInTheDocument();
    first.unmount();
    render(ShortcutHelp, {
      region: "list",
      open: true,
      searchAvailable: true,
    });
    expect(screen.getByTestId("shortcut-item-searchFocus")).toHaveTextContent(
      "/",
    );
  });

  it("触发按钮 hover 与 focus 双通道可感知（title + aria-label + 可聚焦）", async () => {
    render(ShortcutHelp, { region: "list" });
    const trigger = screen.getByTestId("shortcut-help-trigger");
    expect(trigger.getAttribute("title")).toBe("快捷键帮助（?）");
    expect(trigger.getAttribute("aria-label")).toBe("快捷键帮助（?）");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    await fireEvent.click(trigger);
    expect(screen.getByTestId("shortcut-help-panel")).toBeInTheDocument();
  });

  it("`?` 切换打开/关闭，Esc 关闭并焦点返回触发按钮", async () => {
    render(ShortcutHelp, { region: "diff" });
    const trigger = screen.getByTestId(
      "shortcut-help-trigger",
    ) as HTMLButtonElement;
    trigger.focus();
    await fireEvent.keyDown(trigger, { key: "?" });
    const panel = screen.getByTestId("shortcut-help-panel");
    expect(panel).toBeInTheDocument();
    // 打开后焦点进入面板关闭按钮。
    expect(document.activeElement).toBe(
      screen.getByTestId("shortcut-help-close"),
    );
    await fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByTestId("shortcut-help-panel")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("IME 候选阶段 `?` 不切换", async () => {
    render(ShortcutHelp, { region: "diff" });
    const trigger = screen.getByTestId("shortcut-help-trigger");
    await fireEvent.keyDown(trigger, { key: "?", isComposing: true });
    expect(screen.queryByTestId("shortcut-help-panel")).not.toBeInTheDocument();
    await fireEvent.keyDown(trigger, { key: "?", keyCode: 229 });
    expect(screen.queryByTestId("shortcut-help-panel")).not.toBeInTheDocument();
  });

  it("关闭按钮关闭并返回焦点", async () => {
    render(ShortcutHelp, { region: "dialog", open: true });
    const host = screen.getByTestId("shortcut-help-host");
    expect(host).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("shortcut-help-close"));
    expect(screen.queryByTestId("shortcut-help-panel")).not.toBeInTheDocument();
  });
});
