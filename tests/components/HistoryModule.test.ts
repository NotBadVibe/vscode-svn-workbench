import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import HistoryModule from "../../src/webview/features/history/HistoryModule.svelte";
import type { HistorySnapshot } from "../../src/protocol/workbenchProtocol";

const snapshot: HistorySnapshot = {
  kind: "history",
  revisions: [
    {
      revision: "12",
      author: "alice",
      date: "2026-07-30T08:00:00Z",
      message: "调整工作台",
      changedPaths: [{ action: "M", path: "/trunk/a.ts" }],
    },
    {
      revision: "11",
      author: "bob",
      date: "2026-07-29T08:00:00Z",
      message: "修复范围",
      changedPaths: [],
    },
  ],
  selectedRevision: "12",
  compareRevisions: [],
  limit: 100,
  fileActionsAvailable: true,
};

describe("HistoryModule", () => {
  it("选择两个修订后发送比较请求", async () => {
    const onAction = vi.fn();
    render(HistoryModule, { snapshot, onAction });

    await fireEvent.click(screen.getByLabelText("选择修订 12 进行比较"));
    await fireEvent.click(screen.getByLabelText("选择修订 11 进行比较"));
    await fireEvent.click(screen.getByRole("button", { name: "比较修订" }));

    expect(onAction).toHaveBeenCalledWith("history/compare", {
      revisions: ["12", "11"],
    });
  });
});
