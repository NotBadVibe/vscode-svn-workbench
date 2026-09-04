/* eslint-disable @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import DiffModule from "../../src/webview/features/diff/DiffModule.svelte";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import FeatureRouter from "../../src/webview/app/FeatureRouter.svelte";
import MergeActionToolbar from "../../src/webview/features/conflicts/MergeActionToolbar.svelte";
import ShortcutHelp from "../../src/webview/components/help/ShortcutHelp.svelte";
import OperationIntentDialog from "../../src/webview/components/operation/OperationIntentDialog.svelte";
import type {
  ChangesSnapshot,
  ConflictSnapshot,
  DiffSnapshot,
  OperationIntentView,
} from "../../src/protocol/workbenchProtocol";
import { isImeComposing as canonicalIme } from "../../src/webview/keyboard/ime";
import { isImeComposing as compatIme } from "../../src/webview/i18n/keyboard";
import { isImeComposingEvent as aliasIme } from "../../src/webview/features/conflicts/conflictShortcuts";

/*
 * V017-C · IME 与焦点往返（A2 焦点图缺口 T1-T6）。
 * - 平台无关断言；dialog 用 querySelector + waitFor(open)。
 * - T1 用 ConflictDiffView 测试桩（上报固定块进度 + 真实聚焦），
 *   使“抢焦点/首块聚焦”在 jsdom 可断言。
 */

