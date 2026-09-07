import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import HistoryModule from "../../src/webview/features/history/HistoryModule.svelte";
import type { HistorySnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V020-R10 · 单文件历史横幅：目标文件、失效原因与返回来源列表入口；
 * 快照刷新只更新文本，不移动焦点。
 */

const base: HistorySnapshot = {
  kind: "history",
  revisions: [
    {
      revision: "42",
      author: "yangnan",
      date: "2026-07-30T08:30:00.000Z",
      message: "迁移统一 Svelte 工作台",
      changedPaths: [{ action: "M", path: "/trunk/src/second.ts" }],
    },
  ],
  selectedRevision: "42",
  compareRevisions: [],
  limit: 100,
  fileActionsAvailable: true,
};

describe("V020-R10 历史单文件横幅与返回", () => {
  it("行目标进入时显示单文件横幅，返回恢复来源列表", async () => {
    const onAction = vi.fn();
    render(HistoryModule, {
      snapshot: {
        ...base,
        fileTarget: { relativePath: "src/second.ts" },
      },
      onAction,
    });
    const banner = screen.getByTestId("history-file-target");
    expect(banner).toHaveTextContent("src/second.ts");
    expect(banner).toHaveTextContent("文件级 blame 与恢复可用");
    await fireEvent.click(screen.getByRole("button", { name: "返回本地修改" }));
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "changes",
      taskId: "changes/overview",
    });
  });

  it("目标失效时给出原因并保留返回入口", () => {
    render(HistoryModule, {
      snapshot: {
        ...base,
        fileActionsAvailable: false,
        fileTarget: {
          relativePath: "src/second.ts",
          notice:
            "目标文件src/second.ts已不在工作副本中（可能已删除），当前显示目录历史；",
        },
      },
      onAction: vi.fn(),
    });
    const banner = screen.getByTestId("history-file-target");
    expect(banner).toHaveTextContent("可能已删除");
    expect(
      screen.getByRole("button", { name: "返回本地修改" }),
    ).toBeInTheDocument();
  });

  it("目录历史不显示单文件横幅", () => {
    render(HistoryModule, { snapshot: base, onAction: vi.fn() });
    expect(screen.queryByTestId("history-file-target")).toBeNull();
  });
});
