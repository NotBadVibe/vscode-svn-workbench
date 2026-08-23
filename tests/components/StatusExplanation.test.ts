import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import StatusExplanation from "../../src/webview/components/svn/StatusExplanation.svelte";
import { statusExplanations } from "../../src/webview/i18n/terminology";

/*
 * v0.0.18 批次 B（C-05）：状态词就地解释——键盘可达（aria-expanded），
 * 不只依赖悬停；Esc 关闭。
 */

describe("StatusExplanation（v0.0.18）", () => {
  it("点击展开就地释义，Esc 关闭；悬停 title 同步提供简版", async () => {
    const term = "存在冲突";
    const explanation = statusExplanations.conflicted;
    render(StatusExplanation, { term, explanation });
    const trigger = screen.getByRole("button", { name: "解释术语：存在冲突" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.getAttribute("title")).toContain(explanation);
    await fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("note")).toHaveTextContent(explanation);
    await fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("每个状态词都有非空解释（terminology 统一维护）", () => {
    for (const [status, explanation] of Object.entries(statusExplanations)) {
      expect(status).toBeTruthy();
      expect(explanation.length).toBeGreaterThan(8);
    }
  });
});