vi.mock("@pierre/diffs", () => ({
  UnresolvedFile: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
  FileDiff: class {
    constructor(_options: unknown) {}
    render(props: Record<string, unknown>) {
      const container = props.containerWrapper as HTMLElement;
      const marker = document.createElement("div");
      marker.className = "fake-pierre-diff";
      container.appendChild(marker);
      return true;
    }
    revealLine() {
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
  parsePatchFiles: () => [],
  preloadHighlighter: () => Promise.resolve(),
}));
vi.mock("@pierre/diffs/edit", () => ({
  Editor: class {
    constructor(_opts: unknown) {}
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
// 中文注释：T1 桩——上报 total=2 的块进度，focusConflict 真实聚焦桩按钮。
vi.mock(
  "../../src/webview/features/conflicts/ConflictDiffView.svelte",
  () => import("./harness/ConflictDiffViewFocusStub.svelte"),
);

function conflictSnapshot(token: string, selected: string): ConflictSnapshot {
  return {
    kind: "conflicts",
    conflicts: [
      { relativePath: "src/a.ts", type: "text" },
      { relativePath: "src/b.ts", type: "text" },
    ],
    selected: {
      relativePath: selected,
      contents: {
        working: { content: "merged", truncated: false },
      },
      mergeEditor: { token, editable: true, issues: [] },
    },
  };
}

describe("T1 首块聚焦事件驱动", () => {
  it("后台 token 轮换不抢正在输入的焦点", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ConflictsModule, {
      snapshot: conflictSnapshot("edit-1", "src/a.ts"),
      onAction,
    });
    const stub = await screen.findByTestId("conflict-diff-focus-stub");
    // 初始打开（用户显式进入任务）聚焦首块。
    await waitFor(() => expect(document.activeElement).toBe(stub));
    // 用户正在筛选输入。
    const search = screen.getByRole("textbox", { name: "筛选冲突文件" });
    search.focus();
    expect(document.activeElement).toBe(search);
    // Host 后台刷新：同文件、token 轮换。
    await rerender({
      snapshot: conflictSnapshot("edit-2", "src/a.ts"),
      onAction,
    });
    await tick();
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it("用户显式选择文件后新快照到达聚焦首块", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ConflictsModule, {
      snapshot: conflictSnapshot("edit-1", "src/a.ts"),
      onAction,
    });
    await screen.findByTestId("conflict-diff-focus-stub");
    // 中文注释：行按钮 accessible name 含类型后缀，用 strong 路径精确定位行按钮。
    const rowB = screen
      .getAllByRole("button")
      .find(
        (button) => button.querySelector("strong")?.textContent === "src/b.ts",
      ) as HTMLElement;
    expect(rowB).toBeInTheDocument();
    await fireEvent.click(rowB);
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "src/b.ts",
    });
    // 新快照到达前不提前聚焦旧视图（武装路径未匹配）。
    const search = screen.getByRole("textbox", { name: "筛选冲突文件" });
    search.focus();
    expect(document.activeElement).toBe(search);
    await rerender({
      snapshot: conflictSnapshot("edit-3", "src/b.ts"),
      onAction,
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("conflict-diff-focus-stub"),
      ),
    );
  });
});

const editSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src/extension.ts",
  original: "const a = 1;\n",
  modified: "const a = 2;\nconst b = 3;\n",
  language: "typescript",
  truncated: false,
  binary: false,
  edit: { supported: true, targetId: "mock-target" },
};
const editSessionPayload = {
  targetId: "mock-target",
  editToken: "mock-token",
  draftRevision: 1,
  baseHash: "base",
  baseRevision: "BASE",
  rawHash: "raw",
  baseContents: "const a = 1;\n",
  message: "已进入页内编辑。",
};

describe("T2 Diff 目标切换假模态焦点往返", () => {
  it("打开记录触发点 + 背景 inert，关闭返回触发点", async () => {
    const action = vi.fn();
    const { rerender } = render(DiffModule, {
      snapshot: editSnapshot,
      onAction: action,
      editSession: { ...editSessionPayload },
    });
    await screen.findByText("正在编辑工作副本");
    const trigger = screen.getByRole("button", { name: "显示设置" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
    // 脏草稿 + 切换请求 → 三选一假模态打开。
    await rerender({
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: {
        currentTargetId: "mock-target",
        nextRelativePath: "src/other.ts",
      },
    });
    const dialog = screen.getByRole("dialog", {
      name: "当前文件有未保存的草稿",
    });
    expect(dialog).toBeInTheDocument();
    // 焦点进入主操作。
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("保存并打开新文件"),
    );
    // 背景兄弟容器加 inert（对话框自身除外）。
    const section = dialog.closest("section.diff-feature") as HTMLElement;
    const background = Array.from(section.children).filter(
      (child) => !child.classList.contains("diff-switch-backdrop"),
    );
    expect(background.length).toBeGreaterThan(0);
    for (const child of background) {
      expect(child.hasAttribute("inert")).toBe(true);
    }
    // 留在当前文件 → 关闭 → 焦点返回触发点。
    await fireEvent.click(screen.getByRole("button", { name: "留在当前文件" }));
    expect(action).toHaveBeenCalledWith("diff/target-switch-decision", {
      decision: "stay",
      targetId: "mock-target",
    });
    await rerender({
      snapshot: { ...editSnapshot, draft: { revision: 3, updatedAt: 1 } },
      onAction: action,
      editSession: { ...editSessionPayload },
      targetSwitchRequest: undefined,
    });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // 关闭后背景 inert 清除。
    for (const child of Array.from(section.children)) {
      expect(child.hasAttribute("inert")).toBe(false);
    }
  });
});

const baseIntent: OperationIntentView = {
  token: "tok-1",
  kind: "commit",
  title: "提交 2 个文件",
  summary: "提交 2 个文件 · 范围：项目 A",
  paths: ["src/a.ts", "src/b.ts"],
  scopeHash: "s1",
  candidateHash: "c1",
  repositoryUuid: "r1",
  createdAt: new Date().toISOString(),
  canExecute: true,
  issues: [],
  commands: ["svn commit src/a.ts src/b.ts -F msg.txt"],
};

describe("T3 意向单 disabled 焦点回退", () => {
  it("stale/不可执行时焦点进入取消按钮而非 disabled 确认按钮", async () => {
    const { container } = render(OperationIntentDialog, {
      props: {
        intent: {
          ...baseIntent,
          stale: true,
          canExecute: false,
          issues: ["范围已变化，请重新预览。"],
        },
        open: true,
        confirmLabel: "确认提交（2）",
        recheckLabel: "重新检查",
        onRecheck: vi.fn(),
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        onAction: vi.fn(),
      },
    });
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    await waitFor(() => expect(dialog?.hasAttribute("open")).toBe(true));
    const confirm = screen.getByText("确认提交（2）（已失效）");
    expect(confirm).toBeDisabled();
    // 回退到首个可聚焦控件（取消），不在禁用按钮上静默失败。
    await waitFor(() =>
      expect(document.activeElement?.textContent).toContain("取消"),
    );
    expect(document.activeElement).not.toBe(confirm);
  });
});

const toolbarEditor = {
  getMergeState: () => undefined,
  syncMergeState: () => {},
  setActiveRegion: (_id: string | undefined) => {},
  applyRegionEdit: (
    _edits: { start: number; end: number; newText: string }[],
  ) => {},
  canUndo: () => false,
  canRedo: () => false,
  undo: () => {},
  redo: () => {},
  focusLine: (_line: number) => {},
  isComposing: () => false,
  getText: () => "",
};

describe("T4 工具栏帮助焦点返回", () => {
  it("独立内联帮助关闭后焦点返回工具栏 ? 按钮", async () => {
    render(MergeActionToolbar, { resultEditor: toolbarEditor });
    const helpButton = screen.getByTestId("toolbar-shortcut-help");
    await fireEvent.click(helpButton);
    await screen.findByTestId("shortcut-help");
    await fireEvent.click(screen.getByTestId("shortcut-help-close"));
    await waitFor(() => expect(document.activeElement).toBe(helpButton));
  });

  it("面板内按 ? 关闭同样返回触发按钮", async () => {
    render(ShortcutHelp, { region: "conflicts", open: true });
    const panel = await screen.findByTestId("shortcut-help-panel");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-testid")).toBe(
        "shortcut-help-close",
      ),
    );
    await fireEvent.keyDown(panel, { key: "?" });
    await waitFor(() =>
      expect(screen.queryByTestId("shortcut-help-panel")).toBeNull(),
    );
    const trigger = screen.getByTestId("shortcut-help-trigger");
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});

const fileKey = (relativePath: string) => `test-wc::${relativePath}`;
function changeFile(relativePath: string, status: string, selection: string) {
  return {
    relativePath,
    selectionKey: fileKey(relativePath) as never,
    status: status as never,
    selection: selection as never,
    reason: undefined,
  };
}
function changesSnapshot(
  files: ReturnType<typeof changeFile>[],
): ChangesSnapshot {
  const summary: Record<string, number> = {};
  for (const file of files) {
    summary[file.status] = (summary[file.status] ?? 0) + 1;
  }
  return {
    kind: "changes",
    commitDraft: "",
    files,
    summary,
    refreshedAt: "2026-08-14T10:00:00.000Z",
  };
}

describe("T5 阻止原因 Esc 返回绑定触发点", () => {
  it("Esc 关闭后焦点回到同一触发按钮", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/e.ts", "unversioned", "excluded"),
      ]),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText("选择 src/e.ts"));
    const view = screen.getByRole("button", {
      name: "查看阻止原因（1）",
    });
    await fireEvent.click(view);
    const panel = screen.getByRole("status", { name: "阻止提交原因" });
    await waitFor(() => expect(document.activeElement).toBe(panel));
    await fireEvent.keyDown(panel, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("status", { name: "阻止提交原因" })).toBeNull(),
    );
    // 绑定引用：回到点击的同一按钮，不依赖全局选择器。
    await waitFor(() => expect(document.activeElement).toBe(view));
  });
});

