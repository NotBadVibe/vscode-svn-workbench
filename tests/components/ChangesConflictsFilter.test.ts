import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import type { ChangesSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.17 批次 B/E：Changes 冲突直达 CTA（U-06）、文件类型筛选与
 * 命名筛选预设（C-13）。筛选只影响视图，不改变选择与操作范围。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

function changeFile(
  relativePath: string,
  status: "modified" | "conflicted" | "unversioned",
  selection: string,
) {
  return {
    relativePath,
    selectionKey: key(relativePath) as never,
    status: status as never,
    selection: selection as never,
    reason: undefined,
  };
}

function changesSnapshot(
  files: ReturnType<typeof changeFile>[],
  filterPresets?: ChangesSnapshot["filterPresets"],
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
    filterPresets,
    refreshedAt: "2026-08-23T10:00:00.000Z",
  };
}

const mixedFiles = () => [
  changeFile("src/a.ts", "modified", "selected"),
  changeFile("src/b.svelte", "modified", "needsReview"),
  changeFile("src/c.ts", "conflicted", "blocked"),
];

describe("Changes 冲突直达与筛选预设（v0.0.17）", () => {
  it("存在冲突时状态筛选区提供直达冲突处理的 CTA", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles()),
      onAction,
    });
    const cta = screen.getByRole("button", { name: "处理 1 个冲突" });
    expect(cta).toBeInTheDocument();
    await fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  });

  it("冲突行提供直达冲突处理的行内按钮", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles()),
      onAction,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "处理 src/c.ts 的冲突" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  });

  it("文件类型筛选只影响视图，不改变已选集合", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles()),
      onAction: vi.fn(),
    });
    // 先勾选 a.ts 与 b.svelte。
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/b.svelte"));
    expect(screen.getAllByText(/已选 2/).length).toBeGreaterThan(0);
    // 切换到 .ts 类型：只剩 a.ts 与 c.ts 可见（PathCell 按文件名展示）。
    const typeSelect = screen.getByLabelText("文件类型筛选");
    await fireEvent.change(typeSelect, { target: { value: ".ts" } });
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.queryByText("b.svelte")).toBeNull();
    // 已选 2 不因筛选变化（b.svelte 隐藏但选择保留）。
    expect(screen.getAllByText(/隐藏 1/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已选 2/).length).toBeGreaterThan(0);
  });

  it("保存当前类型筛选为命名预设并发送 Host 动作", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles()),
      onAction,
    });
    await fireEvent.change(screen.getByLabelText("文件类型筛选"), {
      target: { value: ".ts" },
    });
    await fireEvent.input(screen.getByLabelText("筛选预设名称"), {
      target: { value: "仅 TypeScript" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "保存为预设" }));
    expect(onAction).toHaveBeenCalledWith("list/save-filter-preset", {
      name: "仅 TypeScript",
      patterns: ["*.ts"],
    });
    expect(
      screen.getByText(/已保存筛选预设“仅 TypeScript”/),
    ).toBeInTheDocument();
  });

  it("应用预设按 patterns 筛选视图；删除预设发送动作并停用", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles(), [
        { id: "preset-1", name: "仅 Svelte", patterns: ["*.svelte"] },
      ]),
      onAction,
    });
    // 应用预设：只剩 b.svelte 可见。
    await fireEvent.change(screen.getByLabelText("筛选预设"), {
      target: { value: "preset-1" },
    });
    expect(screen.getByText("b.svelte")).toBeInTheDocument();
    expect(screen.queryByText("a.ts")).toBeNull();
    // 删除预设：发送 Host 动作且视图恢复。
    await fireEvent.click(
      screen.getByRole("button", { name: "删除筛选预设 仅 Svelte" }),
    );
    expect(onAction).toHaveBeenCalledWith("list/delete-filter-preset", {
      id: "preset-1",
    });
    expect(screen.getByText("a.ts")).toBeInTheDocument();
  });

  it("未选择类型且未应用预设时保存按钮禁用并说明原因", () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(mixedFiles()),
      onAction: vi.fn(),
    });
    const save = screen.getByRole("button", { name: "保存为预设" });
    expect(save).toBeDisabled();
    expect(save.getAttribute("title")).toContain("先选择文件类型或预设");
  });
});
