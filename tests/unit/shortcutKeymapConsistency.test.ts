/**
 * V017-B 集中 keymap 一致性（源码级断言）。
 * - 冲突兼容视图必须与集中 keymap 逐项一致（单一来源）；
 * - 组件不得硬编码 `（Ctrl/Cmd…）` 快捷键文案（平台归一 `Ctrl/⌘` 由 keymap 生成）；
 * - A1 真实绑定清单必须在 keymap 中有对应条目；
 * - 全部条目默认 IME 屏蔽；`/` 仅有搜索框列表可用。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it } from "vitest";
import {
  ALL_SHORTCUTS,
  getCompactHintItems,
  getShortcutsForRegion,
  SHORTCUTS_BY_REGION,
} from "../../src/webview/keyboard/shortcuts";
import {
  moveActiveIndex,
  pageSizeOf,
  shouldHandleListKeydown,
} from "../../src/webview/components/list/listModel";
import { isExplicitSubmitShortcut } from "../../src/webview/i18n/keyboard";
import ListHarness from "../components/harness/ListHarness.svelte";
import {
  CONFLICT_SHORTCUT_LIST,
  CONFLICT_SHORTCUTS,
} from "../../src/webview/features/conflicts/conflictShortcuts";

const root = process.cwd();
function readSource(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("集中 keymap 单一来源", () => {
  it("冲突兼容视图与集中 keymap 逐项一致", () => {
    const central = getShortcutsForRegion("conflicts");
    expect(CONFLICT_SHORTCUT_LIST).toHaveLength(central.length);
    for (const def of central) {
      const view =
        CONFLICT_SHORTCUTS[def.id as keyof typeof CONFLICT_SHORTCUTS];
      expect(view, `conflict shortcut ${def.id}`).toBeDefined();
      expect(view.label).toBe(def.label);
      expect(view.display).toBe(def.display);
      expect(view.title).toBe(def.title);
      expect([...view.keys]).toEqual([...def.keys]);
    }
  });

  it("conflictShortcuts 仅做兼容视图，不另写按键文案", () => {
    const source = readSource(
      "src/webview/features/conflicts/conflictShortcuts.ts",
    );
    expect(source).toContain("keyboard/shortcuts");
    expect(source).not.toMatch(/display:\s*"(Ctrl|Alt|Shift)[^"]*"/);
  });

  it("组件内禁止硬编码 `（Ctrl/Cmd…）` 快捷键文案", () => {
    const files = [
      "src/webview/features/conflicts/MergeActionToolbar.svelte",
      "src/webview/features/conflicts/ConflictsModule.svelte",
      "src/webview/features/diff/DiffModule.svelte",
      "src/webview/features/commit/CommitMessageEditor.svelte",
      "src/webview/components/list/SearchInput.svelte",
      "src/webview/features/changes/ChangesModule.svelte",
    ];
    for (const file of files) {
      expect(readSource(file), file).not.toMatch(/（Ctrl\/Cmd/);
    }
  });

  it("A1 真实绑定清单与 keymap 对齐", () => {
    const byRegionId = new Map(
      ALL_SHORTCUTS.map((def) => [`${def.region}/${def.id}`, def]),
    );
    const expected = [
      // 列表区（useFileList）
      "list/move",
      "list/page",
      "list/edge",
      "list/range",
      "list/selectAll",
      "list/toggle",
      "list/menu",
      "list/activate",
      "list/closeDetail",
      "list/searchFocus",
      "list/help",
      // 输入区
      "commitMessage/preview",
      "filterPreset/save",
      // 搜索
      "search/clear",
      // Diff：保存语义为写工作副本
      "diff/save",
      "diff/prevHunk",
      "diff/nextHunk",
      "diff/closeSettings",
      // Conflicts：保存语义为仅检查点（与 Diff 不同，需标注）
      "conflicts/saveCheckpoint",
      "conflicts/prevBlock",
      "conflicts/nextBlock",
      "conflicts/undo",
      "conflicts/redo",
      "conflicts/find",
      "conflicts/help",
      // Dialog
      "dialog/cancel",
      "dialog/tabLoop",
    ];
    for (const id of expected) {
      expect(byRegionId.has(id), id).toBe(true);
    }
    const diffSave = byRegionId.get("diff/save")!;
    const checkpoint = byRegionId.get("conflicts/saveCheckpoint")!;
    expect(diffSave.display).toBe(checkpoint.display);
    expect(diffSave.note).toMatch(/工作副本/);
    expect(checkpoint.note).toMatch(/不写入工作副本/);
    expect(diffSave.title).not.toBe(checkpoint.title);
  });

  it("全部条目标记 IME 屏蔽，title 由 label + display 生成", () => {
    for (const def of ALL_SHORTCUTS) {
      expect(def.imeGuarded, def.id).toBe(true);
      // title 以 `label（display` 开头（语义后缀允许在括号内追加）。
      expect(def.title.startsWith(`${def.label}（${def.display}`)).toBe(true);
    }
  });

  it("`/` 聚焦搜索仅有搜索框的列表出现", () => {
    const withoutSearch = getShortcutsForRegion("list");
    expect(withoutSearch.some((def) => def.id === "searchFocus")).toBe(false);
    const withSearch = getShortcutsForRegion("list", {
      searchAvailable: true,
    });
    expect(withSearch.some((def) => def.id === "searchFocus")).toBe(true);
    // 紧凑提示按区域实际绑定生成：无搜索框时不含 `/`。
    expect(
      getCompactHintItems("list").some((def) => def.id === "searchFocus"),
    ).toBe(false);
    expect(
      getCompactHintItems("list", { searchAvailable: true }).some(
        (def) => def.id === "searchFocus",
      ),
    ).toBe(true);
  });

  it("区域条目只属于本区域（`?` 不泄露无关命令）", () => {
    for (const region of Object.keys(SHORTCUTS_BY_REGION)) {
      for (const def of getShortcutsForRegion(
        region as keyof typeof SHORTCUTS_BY_REGION,
      )) {
        expect(def.region).toBe(region);
      }
    }
  });

  it("真实绑定行为：门控/分页/幂等/帮助隔离（V017-G2 P1-4）", async () => {
    // 门控：IME 组合/输入框焦点放行原文（不触发列表快捷键）。
    const composing = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(composing, "isComposing", { value: true });
    expect(shouldHandleListKeydown(composing)).toBe(false);
    const candidate = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(candidate, "keyCode", { value: 229 });
    expect(shouldHandleListKeydown(candidate)).toBe(false);
    const input = document.createElement("input");
    const inInput = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(inInput, "target", { value: input });
    expect(shouldHandleListKeydown(inInput)).toBe(false);
    const listBox = document.createElement("div");
    const onList = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(onList, "target", { value: listBox });
    expect(shouldHandleListKeydown(onList)).toBe(true);
    // 分页行数：按一页可见行数步进（pageSizeOf），边界夹紧。
    expect(pageSizeOf(500, 25)).toBe(20);
    expect(pageSizeOf(10, 25)).toBe(1);
    expect(moveActiveIndex(0, pageSizeOf(500, 25), 100)).toBe(20);
    expect(moveActiveIndex(95, pageSizeOf(500, 25), 100)).toBe(99);
    // Ctrl+A 幂等：连按两次各触发一次回调，不反向清空（计数 2）。
    render(ListHarness, {
      items: ["a", "b", "c"],
      enableSelectAll: true,
    });
    const container = screen.getByRole("list");
    container.focus();
    await fireEvent.keyDown(container, { key: "a", ctrlKey: true });
    await fireEvent.keyDown(container, {
      key: "A",
      ctrlKey: true,
      shiftKey: false,
    });
    expect(screen.getByTestId("select-all-count")).toHaveTextContent("2");
    // 输入区显式提交：IME 候选中不触发，普通 Enter 仅换行。
    expect(
      isExplicitSubmitShortcut({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        isComposing: false,
        keyCode: 13,
      }),
    ).toBe(true);
    expect(
      isExplicitSubmitShortcut({
        key: "Enter",
        ctrlKey: true,
        metaKey: false,
        isComposing: true,
        keyCode: 13,
      }),
    ).toBe(false);
    expect(
      isExplicitSubmitShortcut({
        key: "Enter",
        ctrlKey: false,
        metaKey: false,
        isComposing: false,
        keyCode: 13,
      }),
    ).toBe(false);
    // `?` 不泄露跨区绑定：仅帮助区（list/diff/conflicts）持有 `?`，且互不包含对方命令。
    const regionsWithHelp = (
      Object.keys(SHORTCUTS_BY_REGION) as Array<
        keyof typeof SHORTCUTS_BY_REGION
      >
    ).filter((region) =>
      getShortcutsForRegion(region).some((def) => def.keys.includes("?")),
    );
    expect([...regionsWithHelp].sort()).toEqual(
      ["conflicts", "diff", "list"].sort(),
    );
    const conflictIds = new Set(
      getShortcutsForRegion("conflicts").map((def) => def.id),
    );
    expect(conflictIds.has("selectAll")).toBe(false);
    expect(conflictIds.has("searchFocus")).toBe(false);
    const listIds = new Set(
      getShortcutsForRegion("list", { searchAvailable: true }).map(
        (def) => def.id,
      ),
    );
    expect(listIds.has("saveCheckpoint")).toBe(false);
  });
});
