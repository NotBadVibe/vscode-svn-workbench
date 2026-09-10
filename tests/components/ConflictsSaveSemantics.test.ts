/**
 * V027-R52+R54 · 冲突保存语义统一 + 编辑区 Esc 出口（组件级）。
 * - R52 兼容：Ctrl/⌘+S 仍只发 conflict/draft-checkpoint（不写文件，不接 Resolve）。
 * - R52 新增：Ctrl/⌘+Enter 发 conflict/save-working（与保存按钮同一动作，
 *   写入前 Host 复验；绝不发 conflict/resolve）。
 * - R52 迁移提示：保存栏常驻语义说明，逐项说清对象（检查点≠写盘）。
 * - R54：Esc 离开编辑区到保存栏；IME 候选期间 Esc/保存键均不触发。
 * - 断言平台无关：只用 ctrlKey 修饰，不读 navigator.platform。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

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

const DIRTY_DRAFT = "export const mode = 'merged-dirty';\n";
const SAVED_WORKING = "export const mode = 'saved';\n";

function dirtySnapshot(): ConflictSnapshot {
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
        working: { content: SAVED_WORKING, truncated: false },
        mine: { content: "local", truncated: false },
        theirs: { content: "remote", truncated: false },
        base: { content: "base", truncated: false },
      },
      mergeEditor: { token: "edit-1", editable: true, issues: [] },
      draft: {
        content: DIRTY_DRAFT,
        revision: 1,
        updatedAt: Date.now(),
        hasDraft: true,
        dirty: true,
      },
    },
  };
}

function actionsOf(onAction: ReturnType<typeof vi.fn>): string[] {
  return onAction.mock.calls.map((call) => String(call[0]));
}

describe("V027-R52 冲突保存语义", () => {
  it("Ctrl/⌘+S 仍只保存会话检查点（兼容旧语义，不写盘）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const region = screen.getByRole("region", { name: "冲突处理" });
    await fireEvent.keyDown(region, { key: "s", ctrlKey: true });
    await waitFor(() =>
      expect(actionsOf(onAction)).toContain("conflict/draft-checkpoint"),
    );
    expect(actionsOf(onAction)).not.toContain("conflict/save-working");
    expect(actionsOf(onAction)).not.toContain("conflict/resolve");
  });

  it("Ctrl/⌘+Enter 保存到工作副本（同一保存动作，不接 Resolve）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const region = screen.getByRole("region", { name: "冲突处理" });
    await fireEvent.keyDown(region, { key: "Enter", ctrlKey: true });
    await waitFor(() =>
      expect(actionsOf(onAction)).toContain("conflict/save-working"),
    );
    expect(onAction).toHaveBeenCalledWith("conflict/save-working", {
      editToken: "edit-1",
      content: DIRTY_DRAFT,
    });
    expect(actionsOf(onAction)).not.toContain("conflict/resolve");
    expect(actionsOf(onAction)).not.toContain("conflict/preview-resolve");
  });

  it("IME 候选期间保存键均不触发写入", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const region = screen.getByRole("region", { name: "冲突处理" });
    await fireEvent.keyDown(region, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    await fireEvent.keyDown(region, {
      key: "s",
      ctrlKey: true,
      isComposing: true,
    });
    expect(actionsOf(onAction)).not.toContain("conflict/save-working");
    expect(
      actionsOf(onAction).filter(
        (action) => action === "conflict/draft-checkpoint",
      ),
    ).toHaveLength(0);
  });

  it("保存栏常驻迁移提示：检查点≠写盘，写盘动作明确", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const note = screen.getByTestId("save-semantics-note");
    expect(note).toHaveTextContent("仅保存会话检查点");
    expect(note).toHaveTextContent("不写入工作副本文件");
    expect(note).toHaveTextContent("Ctrl/⌘+S");
    expect(note).toHaveTextContent("Ctrl/⌘+Enter");
    const saveButton = screen.getByTestId("save-working-copy");
    expect(saveButton).toHaveTextContent("保存工作副本合并结果");
    expect(saveButton.getAttribute("title")).toContain("写入工作副本文件");
  });

  it("帮助面板逐项说清保存对象（检查点与写盘不同条目）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    await fireEvent.click(screen.getByTestId("toolbar-shortcut-help"));
    await waitFor(() =>
      expect(screen.getByTestId("conflict-shortcut-help")).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId("shortcut-item-saveCheckpoint"),
    ).toHaveTextContent("不写入工作副本");
    expect(screen.getByTestId("shortcut-item-saveWorking")).toHaveTextContent(
      "保存到工作副本",
    );
    expect(screen.getByTestId("shortcut-item-saveWorking")).toHaveTextContent(
      "Ctrl/⌘+Enter",
    );
    expect(screen.getByTestId("shortcut-item-leaveEditor")).toHaveTextContent(
      "离开编辑区",
    );
  });
});

describe("V027-R54 编辑区 Esc 出口", () => {
  // 中文注释：jsdom 中 testing-library fireEvent 构造的 KeyboardEvent
  // （composed:true）到不了内层编辑宿主 div 的 Svelte 委托监听（同文件
  // section 级监听不受影响）；此处用原生 dispatch 测处理器逻辑，真实键盘
  // 由 webview-e2e 覆盖。
  function escOnHost(host: HTMLElement): void {
    host.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  it("Esc 离开编辑区到保存栏（保存可用时落到保存按钮）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const host = screen.getByTestId("conflict-result-editor-host");
    escOnHost(host);
    expect(document.activeElement).toBe(
      screen.getByTestId("save-working-copy"),
    );
  });

  it("IME 候选期间 Esc 不离开编辑区，结束后恢复", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const host = screen.getByTestId("conflict-result-editor-host");
    await fireEvent.compositionStart(host);
    escOnHost(host);
    expect(document.activeElement).not.toBe(
      screen.getByTestId("save-working-copy"),
    );
    await fireEvent.compositionEnd(host);
    escOnHost(host);
    expect(document.activeElement).toBe(
      screen.getByTestId("save-working-copy"),
    );
  });

  it("查找输入框内 Esc 交给编辑器内部，不离开", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: dirtySnapshot(), onAction });
    const host = screen.getByTestId("conflict-result-editor-host");
    const input = document.createElement("input");
    input.setAttribute("aria-label", "查找");
    host.appendChild(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).not.toBe(
      screen.getByTestId("save-working-copy"),
    );
    input.remove();
  });
});
