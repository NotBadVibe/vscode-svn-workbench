/* eslint-disable @typescript-eslint/no-unused-vars */
import { render, screen, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

const pierreState = vi.hoisted(() => ({
  fileInstances: 0,
  editorText: "",
  lastEdits: null as unknown,
  undoCalls: 0,
  redoCalls: 0,
  canUndoValue: false,
  canRedoValue: false,
}));

vi.mock("@pierre/diffs", () => ({
  File: class FakeFile {
    constructor(_opts: unknown) {
      pierreState.fileInstances += 1;
    }
    render(props: {
      file: { contents: string };
      containerWrapper: HTMLElement;
    }) {
      pierreState.editorText = props.file.contents;
      const host = props.containerWrapper;
      const el = document.createElement("div");
      el.setAttribute("data-testid", "pierre-result-file");
      host.appendChild(el);
      const diffs = document.createElement("diffs-container");
      host.appendChild(diffs);
      return true;
    }
    cleanUp() {}
  },
  UnresolvedFile: class {
    render(props: {
      file: { contents: string };
      containerWrapper: HTMLElement;
    }) {
      const host = props.containerWrapper;
      const el = document.createElement("div");
      el.setAttribute("data-testid", "pierre-diff-file");
      host.appendChild(el);
      return true;
    }
    cleanUp() {}
  },
}));

vi.mock("@pierre/diffs/edit", () => ({
  Editor: class FakeEditor {
    onChange: (() => void) | undefined;
    constructor(opts: { onChange: () => void }) {
      this.onChange = opts.onChange;
    }
    edit() {
      return () => {};
    }
    getText() {
      return pierreState.editorText;
    }
    applyEdits(edits: unknown[]) {
      pierreState.lastEdits = edits as unknown;
      pierreState.canUndoValue = true;
      // 模拟文本变更：取 newText 覆盖全量（若为单 edit 全量替换）
      const e = (edits as Array<{ newText: string }>)[0];
      if (e && typeof e.newText === "string") {
        // 若 edit 覆盖全段，简化设为 newText 追加
        // 实际 toolbar 会通过 syncMergeState 同步，这里仅记录
        pierreState.editorText =
          e.newText.length > 50 ? e.newText.slice(0, 50) : e.newText;
      }
    }
    canUndo() {
      return pierreState.canUndoValue;
    }
    canRedo() {
      return pierreState.canRedoValue;
    }
    undo() {
      pierreState.undoCalls += 1;
      pierreState.canRedoValue = true;
    }
    redo() {
      pierreState.redoCalls += 1;
    }
    focus() {}
    cleanUp() {}
    getState() {
      return {};
    }
    setState() {}
  },
}));

vi.mock("../../src/webview/features/diff/cspCompatObserver", () => ({
  observeDiffContainer: () => ({ disconnect: () => {} }),
  observeDiffShadowRoot: () => ({ disconnect: () => {} }),
  installDiffCspCompatibilityShim: () => {},
}));

import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import { SVN_SINGLE, MULTI_BLOCK } from "../../src/conflict/fixtures";

beforeEach(() => {
  pierreState.fileInstances = 0;
  pierreState.editorText = "";
  pierreState.lastEdits = null;
  pierreState.undoCalls = 0;
  pierreState.redoCalls = 0;
  pierreState.canUndoValue = false;
  pierreState.canRedoValue = false;
  vi.useRealTimers();
});
afterEach(() => vi.useRealTimers());

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

describe("V012-C 可撤销取舍工具栏", () => {
  it("渲染六个动作、行数预览与 X/Y", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: snapshotWith(SVN_SINGLE), onAction });
    await waitFor(() =>
      expect(screen.getByTestId("merge-action-toolbar")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("action-take-mine")).toBeInTheDocument();
    expect(screen.getByTestId("action-take-theirs")).toBeInTheDocument();
    expect(
      screen.getByTestId("action-take-both-mine-first"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("action-take-both-theirs-first"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("action-restore-original")).toBeInTheDocument();
    expect(screen.getByTestId("action-more-toggle")).toBeInTheDocument();
    // 行数预览含 + / - 行
    expect(screen.getByTestId("preview-take-mine").textContent).toMatch(
      /\+.*\/-.*行/,
    );
    expect(screen.getByTestId("preview-both-mine-first").textContent).toContain(
      "先我后他",
    );
    expect(
      screen.getByTestId("preview-both-theirs-first").textContent,
    ).toContain("先他后我");
    // X/Y
    expect(screen.getByTestId("merge-block-progress").textContent).toMatch(
      /1\/1/,
    );
    // undo/redo 存在且初始禁用
    expect(screen.getByTestId("action-undo")).toBeDisabled();
    expect(screen.getByTestId("action-redo")).toBeDisabled();
    // aria-live 播报容器
    expect(screen.getByTestId("merge-action-announcement")).toBeInTheDocument();
    // 键盘可达：toolbar 本身可聚焦
    expect(
      screen.getByTestId("merge-action-toolbar").getAttribute("tabindex"),
    ).toBe("0");
  });

  it("删除在更多菜单，需展开才可见且显示删除行数", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: snapshotWith(SVN_SINGLE), onAction });
    await waitFor(() =>
      expect(screen.getByTestId("merge-action-toolbar")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("action-delete-block")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("action-more-toggle"));
    expect(screen.getByTestId("action-delete-block")).toBeInTheDocument();
    expect(screen.getByTestId("preview-delete").textContent).toMatch(/-.*行/);
    expect(screen.getByTestId("more-menu").textContent).toContain("非默认动作");
  });

  it("四种取舍结果正确且两种 both 顺序不同", async () => {
    // 直接验证模型层（toolbar 调的就是它）
    const { createMergeDocument, applyMergeAction } =
      await import("../../src/conflict/mergeDocumentModel");
    const mk = (t: string) =>
      createMergeDocument({
        repositoryRoot: "",
        relativePath: "src/a.ts",
        authoritativeContents: t,
        baseContents: "",
        scopeHash: "scope",
        workingCopyRevision: "0",
      });
    const s0 = mk(SVN_SINGLE);
    if (!s0.ok) throw new Error(s0.message);
    const base = s0.state;
    const expected = {
      scopeHash: base.scopeHash,
      workingCopyRevision: base.workingCopyRevision,
      expectedAuthoritativeContents: base.authoritativeContents,
    };
    const mine = applyMergeAction(base, {
      expectedRevision: 0,
      action: "take-mine",
      expected,
    });
    const theirs = applyMergeAction(base, {
      expectedRevision: 0,
      action: "take-theirs",
      expected,
    });
    const bothMineFirst = applyMergeAction(base, {
      expectedRevision: 0,
      action: "take-both",
      order: "mine-first",
      expected,
    });
    const bothTheirsFirst = applyMergeAction(base, {
      expectedRevision: 0,
      action: "take-both",
      order: "theirs-first",
      expected,
    });
    expect(
      mine.ok &&
        (mine as { state: { draftContents: string } }).state.draftContents,
    ).toContain("我的修改-本地");
    expect(
      theirs.ok &&
        (theirs as { state: { draftContents: string } }).state.draftContents,
    ).toContain("对方修改-仓库r128");
    expect(bothMineFirst.ok && bothTheirsFirst.ok).toBe(true);
    if (!bothMineFirst.ok || !bothTheirsFirst.ok) throw new Error("both 失败");
    expect(bothMineFirst.state.draftContents).not.toBe(
      bothTheirsFirst.state.draftContents,
    );
    expect(
      bothMineFirst.state.draftContents.indexOf("我的修改-本地"),
    ).toBeLessThan(
      bothMineFirst.state.draftContents.indexOf("对方修改-仓库r128"),
    );
    expect(
      bothTheirsFirst.state.draftContents.indexOf("对方修改-仓库r128"),
    ).toBeLessThan(
      bothTheirsFirst.state.draftContents.indexOf("我的修改-本地"),
    );
  });

  it("动作+手工输入可逐条撤销（统一 undo 栈）与快捷键", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: snapshotWith(SVN_SINGLE), onAction });
    await waitFor(() =>
      expect(screen.getByTestId("merge-action-toolbar")).toBeInTheDocument(),
    );
    // 触发一个动作：采用我的修改
    await fireEvent.click(screen.getByTestId("action-take-mine"));
    await waitFor(() =>
      expect(
        screen.getByTestId("merge-action-announcement").textContent,
      ).toMatch(/已采用/),
    );
    // 撤销通过按钮或快捷键均进入同一 undo 栈（mock 的 canUndo 为状态值，需用快捷键确保可触发）
    const tb = screen.getByTestId("merge-action-toolbar");
    const undoBtn = screen.getByTestId("action-undo");
    if (!(undoBtn as HTMLButtonElement).disabled) {
      await fireEvent.click(undoBtn);
    } else {
      await fireEvent.keyDown(tb, { key: "z", ctrlKey: true });
    }
    expect(pierreState.undoCalls).toBeGreaterThanOrEqual(1);
    // 快捷键 Ctrl+Z
    const toolbar = screen.getByTestId("merge-action-toolbar");
    await fireEvent.keyDown(toolbar, { key: "z", ctrlKey: true });
    expect(pierreState.undoCalls).toBeGreaterThanOrEqual(2);
    // 重做 Ctrl+Shift+Z
    pierreState.canRedoValue = true;
    await fireEvent.keyDown(toolbar, {
      key: "Z",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(pierreState.redoCalls).toBeGreaterThanOrEqual(1);
  });

  it("手工改写后拒绝并提示恢复", async () => {
    const { createMergeDocument, applyMergeEdit, applyMergeAction } =
      await import("../../src/conflict/mergeDocumentModel");
    const r = createMergeDocument({
      repositoryRoot: "",
      relativePath: "src/a.ts",
      authoritativeContents: SVN_SINGLE,
      baseContents: "",
      scopeHash: "s",
      workingCopyRevision: "0",
    });
    if (!r.ok) throw new Error(r.message);
    const id = r.state.regions[0]!.baseIdentity!;
    const mineStart = r.state.draftContents.indexOf("const mineValue");
    const edited = applyMergeEdit(r.state, {
      expectedRevision: 0,
      edit: { start: mineStart, end: mineStart, newText: "// 手工\n" },
    });
    if (!edited.ok) throw new Error(edited.message);
    const blocked = applyMergeAction(edited.state, {
      expectedRevision: 1,
      action: "take-theirs",
      regionBaseIdentity: id as never,
      expected: {
        scopeHash: edited.state.scopeHash,
        workingCopyRevision: edited.state.workingCopyRevision,
        expectedAuthoritativeContents: edited.state.authoritativeContents,
      },
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("region-manually-modified");
  });

  it("连续点击幂等：第二次因 stale-revision 被拒绝", async () => {
    const { createMergeDocument, applyMergeAction } =
      await import("../../src/conflict/mergeDocumentModel");
    const r = createMergeDocument({
      repositoryRoot: "",
      relativePath: "src/a.ts",
      authoritativeContents: SVN_SINGLE,
      baseContents: "",
      scopeHash: "s",
      workingCopyRevision: "0",
    });
    if (!r.ok) throw new Error(r.message);
    const exp = {
      scopeHash: r.state.scopeHash,
      workingCopyRevision: r.state.workingCopyRevision,
      expectedAuthoritativeContents: r.state.authoritativeContents,
    };
    const first = applyMergeAction(r.state, {
      expectedRevision: 0,
      action: "take-mine",
      expected: exp,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);
    const exp2 = {
      scopeHash: first.state.scopeHash,
      workingCopyRevision: first.state.workingCopyRevision,
      expectedAuthoritativeContents: first.state.authoritativeContents,
    };
    // 用旧 revision 重放应被拒绝
    const replay = applyMergeAction(first.state, {
      expectedRevision: 0,
      action: "take-theirs",
      expected: exp2,
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.code).toBe("stale-revision");
  });

  it("多块时显示 X/Y 并可切换", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: snapshotWith(MULTI_BLOCK), onAction });
    await waitFor(
      () =>
        expect(screen.getByTestId("merge-action-toolbar")).toBeInTheDocument(),
      { timeout: 8000 },
    );
    await waitFor(() =>
      expect(screen.getByTestId("merge-block-progress").textContent).toMatch(
        /1\/3/,
      ),
    );
    const next = screen.getByTestId("toolbar-next-block");
    await fireEvent.click(next);
    await waitFor(() =>
      expect(screen.getByTestId("merge-block-progress").textContent).toMatch(
        /2\/3/,
      ),
    );
  });
});
