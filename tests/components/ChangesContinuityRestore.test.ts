import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";

/*
 * V014-C2 · Changes 消费 continuityRestore（C1 协议字段）组件测试。
 * 覆盖契约七步：非法 fail-closed、选择交集、活动行/滚动锚、视图回填与缺省保持、
 * 草稿保守、逐条播报、一次性消费。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

function file(relativePath: string, overrides: Record<string, unknown> = {}) {
  return {
    relativePath,
    selectionKey: key(relativePath),
    status: "modified" as const,
    selection: "selected" as const,
    reason: "本地修改",
    ...overrides,
  };
}

const baseFiles = [file("src/a.ts"), file("src/b.ts")];

function baseSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    kind: "changes" as const,
    commitDraft: "",
    files: baseFiles,
    summary: { modified: 2 },
    refreshedAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

function restorePayload(overrides: Record<string, unknown> = {}) {
  return {
    contextVersion: 1,
    originModule: "changes",
    changesView: {},
    selectedKeys: [],
    removedEntries: [],
    notices: [],
    restoredAt: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

describe("ChangesModule continuityRestore（V014-C2）", () => {
  it("选择只接受与最新候选的交集，并逐条播报移除原因与恢复提示", async () => {
    render(ChangesModule, {
      snapshot: baseSnapshot({
        continuityRestore: restorePayload({
          selectedKeys: [key("src/a.ts"), key("src/ghost.ts")],
          removedEntries: [
            {
              key: key("src/ghost.ts"),
              path: "src/ghost.ts",
              reason: "disappeared",
              message: "文件 src/ghost.ts 已不在最新快照中，已从选择中移除。",
            },
          ],
          notices: ["已按最新快照保留 1 个选择，移除 1 个失效项。"],
        }),
      }),
      onAction: vi.fn(),
    });

    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).not.toBeChecked();
    // 恢复播报走 SelectionSummary 的 role=status（与结果数量区分作用域查询）。
    await waitFor(() =>
      expect(
        document.querySelector(".selection-summary__announcement")?.textContent,
      ).toContain("文件 src/ghost.ts 已不在最新快照中，已从选择中移除。"),
    );
    expect(
      document.querySelector(".selection-summary__announcement")?.textContent,
    ).toContain("已按最新快照保留 1 个选择，移除 1 个失效项。");
  });

  it("非法载荷 fail-closed：视为缺省，不半应用", () => {
    render(ChangesModule, {
      snapshot: baseSnapshot({
        commitDraft: "feat: initial",
        continuityRestore: { bogus: true },
      }),
      onAction: vi.fn(),
    });

    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).not.toBeChecked();
    expect(screen.getByLabelText("筛选变更文件")).toHaveValue("");
    expect(
      document.querySelector(".selection-summary__announcement"),
    ).not.toBeInTheDocument();
    // Host 快照草稿仍正常同步（非载荷草稿）。
    expect(screen.getByLabelText("共享提交草稿")).toHaveValue("feat: initial");
  });

  it("本地草稿为空时回填载荷草稿", async () => {
    render(ChangesModule, {
      snapshot: baseSnapshot({
        continuityRestore: restorePayload({ commitDraft: "载荷草稿" }),
      }),
      onAction: vi.fn(),
    });

    await waitFor(() =>
      expect(screen.getByLabelText("共享提交草稿")).toHaveValue("载荷草稿"),
    );
  });

  it("本地已有输入时丢弃载荷草稿（第二道保守）", async () => {
    const { rerender } = render(ChangesModule, {
      snapshot: baseSnapshot(),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByRole("button", { name: "展开草稿" }));
    await fireEvent.input(screen.getByLabelText("共享提交草稿"), {
      target: { value: "用户输入" },
    });

    await rerender({
      snapshot: baseSnapshot({
        continuityRestore: restorePayload({ commitDraft: "载荷草稿" }),
      }),
      onAction: vi.fn(),
    });

    expect(screen.getByLabelText("共享提交草稿")).toHaveValue("用户输入");
  });

  it("视图有值回填：搜索与密度", async () => {
    render(ChangesModule, {
      snapshot: baseSnapshot({
        continuityRestore: restorePayload({
          changesView: { query: "a.ts", density: "compact" },
        }),
      }),
      onAction: vi.fn(),
    });

    await waitFor(() =>
      expect(screen.getByLabelText("筛选变更文件")).toHaveValue("a.ts"),
    );
    expect(screen.queryByText("b.ts")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "SVN 变更文件" })).toHaveClass(
      "file-list--compact",
    );
  });

  it("视图缺省保持现状：未携带 query 时不覆盖用户筛选", async () => {
    const { rerender } = render(ChangesModule, {
      snapshot: baseSnapshot(),
      onAction: vi.fn(),
    });
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "b.ts" },
    });
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();

    await rerender({
      snapshot: baseSnapshot({
        continuityRestore: restorePayload({
          changesView: {},
          selectedKeys: [key("src/a.ts")],
        }),
      }),
      onAction: vi.fn(),
    });

    expect(screen.getByLabelText("筛选变更文件")).toHaveValue("b.ts");
    // a.ts 行被用户筛选隐藏，先清除筛选再断言恢复后的选择。
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "" },
    });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
  });

  it("同一载荷只消费一次：恢复后用户改动不被重放覆盖", async () => {
    const snapshot = baseSnapshot({
      continuityRestore: restorePayload({ selectedKeys: [key("src/a.ts")] }),
    });
    const { rerender } = render(ChangesModule, {
      snapshot,
      onAction: vi.fn(),
    });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();

    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();

    await rerender({ snapshot, onAction: vi.fn() });
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
  });

  it("活动行命中直接定位；缺失时回退到滚动锚", async () => {
    const threeFiles = [file("src/a.ts"), file("src/b.ts"), file("src/c.ts")];
    const { unmount } = render(ChangesModule, {
      snapshot: baseSnapshot({
        files: threeFiles,
        summary: { modified: 3 },
        continuityRestore: restorePayload({
          selectedKeys: [key("src/c.ts")],
          activeFileKey: key("src/c.ts"),
          scrollAnchorKey: key("src/c.ts"),
        }),
      }),
      onAction: vi.fn(),
    });

    await waitFor(() =>
      expect(document.querySelectorAll(".file-row--active")).toHaveLength(1),
    );
    expect(document.querySelector(".file-row--active")?.textContent).toContain(
      "c.ts",
    );
    unmount();

    // 活动行指向已消失文件，回退到滚动锚对应行。
    render(ChangesModule, {
      snapshot: baseSnapshot({
        files: threeFiles,
        summary: { modified: 3 },
        continuityRestore: restorePayload({
          selectedKeys: [key("src/b.ts")],
          activeFileKey: key("src/gone.ts"),
          scrollAnchorKey: key("src/b.ts"),
        }),
      }),
      onAction: vi.fn(),
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".file-row--active")).toHaveLength(1),
    );
    expect(document.querySelector(".file-row--active")?.textContent).toContain(
      "b.ts",
    );
  });
});
