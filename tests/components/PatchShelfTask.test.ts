import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import PatchShelfTask from "../../src/webview/features/repository/tasks/PatchShelfTask.svelte";
import type { RepositorySnapshot } from "../../src/protocol/workbenchProtocol";
import {
  isShelfEntryView,
  isRepositorySnapshot,
} from "../../src/protocol/workbenchProtocol";

function snapshotWithShelves(): RepositorySnapshot {
  return {
    kind: "repository",
    info: { name: "repo", revision: "42" },
    properties: { available: true, target: ".", items: [] },
    cleanup: { available: true, target: "." },
    advanced: {
      shelves: [
        {
          id: "shelf-1",
          displayName: "修复登录",
          createdAt: "2026-09-01T10:00:00.000Z",
          fileCount: 2,
          files: ["src/a.ts"],
          baselineRevision: "41",
          repositoryUuid: "repo-1",
          projectName: "示例项目",
          patchFileName: "shelf-1.patch",
          integrity: "ok",
        },
        {
          id: "shelf-2",
          displayName: "损坏条目",
          createdAt: "2026-09-02T10:00:00.000Z",
          fileCount: 1,
          files: [],
          repositoryUuid: "repo-1",
          patchFileName: "shelf-2.patch",
          integrity: "corrupt",
          integrityDetail: "补丁文件为空。",
        },
      ],
    },
  };
}

describe("PatchShelfTask V024-R38/R48", () => {
  it("中文展示名创建与清单一致；重复名禁用创建", async () => {
    const onAction = vi.fn();
    render(PatchShelfTask, { snapshot: snapshotWithShelves(), onAction });
    expect(await screen.findByText("修复登录")).toBeInTheDocument();
    expect(screen.getByText(/本地搁置清单（2 个）/)).toBeInTheDocument();
    const input = screen.getByLabelText("本地搁置显示名称");
    await fireEvent.input(input, { target: { value: "修复登录" } });
    expect(await screen.findByText(/已存在同名搁置/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "预览创建本地搁置" }),
    ).toBeDisabled();
  });

  it("恢复/导出/删除走独立动作；损坏条目不可恢复", async () => {
    const onAction = vi.fn();
    render(PatchShelfTask, { snapshot: snapshotWithShelves(), onAction });
    const restoreButtons = await screen.findAllByRole("button", {
      name: "预览恢复",
    });
    expect(restoreButtons).toHaveLength(2);
    expect(restoreButtons[0]).toBeEnabled();
    expect(restoreButtons[1]).toBeDisabled();
    await fireEvent.click(restoreButtons[0]);
    expect(onAction).toHaveBeenCalledWith("repository/preview-shelf-restore", {
      shelfId: "shelf-1",
    });
    await fireEvent.click(screen.getAllByRole("button", { name: "导出" })[0]);
    expect(onAction).toHaveBeenCalledWith("repository/export-shelf", {
      shelfId: "shelf-1",
    });
    await fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    const confirm = await screen.findByRole("button", {
      name: "确认删除搁置“修复登录”",
    });
    await fireEvent.click(confirm);
    expect(onAction).toHaveBeenCalledWith("repository/delete-shelf", {
      shelfId: "shelf-1",
    });
  });

  it("IME 候选阶段 Enter 不触发创建", async () => {
    const onAction = vi.fn();
    render(PatchShelfTask, { snapshot: snapshotWithShelves(), onAction });
    const input = screen.getByLabelText("本地搁置显示名称");
    await fireEvent.input(input, { target: { value: "新功能" } });
    await fireEvent.compositionStart(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).not.toHaveBeenCalledWith(
      "repository/preview-advanced",
      expect.anything(),
    );
    await fireEvent.compositionEnd(input);
    await fireEvent.keyDown(input, { key: "Enter" });
    expect(onAction).toHaveBeenCalledWith("repository/preview-advanced", {
      operation: "shelf",
      shelfName: "新功能",
    });
  });

  it("协议守卫接受中文搁置快照", () => {
    const snapshot = snapshotWithShelves();
    expect(isRepositorySnapshot(snapshot)).toBe(true);
    for (const entry of snapshot.advanced.shelves ?? []) {
      expect(isShelfEntryView(entry)).toBe(true);
    }
    expect(isShelfEntryView({ id: "../evil", displayName: "x" })).toBe(false);
  });
});
