import { render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi, beforeEach } from "vitest";
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

function makeSnapshot(
  conflicts: string[],
  selected: string | undefined,
  opts: { draftDirty?: boolean; progress?: ConflictSnapshot["progress"] } = {},
): ConflictSnapshot {
  return {
    kind: "conflicts",
    conflicts: conflicts.map((p) => ({
      relativePath: p,
      type: "text",
      operation: "update" as const,
    })),
    progress: opts.progress ?? {
      initialCount: 3,
      remaining: conflicts.length,
      resolvedCount: 3 - conflicts.length,
    },
    selected: selected
      ? {
          relativePath: selected,
          contents: { working: { content: "merged", truncated: false } },
          mergeEditor: { token: "edit-1", editable: true, issues: [] },
          draft: opts.draftDirty
            ? {
                content: "dirty draft",
                revision: 2,
                updatedAt: Date.now(),
                hasDraft: true,
                dirty: true,
              }
            : undefined,
        }
      : undefined,
  } as ConflictSnapshot;
}

describe("ConflictsModule V013-E 重采后导航闭环", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("resolve 后自动选中下一个且顺序与左侧列表一致", async () => {
    const onAction = vi.fn();
    const initial = makeSnapshot(
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      "src/a.ts",
    );
    const { rerender } = render(ConflictsModule, {
      snapshot: initial,
      onAction,
    });
    // 模拟 Host 重采：a.ts 已解决，权威列表为 b,c，selected 按 Host 可能已置为 b 但 Webview 仍需自动指向 b（后继）
    const nextSnap = makeSnapshot(["src/b.ts", "src/c.ts"], "src/b.ts", {
      progress: { initialCount: 3, remaining: 2, resolvedCount: 1 },
    });
    await rerender({
      snapshot: nextSnap,
      onAction,
      entryOrigin: "generic",
    } as never);
    // 微任务后应触发自动 select 到 b（按路径排序后继为 b）
    await new Promise((r) => setTimeout(r, 0));
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "src/b.ts",
    });
    // 已解决文件不再显示在列表
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
  });

  it("已解决文件不重现，后台刷新不抢焦点", async () => {
    const onAction = vi.fn();
    const initial = makeSnapshot(["src/a.ts", "src/b.ts"], "src/a.ts");
    const { rerender } = render(ConflictsModule, {
      snapshot: initial,
      onAction,
    });
    onAction.mockClear();
    // 后台刷新：列表未变，选中仍为 a，不应抢焦点自动跳
    const sameSnap = makeSnapshot(["src/a.ts", "src/b.ts"], "src/a.ts");
    await rerender({ snapshot: sameSnap, onAction } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/select",
      expect.anything(),
    );
  });

  it("全部完成显示摘要且不再显示旧冲突", async () => {
    const onAction = vi.fn();
    const initial = makeSnapshot(["src/a.ts"], "src/a.ts");
    const { rerender } = render(ConflictsModule, {
      snapshot: initial,
      onAction,
    });
    const emptySnap = makeSnapshot([], undefined, {
      progress: { initialCount: 1, remaining: 0, resolvedCount: 1 },
    });
    await rerender({ snapshot: emptySnap, onAction } as never);
    expect(screen.getByTestId("all-resolved-summary")).toBeInTheDocument();
    expect(screen.getAllByText(/全部冲突已解决/).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText(/本次已解决 1 个冲突/)).toBeInTheDocument();
    expect(screen.queryByText("src/a.ts")).not.toBeInTheDocument();
  });

  it("返回来路按钮正确（来自 update）", async () => {
    const onAction = vi.fn();
    const emptySnap = makeSnapshot([], undefined, {
      progress: { initialCount: 2, remaining: 0, resolvedCount: 2 },
    });
    render(ConflictsModule, {
      snapshot: emptySnap,
      onAction,
      entryOrigin: "update",
    } as never);
    expect(screen.getByTestId("return-to-update")).toBeInTheDocument();
    expect(screen.getByText("返回更新结果")).toBeInTheDocument();
  });

  it("返回来路按钮正确（来自 changes）", async () => {
    render(ConflictsModule, {
      snapshot: makeSnapshot([], undefined),
      onAction: vi.fn(),
      entryOrigin: "changes",
    } as never);
    expect(screen.getByTestId("return-to-changes")).toBeInTheDocument();
    expect(screen.getByText("查看本地修改")).toBeInTheDocument();
  });

  it("有草稿时守卫优先仍发起 select（Host 侧弹三选一）", async () => {
    const onAction = vi.fn();
    const initial = makeSnapshot(
      ["src/a.ts", "src/b.ts", "src/c.ts"],
      "src/a.ts",
      { draftDirty: true },
    );
    const { rerender } = render(ConflictsModule, {
      snapshot: initial,
      onAction,
    });
    const nextSnap = makeSnapshot(["src/b.ts", "src/c.ts"], "src/b.ts");
    await rerender({ snapshot: nextSnap, onAction } as never);
    await new Promise((r) => setTimeout(r, 0));
    // 即使有脏草稿，仍应尝试 select，下游 Host 会以 draft-switch-confirm 守卫拦截
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "src/b.ts",
    });
  });

  it("状态变化经 role=status 播报", async () => {
    const onAction = vi.fn();
    const initial = makeSnapshot(["src/a.ts", "src/b.ts"], "src/a.ts");
    const { rerender } = render(ConflictsModule, {
      snapshot: initial,
      onAction,
    });
    const nextSnap = makeSnapshot(["src/b.ts"], "src/b.ts", {
      progress: { initialCount: 2, remaining: 1, resolvedCount: 1 },
    });
    await rerender({ snapshot: nextSnap, onAction } as never);
    await new Promise((r) => setTimeout(r, 0));
    const statusNodes = screen.getAllByRole("status");
    const texts = statusNodes.map((n) => n.textContent ?? "");
    expect(
      texts.some((t) => t.includes("已解决") && t.includes("下一个冲突")),
    ).toBe(true);

    // 全部完成播报
    const emptySnap = makeSnapshot([], undefined, {
      progress: { initialCount: 2, remaining: 0, resolvedCount: 2 },
    });
    await rerender({ snapshot: emptySnap, onAction } as never);
    const statusNodes2 = screen.getAllByRole("status");
    expect(
      statusNodes2.some((n) =>
        (n.textContent ?? "").includes("全部冲突已解决"),
      ),
    ).toBe(true);
  });

  it("通用出口包含多按钮且不扩大 scope", async () => {
    const onAction = vi.fn();
    const emptySnap = makeSnapshot([], undefined);
    render(ConflictsModule, {
      snapshot: emptySnap,
      onAction,
      entryOrigin: "generic",
    } as never);
    expect(screen.getByTestId("return-to-changes-generic")).toBeInTheDocument();
    expect(screen.getByTestId("return-to-update-generic")).toBeInTheDocument();
  });
});
