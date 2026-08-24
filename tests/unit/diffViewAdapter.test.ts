import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v0.1.0（V010-C）diffViewAdapter 单一生命周期单元测试。
 *
 * jsdom 无法构造真实 @pierre/diffs 组件，此处以 vi.mock 替换，
 * 验证实例创建、observer 注册、Editor attach/detach、cleanup 幂等
 * 与结构化错误分类；真实浏览器行为由 tests/webview-e2e 覆盖。
 */

const pierreMocks = vi.hoisted(() => ({
  records: [] as Array<Record<string, unknown>>,
  instances: [] as Array<{ cleanedUp: boolean }>,
  revealCalls: [] as number[],
  failRender: null as Error | null,
}));

vi.mock("@pierre/diffs", () => {
  class FakeFileDiff {
    cleanedUp = false;
    constructor(readonly options: Record<string, unknown>) {}
    render(props: Record<string, unknown>): boolean {
      if (pierreMocks.failRender !== null) throw pierreMocks.failRender;
      pierreMocks.records.push(props);
      pierreMocks.instances.push(this as { cleanedUp: boolean });
      const container = props.containerWrapper as HTMLElement;
      container.appendChild(document.createElement("div"));
      return true;
    }
    revealLine(lineNumber: number): boolean {
      pierreMocks.revealCalls.push(lineNumber);
      return true;
    }
    cleanUp(): void {
      this.cleanedUp = true;
    }
  }
  return {
    FileDiff: FakeFileDiff,
    parsePatchFiles: (text: string) =>
      text.includes("Index:") ? [{ files: [{ name: "src/a.ts" }] }] : [],
    preloadHighlighter: () => Promise.resolve(),
  };
});

const editMocks = vi.hoisted(() => ({
  text: "",
  detachCalls: 0,
  cleanUpCalls: 0,
  applied: [] as unknown[],
  focused: [] as number[],
  failEdit: null as Error | null,
}));

vi.mock("@pierre/diffs/edit", () => {
  class FakeEditor {
    constructor(readonly options: Record<string, unknown>) {}
    edit(): () => void {
      if (editMocks.failEdit !== null) throw editMocks.failEdit;
      return () => {
        editMocks.detachCalls += 1;
      };
    }
    getText(): string {
      return editMocks.text;
    }
    focus(options?: { lineNumber?: number }): void {
      editMocks.focused.push(options?.lineNumber ?? 0);
    }
    applyEdits(edits: unknown[]): void {
      editMocks.applied.push(edits);
    }
    cleanUp(): void {
      editMocks.cleanUpCalls += 1;
    }
  }
  return { Editor: FakeEditor };
});

import { mountDiffView } from "../../src/webview/features/diff/diffViewAdapter";

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    relativePath: "src/a.ts",
    language: "typescript" as const,
    oldContents: "const a = 1;\n",
    newContents: "const a = 2;\n",
    patch: undefined,
    diffStyle: "split" as const,
    expandUnchanged: false,
    editMode: false,
    ...overrides,
  };
}

beforeEach(() => {
  pierreMocks.records.length = 0;
  pierreMocks.instances.length = 0;
  pierreMocks.revealCalls.length = 0;
  pierreMocks.failRender = null;
  editMocks.detachCalls = 0;
  editMocks.cleanUpCalls = 0;
  editMocks.applied.length = 0;
  editMocks.focused.length = 0;
  editMocks.failEdit = null;
});

describe("mountDiffView（v0.1.0 V010-C 单一生命周期）", () => {
  it("只读全文挂载：onReady 暴露 API，focusLine 走 FileDiff.revealLine", () => {
    const container = document.createElement("div");
    const onReady = vi.fn();
    const handle = mountDiffView(container, baseInput(), {
      onReady,
      onError: vi.fn(),
    });
    expect(handle).toBeDefined();
    expect(pierreMocks.records).toHaveLength(1);
    const api = onReady.mock.calls[0][0];
    api.focusLine(12);
    expect(pierreMocks.revealCalls).toEqual([12]);
    expect(editMocks.focused).toEqual([]);
  });

  it("编辑态挂载：Editor attach 生效，dispose 依次 detach、cleanUp 并清空容器", () => {
    const container = document.createElement("div");
    const onEditChange = vi.fn();
    const onReady = vi.fn();
    const handle = mountDiffView(container, baseInput({ editMode: true }), {
      onEditChange,
      onReady,
      onError: vi.fn(),
    });
    expect(handle).toBeDefined();
    expect(container.childElementCount).toBe(1);

    const api = onReady.mock.calls[0][0];
    editMocks.text = "编辑后文本";
    api.focusLine(3);
    expect(editMocks.focused).toEqual([3]);
    api.applyRegionEdit(2, 4, "替换文本");
    expect(editMocks.applied).toHaveLength(1);

    handle?.dispose();
    expect(editMocks.detachCalls).toBe(1);
    expect(editMocks.cleanUpCalls).toBe(1);
    expect(pierreMocks.instances[0].cleanedUp).toBe(true);
    expect(container.childElementCount).toBe(0);
    // 幂等：重复 dispose 不重复清理。
    handle?.dispose();
    expect(editMocks.detachCalls).toBe(1);
    expect(editMocks.cleanUpCalls).toBe(1);
  });

  it("patch 为空解析：结构化 patch-parse-empty 错误且不残留半挂载", () => {
    const container = document.createElement("div");
    const onError = vi.fn();
    const handle = mountDiffView(
      container,
      baseInput({ patch: "无合法内容" }),
      { onError },
    );
    expect(handle).toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].kind).toBe("patch-parse-empty");
    expect(container.childElementCount).toBe(0);
  });

  it("patch 直渲成功：按文件逐个挂载并保留文件头", () => {
    const container = document.createElement("div");
    const onReady = vi.fn();
    const handle = mountDiffView(
      container,
      baseInput({ patch: "Index: src/a.ts\n@@ -1 +1 @@" }),
      { onReady, onError: vi.fn() },
    );
    expect(handle).toBeDefined();
    expect(pierreMocks.records[0].fileDiff).toMatchObject({
      name: "src/a.ts",
    });
    // patch 模式 focusLine 遍历实例 revealLine。
    onReady.mock.calls[0][0].focusLine(5);
    expect(pierreMocks.revealCalls).toEqual([5]);
  });

  it("渲染异常：分类为 pierre-mount-failed，完整 dispose 后上报", () => {
    pierreMocks.failRender = new Error("模拟渲染失败");
    const container = document.createElement("div");
    const onError = vi.fn();
    const handle = mountDiffView(container, baseInput(), { onError });
    expect(handle).toBeUndefined();
    expect(onError.mock.calls[0][0].kind).toBe("pierre-mount-failed");
    expect(container.childElementCount).toBe(0);
  });

  it("Editor attach 失败：分类为 editor-attach-failed 且不残留实例", () => {
    editMocks.failEdit = new Error("模拟 attach 失败");
    const container = document.createElement("div");
    const onError = vi.fn();
    const handle = mountDiffView(container, baseInput({ editMode: true }), {
      onError,
    });
    expect(handle).toBeUndefined();
    expect(onError.mock.calls[0][0].kind).toBe("editor-attach-failed");
    expect(pierreMocks.instances[0].cleanedUp).toBe(true);
    expect(container.childElementCount).toBe(0);
  });
});
