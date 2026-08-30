import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMergeDocument } from "../../src/conflict/mergeDocumentModel";
import { SVN_SINGLE } from "../../src/conflict/fixtures";

// Pierre File mock
const fileMocks = vi.hoisted(() => ({
  instances: [] as Array<{ cleanedUp: boolean; options: unknown }>,
  failRender: null as Error | null,
  renderCalls: [] as unknown[],
}));

vi.mock("@pierre/diffs", () => {
  class FakeFile {
    cleanedUp = false;
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      fileMocks.instances.push(
        this as unknown as { cleanedUp: boolean; options: unknown },
      );
    }
    render(props: Record<string, unknown>): void {
      if (fileMocks.failRender) throw fileMocks.failRender;
      fileMocks.renderCalls.push(props);
      const container = props.containerWrapper as HTMLElement;
      // 创建 diffs-container 以触发 shadowRoot 观察路径（jsdom 支持 attachShadow）
      const el = document.createElement("div");
      // 模拟 Pierre 产生的 diffs-container 元素
      const diffsEl = document.createElement(
        "diffs-container" as unknown as string,
      );
      try {
        (
          diffsEl as unknown as { attachShadow: (o: unknown) => ShadowRoot }
        ).attachShadow({
          mode: "open",
        });
      } catch {
        /* jsdom attachShadow 防御 */
      }
      container.appendChild(diffsEl);
      container.appendChild(el);
    }
    cleanUp(): void {
      this.cleanedUp = true;
    }
  }
  return { File: FakeFile };
});

const editorMocks = vi.hoisted(() => ({
  instances: [] as Array<{ cleanedUp: boolean }>,
  applied: [] as unknown[][],
  focused: [] as number[],
  detachCalls: 0,
  cleanUpCalls: 0,
  failEdit: null as Error | null,
  capturedOnChange: null as (() => void) | null,
  // 供测试直接操控的 Editor 实例引用
  currentEditor: null as unknown as {
    _text: string;
    _undoStack: string[];
    _redoStack: string[];
    _state: unknown;
    _onChange: () => void;
  } | null,
}));

vi.mock("@pierre/diffs/edit", () => {
  class FakeEditor {
    _text = "";
    _undoStack: string[] = [];
    _redoStack: string[] = [];
    _state: unknown = { cursor: 0 };
    _onChange: () => void;
    constructor(options: Record<string, unknown>) {
      const onChange = (options as { onChange: () => void }).onChange;
      this._onChange = onChange;
      editorMocks.capturedOnChange = onChange;
      // 初始文本由文件内容决定，测试中通过设置 _text 模拟
      editorMocks.currentEditor =
        this as unknown as typeof editorMocks.currentEditor;
      editorMocks.instances.push(this as unknown as { cleanedUp: boolean });
    }
    edit(_file: unknown): () => void {
      void _file;
      if (editorMocks.failEdit) throw editorMocks.failEdit;
      // 模拟编辑器附加后文本为初始 draft（由外部设置）
      return () => {
        editorMocks.detachCalls += 1;
      };
    }
    getText(): string {
      return this._text;
    }
    focus(options?: { lineNumber?: number }): void {
      editorMocks.focused.push(options?.lineNumber ?? 0);
    }
    applyEdits(edits: unknown[]): void {
      editorMocks.applied.push(edits);
      // 压栈实现 undo/redo
      this._undoStack.push(this._text);
      this._redoStack.length = 0;
      // 简单应用：把所有 newText 拼接到文本末尾以模拟文本变化（仅为测试可观测）
      // 实际内容不影响本单测的转换正确性断言，转换正确性由 edtis 的 range 断言覆盖
      const combined = (edits as Array<{ newText: string }>)
        .map((e) => e.newText)
        .join("");
      if (combined) this._text = this._text + combined;
      // 触发 onChange 以覆盖 onDraftChange 路径（真实 Pierre 也会触发）
      try {
        this._onChange?.();
      } catch {
        /* onChange 防御 */
      }
    }
    canUndo(): boolean {
      return this._undoStack.length > 0;
    }
    canRedo(): boolean {
      return this._redoStack.length > 0;
    }
    undo(): void {
      if (this._undoStack.length === 0) return;
      this._redoStack.push(this._text);
      this._text = this._undoStack.pop() as string;
      try {
        this._onChange?.();
      } catch {
        /* undo onChange 防御 */
      }
    }
    redo(): void {
      if (this._redoStack.length === 0) return;
      this._undoStack.push(this._text);
      this._text = this._redoStack.pop() as string;
      try {
        this._onChange?.();
      } catch {
        /* redo onChange 防御 */
      }
    }
    getState(): unknown {
      return this._state;
    }
    setState(state: unknown): void {
      this._state = state;
    }
    cleanUp(): void {
      editorMocks.cleanUpCalls += 1;
    }
  }
  return { Editor: FakeEditor };
});

