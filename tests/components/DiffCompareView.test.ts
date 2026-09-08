import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V020-R09：三类 Diff 比较的标题与动作对照（jsdom + pierre mock）。
 * pierre 挂载细节沿用 DiffModule.test.ts 的 mock 策略；本文件只断言
 * 标题/基线文案与路径操作按钮的有无（平台无关的角色/名称查询）。
 */
interface FakeRenderRecord {
  options: Record<string, unknown>;
  props: Record<string, unknown>;
}

const pierreMocks = vi.hoisted(() => {
  const records: FakeRenderRecord[] = [];
  const state = {
    failRender: null as Error | null,
    instanceCount: 0,
    cleanupCount: 0,
    revealCalls: [] as number[],
    failPreload: false,
  };
  return { records, state };
});

vi.mock("@pierre/diffs", () => {
  class FakeFileDiff {
    readonly options: Record<string, unknown>;
    cleanedUp = false;
    constructor(options: Record<string, unknown>) {
      pierreMocks.state.instanceCount += 1;
      this.options = options;
    }
    render(props: Record<string, unknown>): boolean {
      if (pierreMocks.state.failRender !== null) {
        throw pierreMocks.state.failRender;
      }
      pierreMocks.records.push({ options: this.options, props });
      const container = props.containerWrapper as HTMLElement;
      const marker = document.createElement("div");
      marker.className = "fake-pierre-diff";
      container.appendChild(marker);
      return true;
    }
    revealLine(lineNumber: number): boolean {
      pierreMocks.state.revealCalls.push(lineNumber);
      return true;
    }
    cleanUp(): void {
      this.cleanedUp = true;
      pierreMocks.state.cleanupCount += 1;
    }
  }
  return {
    FileDiff: FakeFileDiff,
    parsePatchFiles: (text: string) =>
      text.includes("Index:")
        ? [{ files: [{ name: "src/extension.ts" }] }]
        : [],
    preloadHighlighter: () => Promise.resolve(),
  };
});

const editMock = vi.hoisted(() => {
  const instances: Array<unknown> = [];
  const state = { text: "", onChangeCalls: 0, focusLine: 0 };
  return { state, instances };
});

vi.mock("@pierre/diffs/edit", () => {
  class FakeEditor {
    readonly options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      editMock.instances.push(this);
    }
    edit(): () => void {
      return () => undefined;
    }
    cleanUp(): void {
      /* no-op */
    }
    getText(): string {
      return editMock.state.text;
    }
    focus(options?: { lineNumber?: number }): void {
      editMock.state.focusLine = options?.lineNumber ?? 0;
    }
  }
  return { Editor: FakeEditor };
});

import DiffModule from "../../src/webview/features/diff/DiffModule.svelte";

const svnPatch = `Index: src/extension.ts
===================================================================
--- src/extension.ts\t(revision 41)
+++ src/extension.ts\t(revision 42)
@@ -1 +1 @@
-old
+new
`;

const workingSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src/extension.ts",
  compare: {
    kind: "working-copy",
    title: "src/extension.ts",
    targetPath: "src/extension.ts",
    leftRevision: "BASE",
    rightRevision: "工作副本",
  },
  original: "const a = 1;\n",
  modified: "const a = 2;\n",
  language: "typescript",
  truncated: false,
  binary: false,
  edit: { supported: true, targetId: "target-1" },
};

const revisionFileSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src/extension.ts",
  compare: {
    kind: "revision-file",
    title: "r41 → r42 · src/extension.ts",
    targetPath: "src/extension.ts",
    leftRevision: "41",
    rightRevision: "42",
  },
  original: "",
  modified: svnPatch,
  language: "diff",
  truncated: false,
  binary: false,
  edit: {
    supported: false,
    reason: "修订比较为双侧只读，不支持页内编辑；请从工作副本打开差异后编辑。",
  },
};

const revisionPatchSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src, docs · r41 → r42",
  compare: {
    kind: "revision-patch",
    title: "修订比较 r41 → r42 · 2 个路径",
    leftRevision: "41",
    rightRevision: "42",
    pathCount: 2,
  },
  original: "",
  modified: svnPatch,
  language: "diff",
  truncated: false,
  binary: false,
  edit: {
    supported: false,
    reason: "修订比较为双侧只读，不支持页内编辑；请从工作副本打开差异后编辑。",
  },
};

beforeEach(() => {
  pierreMocks.records.length = 0;
  pierreMocks.state.failRender = null;
  pierreMocks.state.instanceCount = 0;
  pierreMocks.state.cleanupCount = 0;
  pierreMocks.state.revealCalls.length = 0;
  pierreMocks.state.failPreload = false;
  editMock.instances.length = 0;
});

