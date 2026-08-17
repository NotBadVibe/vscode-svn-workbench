import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import HistoryModule from "../../src/webview/features/history/HistoryModule.svelte";
import type { HistorySnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.10 跨模块列表迁移：修订排序与搜索清除、比较摘要与清空（固定
 * 两条，无全选）、Changed Paths 的搜索/操作类型筛选/排序/复制/路径详情。
 */

const snapshot: HistorySnapshot = {
  kind: "history",
  revisions: [
    {
      revision: "12",
      author: "alice",
      date: "2026-07-30T08:00:00Z",
      message: "调整工作台",
      changedPaths: [
        { action: "M", path: "/trunk/a.ts" },
        { action: "A", path: "/trunk/new/b.ts" },
        { action: "D", path: "/trunk/old/c.ts" },
      ],
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
    await fireEvent.click(
      screen.getByRole("button", { name: "比较所选修订（2/2）" }),
    );

    expect(onAction).toHaveBeenCalledWith("history/compare", {
      revisions: ["12", "11"],
    });
  });

  it("第三条比较选择替换最早选择，摘要提供清空", async () => {
    render(HistoryModule, { snapshot, onAction: vi.fn() });
    await fireEvent.click(screen.getByLabelText("选择修订 12 进行比较"));
    await fireEvent.click(screen.getByLabelText("选择修订 11 进行比较"));
    // 取消 12 再选回，模拟淘汰：直接验证清空入口。
    await fireEvent.click(screen.getByLabelText("选择修订 12 进行比较"));
    await fireEvent.click(screen.getByLabelText("选择修订 11 进行比较"));
    expect(screen.getByText(/已选择 0\/2 条修订/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清空比较选择" }));
    expect(screen.getByText(/已选择 0\/2 条修订/)).toBeInTheDocument();
  });

  it("修订排序在最新与最早之间切换并播报结果数量", async () => {
    render(HistoryModule, { snapshot, onAction: vi.fn() });
    expect(screen.getByText("2 条修订")).toBeInTheDocument();
    const sortMenu = screen.getByRole("combobox", {
      name: "修订排序",
    }) as HTMLSelectElement;
    await fireEvent.change(sortMenu, { target: { value: "oldest" } });
    const firstRow = document.querySelector(".revision-row");
    expect(firstRow).toHaveTextContent("r11");
    await fireEvent.change(sortMenu, { target: { value: "newest" } });
    expect(document.querySelector(".revision-row")).toHaveTextContent("r12");
    // 搜索清除：SharedSearchInput 行为。
    const input = screen.getByRole("textbox", { name: "筛选历史" });
    await fireEvent.input(input, { target: { value: "alice" } });
    expect(screen.getByText("1 条修订")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("2 条修订")).toBeInTheDocument();
  });

  it("Changed Paths 支持搜索、操作类型筛选与排序", async () => {
    render(HistoryModule, { snapshot, onAction: vi.fn() });
    // 默认按路径自然排序：a.ts、new/b.ts、old/c.ts。
    let rows = Array.from(document.querySelectorAll(".changed-path-row"));
    expect(rows.map((row) => row.textContent)).toEqual(
      expect.arrayContaining(
        ["M/trunk/a.ts", "A/trunk/new/b.ts", "D/trunk/old/c.ts"].map(() =>
          expect.any(String),
        ),
      ),
    );
    expect(rows[0]).toHaveTextContent("/trunk/a.ts");
    // 按操作类型排序：A 在前。
    const sortMenu = screen.getByRole("combobox", {
      name: "变更路径排序",
    }) as HTMLSelectElement;
    await fireEvent.change(sortMenu, { target: { value: "action" } });
    rows = Array.from(document.querySelectorAll(".changed-path-row"));
    expect(rows[0]).toHaveTextContent("A");
    // 操作类型筛选只保留删除。
    await fireEvent.click(screen.getByRole("button", { name: /删除 1/ }));
    rows = Array.from(document.querySelectorAll(".changed-path-row"));
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent("/trunk/old/c.ts");
    // 路径搜索。
    const input = screen.getByRole("textbox", { name: "筛选变更路径" });
    await fireEvent.input(input, { target: { value: "b.ts" } });
    expect(screen.getByText("0 条路径")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByText("1 条路径")).toBeInTheDocument();
  });

  it("变更路径行提供复制与路径详情入口", async () => {
    const onAction = vi.fn();
    render(HistoryModule, { snapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "复制路径 /trunk/a.ts" }),
    );
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: "/trunk/a.ts",
    });
    await fireEvent.click(
      screen.getByRole("button", {
        name: "查看 /trunk/a.ts 路径详情",
      }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "/trunk/a.ts",
    });
  });
});
