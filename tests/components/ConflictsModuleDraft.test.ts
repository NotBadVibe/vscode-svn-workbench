/* eslint-disable @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

// ConflictDiffView 的差异引擎在 jsdom 不可用；本文件聚焦草稿守卫，用 stub 避免触发 V011-E 降级警告。
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

const baseSnapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [
    { relativePath: "src/a.ts", type: "text" },
    { relativePath: "src/b.ts", type: "text" },
  ],
  selected: {
    relativePath: "src/a.ts",
    contents: {
      working: {
        content: "<<<<<<< .mine\nlocal\n=======\nremote\n>>>>>>> .r5\n",
        truncated: false,
      },
      mine: { content: "mine", truncated: false },
      theirs: { content: "theirs", truncated: false },
    },
    mergeEditor: {
      token: "edit-1",
      editable: true,
      issues: [],
      feedback: "保存失败：模拟失败；草稿已保留",
    },
    draft: {
      content:
        "<<<<<<< .mine\nedited mine\n=======\nedited remote\n>>>>>>> .r5\n",
      revision: 2,
      updatedAt: Date.now(),
      hasDraft: true,
      dirty: true,
    },
  },
  progress: { initialCount: 2, remaining: 2, resolvedCount: 0 },
};

describe("ConflictsModule 冲突草稿三选一守卫（v0.0.13）", () => {
  it("脏草稿时收到 switch-confirm 渲染三选一对话框并告知 30 秒计时器", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: baseSnapshot,
      onAction,
      conflictSwitchRequest: {
        currentRelativePath: "src/a.ts",
        nextRelativePath: "src/b.ts",
      },
    });
    // 对话框出现（showModal 在 queueMicrotask 中调用，需异步等待 open）
    // 查询限定在 dialog 内：草稿工具栏也有「放弃草稿」按钮
    const dialog = await screen.findByRole("dialog", {
      name: "未保存草稿处理",
    });
    expect(dialog).toBeInTheDocument();
    expect(
      within(dialog).getByText(/30 秒未选择将自动保存检查点并继续/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "保存检查点并继续" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "留在当前文件" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "放弃草稿" }),
    ).toBeInTheDocument();
  });

  it("三个按钮分别发出 save/stay/discard", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ConflictsModule, {
      snapshot: baseSnapshot,
      onAction,
      conflictSwitchRequest: {
        currentRelativePath: "src/a.ts",
        nextRelativePath: "src/b.ts",
      },
    });
    const dialog = await screen.findByRole("dialog", {
      name: "未保存草稿处理",
    });
    await fireEvent.click(
      within(dialog).getByRole("button", { name: "保存检查点并继续" }),
    );
    expect(onAction).toHaveBeenCalledWith("conflict/draft-switch-decision", {
      decision: "save",
    });
    // stay
    // 需要重新渲染以再次显示对话框（onAction 后 dialog 会关闭，但测试中手动保持）
    await rerender({
      snapshot: baseSnapshot,
      onAction,
      conflictSwitchRequest: {
        currentRelativePath: "src/a.ts",
        nextRelativePath: "src/b.ts",
      },
    } as never);
    await fireEvent.click(
      within(dialog).getByRole("button", { name: "留在当前文件" }),
    );
    expect(onAction).toHaveBeenCalledWith("conflict/draft-switch-decision", {
      decision: "stay",
    });
    await rerender({
      snapshot: baseSnapshot,
      onAction,
      conflictSwitchRequest: {
        currentRelativePath: "src/a.ts",
        nextRelativePath: "src/b.ts",
      },
    } as never);
    await fireEvent.click(
      within(dialog).getByRole("button", { name: "放弃草稿" }),
    );
    expect(onAction).toHaveBeenCalledWith("conflict/draft-switch-decision", {
      decision: "discard",
    });
  });

  it("conflict/draft-checkpointed ACK 后展示 notice", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: baseSnapshot,
      onAction,
      conflictDraftAck: {
        relativePath: "src/a.ts",
        revision: 3,
        updatedAt: Date.now(),
      },
    });
    expect(screen.getByText(/检查点已保存/)).toBeInTheDocument();
  });

  // V027-R53终审 P0-4：无草稿快照，ACK 是检查点 notice 的唯一来源
  //（ACK 文案为“修订 N；重启后”，快照草稿文案带时间戳，可区分）。
  const snapshotNoDraftAck: ConflictSnapshot = {
    ...baseSnapshot,
    selected: {
      ...baseSnapshot.selected!,
      draft: undefined,
    },
  };

  it("V027-R53终审 P0-4：跨文件旧 ACK 不覆盖当前文件状态", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: snapshotNoDraftAck,
      onAction,
      conflictDraftAck: {
        relativePath: "src/b.ts",
        revision: 9,
        updatedAt: Date.now(),
      },
    });
    // 当前选中 src/a.ts 且无草稿：src/b.ts 的 ACK 必须被拒绝，不展示检查点 notice。
    expect(screen.queryByText(/检查点已保存/)).not.toBeInTheDocument();
  });

  it("V027-R53终审 P0-4：同文件乱序 ACK 拒绝（旧 revision 不覆盖新状态）", async () => {
    const onAction = vi.fn();
    const { rerender } = render(ConflictsModule, {
      snapshot: snapshotNoDraftAck,
      onAction,
      conflictDraftAck: {
        relativePath: "src/a.ts",
        revision: 3,
        updatedAt: Date.now(),
      },
    });
    // ACK 文案以“修订 3；”结尾（状态条 detail 用“·”，不会误匹配）。
    expect(screen.getByText(/修订 3；/)).toBeInTheDocument();
    // 乱序到达的旧 revision=2 必须被拒绝，展示仍为修订 3。
    await rerender({
      snapshot: snapshotNoDraftAck,
      onAction,
      conflictDraftAck: {
        relativePath: "src/a.ts",
        revision: 2,
        updatedAt: Date.now() + 1,
      },
    } as never);
    expect(screen.getByText(/修订 3；/)).toBeInTheDocument();
    expect(screen.queryByText(/修订 2/)).not.toBeInTheDocument();
  });

  it("保存失败 feedback 内联展示且草稿保留（编辑器与草稿不丢）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: baseSnapshot, onAction });
    // 保存失败的 feedback 应内联展示（mergeEditor.feedback）
    expect(screen.getByText(/保存失败/)).toBeInTheDocument();
    // 草稿信息仍展示（用户语言，不含内部实现术语）
    expect(screen.getByText(/合并草稿仅本次会话保留/)).toBeInTheDocument();
    // 复制/导出按钮可用（hasDraft）
    expect(screen.getByRole("button", { name: "复制草稿" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "导出草稿" })).toBeEnabled();
    // 点击复制/导出应发对应 action
    await fireEvent.click(screen.getByRole("button", { name: "复制草稿" }));
    expect(onAction).toHaveBeenCalledWith("conflict/draft-copy", {
      relativePath: "src/a.ts",
    });
    await fireEvent.click(screen.getByRole("button", { name: "导出草稿" }));
    expect(onAction).toHaveBeenCalledWith("conflict/draft-export", {
      relativePath: "src/a.ts",
    });
  });

  it("无草稿时复制/导出按钮禁用", () => {
    const snapshotNoDraft: ConflictSnapshot = {
      ...baseSnapshot,
      selected: {
        ...baseSnapshot.selected!,
        draft: undefined,
      },
    };
    render(ConflictsModule, { snapshot: snapshotNoDraft, onAction: vi.fn() });
    expect(screen.getByRole("button", { name: "复制草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "导出草稿" })).toBeDisabled();
  });
});
