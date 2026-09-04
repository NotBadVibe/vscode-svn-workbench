/**
 * V017-B 列表紧凑提示条：按区域生成、会话记忆、可忽略。
 */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import ListShortcutHint from "../../src/webview/components/help/ListShortcutHint.svelte";
import { resetHintSession } from "../../src/webview/components/help/helpSession";

beforeEach(() => {
  resetHintSession();
});

describe("ListShortcutHint", () => {
  it("列表提示含 Space/Enter/Shift+F10，不含无关冲突命令", async () => {
    render(ListShortcutHint, {
      region: "list",
      hintKey: "test-list",
      searchAvailable: true,
    });
    const hint = screen.getByTestId("list-shortcut-hint");
    expect(hint).toHaveAttribute("role", "note");
    expect(hint.getAttribute("aria-label")).toContain("Space 选择");
    expect(hint.getAttribute("aria-label")).toContain("Enter 看差异");
    expect(hint.getAttribute("aria-label")).toContain("Shift+F10 更多");
    expect(hint.getAttribute("aria-label")).toContain("/ 搜索");
    expect(hint.textContent).not.toContain("保存检查点");
  });

  it("无搜索框的区域不含 `/` 搜索", async () => {
    render(ListShortcutHint, { region: "list", hintKey: "no-search" });
    expect(screen.getByTestId("list-shortcut-hint").textContent).not.toContain(
      "/",
    );
  });

  it("条目 hover 有 title，容器 focus 可达并播报全文", async () => {
    render(ListShortcutHint, {
      region: "list",
      hintKey: "focus-hint",
      searchAvailable: true,
    });
    const hint = screen.getByTestId("list-shortcut-hint");
    expect(hint.getAttribute("tabindex")).toBe("0");
    hint.focus();
    expect(document.activeElement).toBe(hint);
  });

  it("关闭后隐藏，同会话同 key 不再出现，不同 key 仍出现", async () => {
    const first = render(ListShortcutHint, {
      region: "list",
      hintKey: "session-key",
      searchAvailable: true,
    });
    await fireEvent.click(screen.getByTestId("list-shortcut-hint-dismiss"));
    expect(screen.queryByTestId("list-shortcut-hint")).not.toBeInTheDocument();
    first.unmount();
    // 同一 key：会话内记忆，不再展示。
    render(ListShortcutHint, {
      region: "list",
      hintKey: "session-key",
      searchAvailable: true,
    });
    expect(screen.queryByTestId("list-shortcut-hint")).not.toBeInTheDocument();
    // 不同 key：仍展示。
    render(ListShortcutHint, {
      region: "list",
      hintKey: "other-key",
      searchAvailable: true,
    });
    expect(screen.getAllByTestId("list-shortcut-hint")).toHaveLength(1);
  });
});
