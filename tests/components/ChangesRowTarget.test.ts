import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";

/*
 * V020-R10 · 行右键任务定位所点文件（P1）。
 * 行菜单必须携带具体目标文件（查看历史 / 处理冲突），由 Host 在原 scope 内复验。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

const snapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [
    {
      relativePath: "src/first.ts",
      selectionKey: key("src/first.ts"),
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
    {
      relativePath: "src/second.ts",
      selectionKey: key("src/second.ts"),
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
    {
      relativePath: "src/conflict/c.ts",
      selectionKey: key("src/conflict/c.ts"),
      status: "conflicted" as const,
      selection: "blocked" as const,
      reason: "存在冲突",
    },
    {
      relativePath: "dist/debug.log",
      selectionKey: key("dist/debug.log"),
      status: "unversioned" as const,
      selection: "needsReview" as const,
      reason: "未纳入版本控制",
    },
  ],
  summary: { modified: 2, conflicted: 1, unversioned: 1 },
  refreshedAt: "2026-07-30T10:00:00.000Z",
};

function rowFor(basename: string): HTMLElement {
  const name = screen.getByText(basename);
  const row = name.closest("[data-row-index]");
  if (!(row instanceof HTMLElement)) {
    throw new Error(`找不到 ${basename} 所在行`);
  }
  return row;
}

describe("V020-R10 Changes 行右键携带目标文件", () => {
  it("目录中右键第二个文件只发送该文件历史", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });

    await fireEvent.contextMenu(rowFor("second.ts"));
    const menu = await screen.findByRole("menu", {
      name: "src/second.ts 操作菜单",
    });
    expect(menu).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("menuitem", { name: "查看历史" }));
    await vi.waitFor(() =>
      expect(onAction).toHaveBeenCalledWith("open-module", {
        moduleId: "history",
        taskId: "history/revisions",
        relativePath: "src/second.ts",
      }),
    );
  });

  it("冲突行处理按钮定位所点冲突文件", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });

    await fireEvent.click(
      screen.getByRole("button", { name: "处理 src/conflict/c.ts 的冲突" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
      relativePath: "src/conflict/c.ts",
    });
  });

  it("未纳入版本控制的文件不提供查看历史", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });

    await fireEvent.contextMenu(rowFor("debug.log"));
    await screen.findByRole("menu", { name: "dist/debug.log 操作菜单" });
    expect(screen.getByRole("menuitem", { name: "查看历史" })).toHaveAttribute(
      "data-disabled",
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "open-module",
      expect.objectContaining({ moduleId: "history" }),
    );
  });
});
