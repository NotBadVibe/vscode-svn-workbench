/**
 * V017-B 冲突双轨 `?` 收敛：工具栏与模块级共用单一帮助实例。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";
import { SVN_SINGLE } from "../../src/conflict/fixtures";

vi.mock("@pierre/diffs", () => ({
  UnresolvedFile: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
  File: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
}));
vi.mock("@pierre/diffs/edit", () => ({
  Editor: class {
    constructor() {}
    edit() {
      return () => {};
    }
    getText() {
      return "";
    }
    applyEdits() {}
    cleanUp() {}
    canUndo() {
      return false;
    }
    canRedo() {
      return false;
    }
    undo() {}
    redo() {}
    focus() {}
  },
}));
vi.mock("../../src/webview/features/diff/cspCompatObserver", () => ({
  observeDiffContainer: () => ({ disconnect: () => {} }),
  observeDiffShadowRoot: () => ({ disconnect: () => {} }),
  installDiffCspCompatibilityShim: () => {},
}));

function snapshotWith(text: string): ConflictSnapshot {
  return {
    kind: "conflicts",
    conflicts: [
      { relativePath: "src/a.ts", type: "text", operation: "update" },
    ],
    selected: {
      relativePath: "src/a.ts",
      sourceLeftRevision: "127",
      sourceRightRevision: "128",
      contents: {
        working: { content: text, truncated: false },
        mine: { content: "local", truncated: false },
        theirs: { content: "remote", truncated: false },
        base: { content: "base", truncated: false },
      },
      mergeEditor: { token: "edit-1", editable: true, issues: [] },
      draft: {
        content: text,
        revision: 1,
        updatedAt: Date.now(),
        hasDraft: true,
        dirty: true,
      },
    },
  };
}

describe("冲突 `?` 帮助单一实例", () => {
  it("工具栏 `?` 与模块 `?` 打开同一实例，旧双轨面板不再存在", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: snapshotWith(SVN_SINGLE), onAction });
    await waitFor(() =>
      expect(screen.getByTestId("merge-action-toolbar")).toBeInTheDocument(),
    );
    // 初始关闭：新旧面板均不存在。
    expect(
      screen.queryByTestId("conflict-shortcut-help"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("shortcut-help")).not.toBeInTheDocument();

    // 工具栏 `?` 按钮打开模块级单一实例。
    await fireEvent.click(screen.getByTestId("toolbar-shortcut-help"));
    await waitFor(() =>
      expect(screen.getByTestId("conflict-shortcut-help")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("conflict-shortcut-help")).toHaveLength(1);
    expect(screen.queryByTestId("shortcut-help")).not.toBeInTheDocument();
    // 条目来自集中 keymap：保存检查点语义与 Diff 不同，需标注。
    expect(
      screen.getByTestId("shortcut-item-saveCheckpoint"),
    ).toHaveTextContent("不写入工作副本");

    // Esc 关闭并焦点返回工具栏 `?` 按钮。
    await fireEvent.keyDown(screen.getByTestId("conflict-shortcut-help"), {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByTestId("conflict-shortcut-help"),
      ).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(
      screen.getByTestId("toolbar-shortcut-help"),
    );

    // 模块 `?` 打开同一实例（仍只有一个）。
    const region = screen.getByRole("region", { name: "冲突处理" });
    await fireEvent.keyDown(region, { key: "?" });
    await waitFor(() =>
      expect(screen.getByTestId("conflict-shortcut-help")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("conflict-shortcut-help")).toHaveLength(1);
    expect(screen.queryByTestId("shortcut-help")).not.toBeInTheDocument();
  });
});
