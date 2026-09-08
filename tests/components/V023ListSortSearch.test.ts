import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangelistsModule from "../../src/webview/features/changelists/ChangelistsModule.svelte";
import SearchInput from "../../src/webview/components/list/SearchInput.svelte";
import type {
  ChangelistsSnapshot,
  WorkbenchFileView,
} from "../../src/protocol/workbenchProtocol";
import {
  loadListPreferences,
  saveListPreferences,
} from "../../src/webview/app/listPreferences";
import {
  naturalCompare,
  sortSelectionItems,
  type SelectionSortable,
} from "../../src/selection/selectionSort";
import type { SelectionKey } from "../../src/selection/selectionCore";
import ListHarness from "./harness/ListHarness.svelte";

/*
 * V023-R21+R22+R23 三件套回归（真实行为断言，非源码扫描）。
 * - R21：折叠不改变匹配数；全选含折叠组匹配；清空搜索恢复折叠偏好且不改已选。
 * - R22：偏好按模块隔离；自然排序 file2<file10、中文稳定、未知状态恒末尾。
 * - R23：空结果 `/` 仍聚焦搜索；IME/输入框闸门；Esc 清空保留焦点。
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
        files: [groupFile("src/ui-a.ts"), groupFile("src/ui-b.ts")],
      },
      {
        name: "server",
        files: [groupFile("src/server-a.ts"), groupFile("src/server-b.ts")],
      },
    ],
    unassigned: [],
    suggestions: [],
    warnings: [],
    ...overrides,
  };
}

describe("V023-R21 折叠与匹配集合分离", () => {
  it("折叠所有组后匹配数不变，全选仍得到全部匹配项", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });

    // 搜索命中每组各 1 个（ui-a / server-a）。
    const searchBox = screen.getByRole("textbox", {
      name: "筛选变更集文件",
    });
    await fireEvent.input(searchBox, { target: { value: "-a" } });
    expect(screen.getByText("2 个匹配")).toBeInTheDocument();

    // 折叠命中组：顶部匹配数不变（组头另有 matchedCount，不随折叠变化）。
    await fireEvent.click(
      screen.getByRole("button", { name: "ui，匹配 1，共 2" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "server，匹配 1，共 2" }),
    );
    expect(screen.getByText("2 个匹配")).toBeInTheDocument();

    // 选择全部匹配项包含折叠组匹配文件。
    await fireEvent.click(
      screen.getByRole("button", { name: "选择全部匹配项（2）" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "加入应用栏（2）" }),
    );
    expect(
      screen.getByText("已把 2 个已选文件加入应用栏。"),
    ).toBeInTheDocument();
  });

  it("清空搜索恢复用户折叠偏好且不改变已选", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });

    // 非搜索态折叠 ui 组作为用户偏好。
    await fireEvent.click(
      screen.getByRole("button", { name: "ui，匹配 2，共 2" }),
    );
    // 选中 server 组一个文件。
    await fireEvent.click(
      screen.getByRole("checkbox", { name: "选择 src/server-a.ts" }),
    );

    // 搜索期间命中组默认展开（覆盖层），清空后恢复用户偏好。
    const searchBox = screen.getByRole("textbox", {
      name: "筛选变更集文件",
    });
    await fireEvent.input(searchBox, { target: { value: "ui-a" } });
    expect(
      screen.getByRole("button", { name: "ui，匹配 1，共 2" }),
    ).toHaveAttribute("aria-expanded", "true");
    await fireEvent.input(searchBox, { target: { value: "" } });
    expect(
      screen.getByRole("button", { name: "ui，匹配 2，共 2" }),
    ).toHaveAttribute("aria-expanded", "false");
    // 已选不改变。
    expect(
      screen.getByRole("checkbox", { name: "选择 src/server-a.ts" }),
    ).toBeChecked();
  });

  it("分组批量选择提供组级数量且只改变选择", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });
    const groupButtons = screen.getAllByRole("button", {
      name: "选择本组匹配项（2）",
    });
    expect(groupButtons).toHaveLength(2);
    await fireEvent.click(groupButtons[0]);
    // 未触发任何写操作预览，只改变选择（加入应用栏显示 2）。
    expect(onAction).not.toHaveBeenCalledWith(
      "changelist/preview-apply",
      expect.anything(),
    );
    expect(
      screen.getByRole("button", { name: "加入应用栏（2）" }),
    ).toBeInTheDocument();
  });
});

describe("V023-R22 排序偏好按模块隔离与稳定排序", () => {
  it("changes 与 repository-browse 偏好互不串扰", () => {
    saveListPreferences("changes-test-isolation", {
      sortField: "status",
      sortDirection: "desc",
    });
    saveListPreferences("repository-browse-test-isolation", {
      customSortField: "size",
      sortDirection: "desc",
    });
    const changes = loadListPreferences("changes-test-isolation");
    const browse = loadListPreferences("repository-browse-test-isolation");
    expect(changes.sortField).toBe("status");
    expect(changes.customSortField).toBeUndefined();
    expect(browse.customSortField).toBe("size");
    expect(browse.sortField).toBeUndefined();
  });

  it("file2/file10、中文、同名、未知状态排序稳定", () => {
    expect(naturalCompare("file2", "file10")).toBeLessThan(0);
    expect(naturalCompare("file10", "file2")).toBeGreaterThan(0);
    expect(naturalCompare("中文.ts", "中文2.ts")).toBeLessThan(0);
    const key = (value: string): SelectionKey => value as SelectionKey;
    const sortable = (path: string, status?: string): SelectionSortable => ({
      key: key(path),
      path,
      ...(status ? { status } : {}),
    });
    const asc = sortSelectionItems(
      [sortable("b.ts"), sortable("a.ts"), sortable("a.ts", "modified")],
      { field: "path", direction: "asc", statusOrder: ["modified"] },
    ).map((item) => item.path);
    expect(asc[0]).toBe("a.ts");
    // 未知状态恒排末尾，降序不反转未知值。
    const withUnknown = sortSelectionItems(
      [sortable("a.ts", "zzz-unknown"), sortable("b.ts", "modified")],
      { field: "status", direction: "desc", statusOrder: ["modified"] },
    ).map((item) => item.path);
    expect(withUnknown[withUnknown.length - 1]).toBe("a.ts");
  });
});

describe("V023-R23 搜索快捷键统一可用", () => {
  it("空列表 `/` 仍聚焦搜索", async () => {
    render(ListHarness, { items: [] });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "/" });
    expect(screen.getByTestId("search-focused")).toBeInTheDocument();
  });

  it("IME 候选与文本输入中的 `/` 不被抢", async () => {
    render(ListHarness, { items: [] });
    const container = screen.getByRole("list");
    container.focus();
    const composing = new KeyboardEvent("keydown", { key: "/" });
    Object.defineProperty(composing, "isComposing", { value: true });
    // shouldHandleListKeydown 入口闸门：候选阶段不处理。
    const { shouldHandleListKeydown } =
      await import("../../src/webview/components/list/listModel");
    expect(shouldHandleListKeydown(composing)).toBe(false);
    const input = document.createElement("input");
    const inInput = new KeyboardEvent("keydown", { key: "/" });
    Object.defineProperty(inInput, "target", { value: input });
    expect(shouldHandleListKeydown(inInput)).toBe(false);
  });

  it("Esc 清空搜索后保留焦点且选择不变", async () => {
    render(SearchInput, {
      value: "abc",
      ariaLabel: "筛选测试",
    });
    const input = screen.getByLabelText("筛选测试") as HTMLInputElement;
    input.focus();
    await fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("变更集空结果下 `/` 仍可聚焦搜索", async () => {
    const onAction = vi.fn();
    render(ChangelistsModule, { snapshot: buildSnapshot(), onAction });
    await fireEvent.input(
      screen.getByRole("textbox", { name: "筛选变更集文件" }),
      { target: { value: "不存在的查询串" } },
    );
    const region = screen.getByRole("region", {
      name: "变更集与未分组文件",
    });
    region.focus();
    await fireEvent.keyDown(region, { key: "/" });
    expect(document.activeElement).toBe(
      screen.getByLabelText("筛选变更集文件"),
    );
  });
});