describe("V020-R09 三类比较标题与动作对照", () => {
  it("本地比较显示 BASE 基线并在更多菜单提供全部本地动作", async () => {
    render(DiffModule, { snapshot: workingSnapshot, onAction: vi.fn() });

    expect(screen.getByText("src/extension.ts")).toBeVisible();
    expect(screen.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
    // V022-R35：低频出口收进更多菜单，常驻区不再平铺。
    expect(screen.queryByRole("menuitem", { name: "提交此文件" })).toBeNull();
    await fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(
      screen.getByRole("menuitem", { name: "在编辑器中对比" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "在编辑器中打开" }),
    ).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "提交此文件" })).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /返回本地修改/ }),
    ).toBeVisible();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.getByRole("button", { name: "复制路径 src/extension.ts" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "查看 src/extension.ts 路径详情" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "页内编辑" })).toBeVisible();
  });

  it("单文件历史比较显示修订基线且隐藏提交/编辑/本地路径操作", () => {
    render(DiffModule, {
      snapshot: revisionFileSnapshot,
      onAction: vi.fn(),
    });

    expect(screen.getByText("r41 → r42 · src/extension.ts")).toBeVisible();
    expect(screen.getByText("r41 → r42（只读）")).toBeVisible();
    // 只读原因如实说明。
    expect(screen.getByText(/双侧只读/)).toBeVisible();
    // 本地文件动作全部隐藏。
    expect(screen.queryByRole("button", { name: "页内编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中对比" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中打开" })).toBeNull();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "查看 src/extension.ts 路径详情" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: "在仓库浏览器中显示 src/extension.ts",
      }),
    ).toBeNull();
    // 真实单文件身份允许复制路径。
    expect(
      screen.getByRole("button", { name: "复制路径 src/extension.ts" }),
    ).toBeVisible();
  });

  it("范围 Patch 更多菜单只保留返回，不渲染任何路径操作", async () => {
    render(DiffModule, {
      snapshot: revisionPatchSnapshot,
      onAction: vi.fn(),
    });

    expect(screen.getByText("修订比较 r41 → r42 · 2 个路径")).toBeVisible();
    expect(screen.getByText("r41 → r42（只读）")).toBeVisible();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中打开" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中对比" })).toBeNull();
    expect(screen.queryByRole("button", { name: "页内编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: /复制路径/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /路径详情/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /仓库浏览器/ })).toBeNull();
    // 返回入口保留在更多菜单内；本地文件动作不进菜单。
    await fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menuitem", { name: "提交此文件" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "在编辑器中打开" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "在编辑器中对比" }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: /返回本地修改/ }),
    ).toBeVisible();
  });

  it("空修订比较显示空态且不产生路径操作", () => {
    render(DiffModule, {
      snapshot: {
        ...revisionFileSnapshot,
        modified: "",
        message: "修订比较 r41 → r42",
      },
      onAction: vi.fn(),
    });

    expect(screen.getByText("所选修订之间没有文本差异。")).toBeVisible();
    expect(screen.queryByRole("button", { name: /复制路径/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
  });

  it("截断的历史比较不提供路径复制", () => {
    render(DiffModule, {
      snapshot: {
        ...revisionFileSnapshot,
        truncated: true,
        message: "修订比较 r41 → r42（超过 5 MB，已截断）",
      },
      onAction: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: /复制路径/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
  });

  it("二进制历史比较显示二进制空态且无本地动作", () => {
    render(DiffModule, {
      snapshot: {
        ...revisionFileSnapshot,
        binary: true,
        original: "",
        modified: "",
      },
      onAction: vi.fn(),
    });

    expect(screen.getByText("二进制文件无法进行文本对比")).toBeVisible();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中打开" })).toBeNull();
  });

  it("无 compare 的旧 patch 快照保守按只读处理", () => {
    render(DiffModule, {
      snapshot: {
        kind: "diff",
        relativePath: ". · r41 → r42",
        original: "",
        modified: svnPatch,
        language: "diff",
        truncated: false,
        binary: false,
        message: "修订比较 r41 → r42",
      },
      onAction: vi.fn(),
    });

    expect(screen.getByText("历史修订比较（只读）")).toBeVisible();
    expect(screen.queryByRole("button", { name: "提交此文件" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中打开" })).toBeNull();
    expect(screen.queryByRole("button", { name: /复制路径/ })).toBeNull();
  });

  it("重复打开同一目标不重建差异实例（阅读位置保持）", async () => {
    const { rerender } = render(DiffModule, {
      snapshot: workingSnapshot,
      onAction: vi.fn(),
    });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    const instances = pierreMocks.state.instanceCount;
    // 同一快照对象重复渲染（同目标 reveal）不重建实例。
    await rerender({ snapshot: workingSnapshot, onAction: vi.fn() });
    expect(pierreMocks.state.instanceCount).toBe(instances);
  });
});