describe("T6 模块主区落点", () => {
  it("模块打开聚焦主区；同模块刷新不抢焦点；切换模块落新主区", async () => {
    const onAction = vi.fn();
    const base = {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
      ]),
      taskId: "changes/overview",
      onAction,
    };
    const { container, rerender } = render(FeatureRouter, base);
    // 等待异步模块加载完成，再断言主区落点。
    const search = await screen.findByLabelText("筛选变更文件");
    // 初次打开：焦点进入 Changes 主区（section tabindex=-1），不在 body。
    const changesSection = container.querySelector(
      "section.feature-layout",
    ) as HTMLElement;
    expect(changesSection?.getAttribute("tabindex")).toBe("-1");
    await waitFor(() => expect(document.activeElement).toBe(changesSection));
    // 同模块刷新：用户在搜索框输入，不抢焦点。
    search.focus();
    await rerender({
      ...base,
      snapshot: { ...base.snapshot, refreshedAt: "2026-08-14T11:00:00.000Z" },
    });
    await tick();
    await waitFor(() => expect(document.activeElement).toBe(search));
    // 切换模块：新模块挂载聚焦其主区，不掉到 body。
    await rerender({ ...base, snapshot: { ...editSnapshot } });
    await waitFor(() => {
      const diffSection = container.querySelector("section.diff-feature");
      expect(diffSection).not.toBeNull();
      expect(document.activeElement).toBe(diffSection);
    });
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("IME 统一守卫", () => {
  it("三处 isImeComposing 同一实现；229 即候选", () => {
    expect(compatIme).toBe(canonicalIme);
    expect(aliasIme).toBe(canonicalIme);
    expect(canonicalIme({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(canonicalIme({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(canonicalIme({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
