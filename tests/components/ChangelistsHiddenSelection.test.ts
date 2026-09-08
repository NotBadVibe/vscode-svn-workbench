import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import type {
  ChangelistsSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";

/*
 * V020-R04：变更集隐藏选择统计及清理失效回归。
 * - 匹配集合（搜索 + 只看已选，忽略折叠/排序）计算隐藏与清除；
 * - 清除隐藏只移除匹配外选择，不取消当前匹配项；
 * - 折叠不等同筛选；刷新用全量候选求交并说明移除原因。
 */

const groupFile = (
  path: string,
  overrides: Partial<WorkbenchFileView> = {},
): WorkbenchFileView => ({
  relativePath: path,
  selectionKey: `test-wc::${path}` as never,
  status: "modified",
  selection: "selected",
  ...overrides,
});

function buildSnapshot(
  overrides: Partial<ChangelistsSnapshot> = {},
): ChangelistsSnapshot {
  return {
    kind: "changelists",
    source: "local-rule",
    aiPrivacy: {
      model: "local",
      fileLimit: 120,
      data: "metadata",
      historyIncluded: false,
    },
    groups: [
      {
        name: "ui",
        files: [groupFile("src/a.ts"), groupFile("src/b.ts")],
      },
    ],
    unassigned: [],
    suggestions: [],
    warnings: [],
    ...overrides,
  };
}

describe("V020-R04 变更集隐藏选择", () => {
  it("选 A/B 再搜索 A：显示已选 2/隐藏 1，清除隐藏后仅 A 进入预览", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });

    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/b.ts" }),
    );
    expect(screen.getByText("匹配 2 · 已选 2 · 隐藏 0")).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: "筛选变更集文件" });
    await fireEvent.input(input, { target: { value: "src/a.ts" } });

    // 匹配集合只剩 A：B 成为隐藏选择，但仍保留在已选中。
    expect(screen.getByText("匹配 1 · 已选 2 · 隐藏 1")).toBeInTheDocument();
    expect(screen.getByText("1 个结果")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "清除隐藏选择" }));
    expect(screen.getByText("匹配 1 · 已选 1 · 隐藏 0")).toBeInTheDocument();

    // 动作计数与预览路径使用同一合法选择：仅 A 进入应用栏。
    await fireEvent.click(
      screen.getByRole("button", { name: "加入应用栏（1）" }),
    );
    expect(screen.getByText("将分组的文件（1）")).toBeInTheDocument();

    // 清空搜索不会自动选回 B。
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/b.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(false);
    expect(
      (
        screen.getByRole("checkbox", {
          name: "选择 src/a.ts",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("折叠分组不改变筛选定义：隐藏计数与结果数保持匹配集合口径", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });

    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    const input = screen.getByRole("textbox", { name: "筛选变更集文件" });
    await fireEvent.input(input, { target: { value: "src/" } });
    expect(screen.getByText("匹配 2 · 已选 1 · 隐藏 0")).toBeInTheDocument();
    expect(screen.getByText("2 个结果")).toBeInTheDocument();

    // 折叠分组：渲染行收起，但匹配集合不变，隐藏仍为 0，结果数不变。
    await fireEvent.click(screen.getByRole("button", { name: "ui" }));
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.getByText("匹配 2 · 已选 1 · 隐藏 0")).toBeInTheDocument();
    expect(screen.getByText("2 个结果")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择当前筛选（2）" }),
    ).toBeInTheDocument();
  });

  it("刷新后已删除文件被剔除且说明原因", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ChangelistsModule, {
      snapshot: buildSnapshot(),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/a.ts" }),
    );
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/b.ts" }),
    );

    await rerender({
      snapshot: buildSnapshot({
        groups: [{ name: "ui", files: [groupFile("src/a.ts")] }],
      }),
      onAction,
    });
    expect(screen.getByText("匹配 1 · 已选 1 · 隐藏 0")).toBeInTheDocument();
    expect(screen.getByText(/刷新后移除 1 个失效选择/)).toBeInTheDocument();
  });
});