import {
  mountConflictResultEditor,
  offsetToPosition,
  positionToOffset,
  toPierreEdits,
} from "../../src/webview/features/conflicts/conflictResultEditorAdapter";

const REPO = "/repo/svn-workbench";
const PATH = "src/order.ts";
const SCOPE = "scope-v012b1";
const REV = "r128";

function createState(text: string = SVN_SINGLE) {
  const result = createMergeDocument({
    repositoryRoot: REPO,
    relativePath: PATH,
    authoritativeContents: text,
    baseContents: "base",
    scopeHash: SCOPE,
    workingCopyRevision: REV,
  });
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

beforeEach(() => {
  fileMocks.instances.length = 0;
  fileMocks.renderCalls.length = 0;
  fileMocks.failRender = null;
  editorMocks.instances.length = 0;
  editorMocks.applied.length = 0;
  editorMocks.focused.length = 0;
  editorMocks.detachCalls = 0;
  editorMocks.cleanUpCalls = 0;
  editorMocks.failEdit = null;
  editorMocks.capturedOnChange = null;
  editorMocks.currentEditor = null;
});

describe("conflictResultEditorAdapter 纯适配层（V012-B1）", () => {
  it("attach/cleanup 无泄漏：dispose 完整链且幂等", () => {
    const container = document.createElement("div");
    const state = createState();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      language: "typescript",
      getMergeState: () => state,
      onError: vi.fn(),
    });
    expect(handle).toBeDefined();
    expect(container.childElementCount).toBeGreaterThan(0);
    const fileInst = fileMocks.instances[0] as unknown as {
      cleanedUp: boolean;
    };
    expect(fileInst.cleanedUp).toBe(false);
    handle?.dispose();
    expect(fileInst.cleanedUp).toBe(true);
    expect(editorMocks.cleanUpCalls).toBe(1);
    expect(editorMocks.detachCalls).toBe(1);
    expect(container.childElementCount).toBe(0);
    // 幂等
    handle?.dispose();
    expect(editorMocks.cleanUpCalls).toBe(1);
    expect(editorMocks.detachCalls).toBe(1);
  });

  it("undo/redo：applyRegionEdit 后可撤销重做", async () => {
    const container = document.createElement("div");
    const state = createState();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    const api = handle!.getApi();
    // 初始不可撤销
    expect(api.canUndo()).toBe(false);
    expect(api.canRedo()).toBe(false);
    // 写入初始文本到模拟编辑器
    if (editorMocks.currentEditor)
      editorMocks.currentEditor._text = state.draftContents;
    api.applyRegionEdit([{ start: 0, end: 0, newText: "// 新增行\n" }]);
    expect(api.canUndo()).toBe(true);
    const afterEdit = api.getText();
    api.undo();
    expect(api.getText()).not.toBe(afterEdit);
    expect(api.canRedo()).toBe(true);
    api.redo();
    expect(api.getText()).toBe(afterEdit);
  });

  it("applyRegionEdit 进 undo 栈：偏移正确转为行列 Range", () => {
    const container = document.createElement("div");
    const state = createState();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    const api = handle!.getApi();
    if (editorMocks.currentEditor)
      editorMocks.currentEditor._text = state.draftContents;
    // 取中间偏移做编辑
    const editStart = state.draftContents.indexOf("const mineValue");
    const editEnd = editStart + 5;
    api.applyRegionEdit([
      { start: editStart, end: editEnd, newText: "REPLACED" },
    ]);
    expect(editorMocks.applied).toHaveLength(1);
    const pierreEdits = editorMocks.applied[0] as Array<{
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      newText: string;
    }>;
    expect(pierreEdits[0]!.newText).toBe("REPLACED");
    const expectedStart = offsetToPosition(state.draftContents, editStart);
    const expectedEnd = offsetToPosition(state.draftContents, editEnd);
    expect(pierreEdits[0]!.range.start).toEqual(expectedStart);
    expect(pierreEdits[0]!.range.end).toEqual(expectedEnd);
    expect(api.canUndo()).toBe(true);
  });

  it("getState/setState 往返", () => {
    const container = document.createElement("div");
    const state = createState();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    const api = handle!.getApi();
    const s = { selection: { line: 3 }, extra: "hold" };
    api.setState(s);
    expect(api.getState()).toEqual(s);
  });

  it("composition 期间快捷键屏蔽：Enter/Escape/Ctrl+S 被阻止，结束后放行", () => {
    const container = document.createElement("div");
    const state = createState();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    const api = handle!.getApi();
    expect(api.isComposing()).toBe(false);
    container.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    expect(api.isComposing()).toBe(true);

    const enterEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    const preventedEnter = !container.dispatchEvent(enterEvent);
    expect(enterEvent.defaultPrevented || preventedEnter).toBe(true);

    const saveEvent = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventedSave = !container.dispatchEvent(saveEvent);
    expect(saveEvent.defaultPrevented || preventedSave).toBe(true);

    const escEvent = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    const preventedEsc = !container.dispatchEvent(escEvent);
    expect(escEvent.defaultPrevented || preventedEsc).toBe(true);

    container.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
    expect(api.isComposing()).toBe(false);
    const enterEvent2 = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(enterEvent2);
    expect(enterEvent2.defaultPrevented).toBe(false);
  });

  it("重复 mount 无双实例：第二次挂载先 dispose 第一次", () => {
    const container = document.createElement("div");
    const state = createState();
    const h1 = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    expect(h1).toBeDefined();
    const firstFile = fileMocks.instances[0] as unknown as {
      cleanedUp: boolean;
    };
    expect(firstFile.cleanedUp).toBe(false);
    const h2 = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError: vi.fn(),
    });
    expect(h2).toBeDefined();
    expect(firstFile.cleanedUp).toBe(true);
    // 容器内不应残留两份
    expect(container.querySelectorAll("diffs-container").length).toBe(1);
    // 旧句柄再次 dispose 幂等
    h1?.dispose();
    expect(container.querySelectorAll("diffs-container").length).toBe(1);
  });

  it("attach 失败保留文本并上报结构化错误", () => {
    editorMocks.failEdit = new Error("模拟 attach 失败");
    const container = document.createElement("div");
    const state = createState();
    const onError = vi.fn();
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onError,
    });
    expect(handle).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].kind).toBe("editor-attach-failed");
    // 保留文本
    expect(container.textContent).toContain("<<<<<<<");
    expect(container.textContent).toContain("我的修改-本地");
  });

  it("onChange 全量比对：文本变化时 debounce 调 onDraftChange", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    let state = createState();
    const onDraftChange = vi.fn((text: string, rev: number) => {
      // 模拟上层接收后更新 state（但 getMergeState 仍返回旧 revision 直到下一次编辑）
      state = {
        ...state,
        draftContents: text,
        draftRevision: rev,
      } as typeof state;
    });
    const handle = mountConflictResultEditor(container, {
      relativePath: PATH,
      getMergeState: () => state,
      onDraftChange,
      onError: vi.fn(),
    });
    expect(handle).toBeDefined();
    const editor = editorMocks.currentEditor!;
    editor._text = state.draftContents;
    // 模拟用户全量输入
    const newText = state.draftContents + "\n// 用户追加行\n";
    editor._text = newText;
    editorMocks.capturedOnChange?.();
    // debounce 尚未触发
    expect(onDraftChange).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60);
    expect(onDraftChange).toHaveBeenCalledOnce();
    expect(onDraftChange.mock.calls[0][0]).toBe(newText);
    expect(onDraftChange.mock.calls[0][1]).toBe(1);
    vi.useRealTimers();
  });

  it("offset↔Range 转换：基于 \\n 累计，覆盖首行末行与空文本", () => {
    expect(offsetToPosition("", 0)).toEqual({ line: 0, character: 0 });
    const text = "a\nbc\ndef";
    // 偏移 0 -> 行0 列0
    expect(offsetToPosition(text, 0)).toEqual({ line: 0, character: 0 });
    // 偏移 2 -> 'b' 所在行1 列0
    expect(offsetToPosition(text, 2)).toEqual({ line: 1, character: 0 });
    // 往返
    for (const off of [0, 1, 2, 4, 7]) {
      const pos = offsetToPosition(text, off);
      expect(positionToOffset(text, pos)).toBe(off);
    }
    // toPierreEdits 批量
    const edits = toPierreEdits(text, [{ start: 2, end: 5, newText: "X" }]);
    expect(edits[0]!.range.start).toEqual(offsetToPosition(text, 2));
    expect(edits[0]!.range.end).toEqual(offsetToPosition(text, 5));
  });
});
