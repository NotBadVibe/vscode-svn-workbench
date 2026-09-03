import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import type { ChangesSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V014-B · Changes 唯一主操作五状态（规划 §4.2 落地）。
 * 每态只渲染一个 button--primary；数量来自权威合法集合（整快照），
 * 不来自过滤后可见行；更多菜单只灌选择、不跳转、不直接打开 Commit。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

function changeFile(relativePath: string, status: string, selection: string) {
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

function primaryButtons(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll(".button--primary"),
  ) as HTMLElement[];
}

describe("Changes 唯一主操作五状态（V014-B）", () => {
  it("无选择且有推荐项：唯一主操作“选择建议的 N 个文件”，点击只灌选择不跳转", async () => {
    const onAction = vi.fn();
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "modified", "selected"),
        changeFile("src/c.ts", "modified", "needsReview"),
      ]),
      onAction,
    });
    const suggest = screen.getByRole("button", {
      name: "选择建议的 2 个文件",
    });
    expect(suggest).toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(1);
    expect(primaryButtons(container)[0]).toBe(suggest);
    await fireEvent.click(suggest);
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/c.ts")).not.toBeChecked();
    // 只灌选择：不打开 Commit、不跳转。
    expect(onAction).not.toHaveBeenCalledWith(
      "open-module",
      expect.objectContaining({ moduleId: "commit" }),
    );
    // 灌入后进入 ready 态，主操作切换为提交。
    expect(
      screen.getByRole("button", { name: "检查并提交所选（2）" }),
    ).toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(1);
  });

  it("已选择可提交文件：唯一主操作“检查并提交所选（N）”，数量与 payload 一致", async () => {
    const onAction = vi.fn();
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "modified", "needsReview"),
      ]),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    const submit = screen.getByRole("button", {
      name: "检查并提交所选（2）",
    });
    expect(submit).toBeInTheDocument();
    expect(submit).toBeEnabled();
    expect(primaryButtons(container)).toHaveLength(1);
    expect(primaryButtons(container)[0]).toBe(submit);
    // 次级动作保留原契约。
    expect(
      screen.getByRole("button", { name: "加入变更集（2）" }),
    ).toBeInTheDocument();
    await fireEvent.click(submit);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "commit",
      taskId: "commit/compose",
      selectedPaths: ["src/a.ts", "src/b.ts"],
    });
  });

  it("当前只有冲突：冲突 CTA 升为唯一 primary，底栏无 primary", async () => {
    const onAction = vi.fn();
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/c1.ts", "conflicted", "blocked"),
        changeFile("src/c2.ts", "conflicted", "blocked"),
      ]),
      onAction,
    });
    const cta = screen.getByRole("button", { name: "处理 2 个冲突" });
    expect(cta).toHaveClass("button--primary");
    expect(primaryButtons(container)).toHaveLength(1);
    expect(primaryButtons(container)[0]).toBe(cta);
    await fireEvent.click(cta);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
    });
  });

  it("工作副本干净：空状态“检查远端更新”为唯一 primary，“查看历史”保持次级", async () => {
    const onAction = vi.fn();
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([]),
      onAction,
    });
    expect(screen.getByText("工作副本很干净")).toBeInTheDocument();
    const update = screen.getByRole("button", { name: "检查远端更新" });
    expect(update).toHaveClass("button--primary");
    expect(screen.getByRole("button", { name: "查看历史" })).toHaveClass(
      "button--secondary",
    );
    expect(primaryButtons(container)).toHaveLength(1);
    await fireEvent.click(update);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "update",
      taskId: "update/preview",
    });
  });

  it("所选全部阻止：唯一主操作“查看阻止原因（N）”，点击展开原因说明", async () => {
    const onAction = vi.fn();
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/e.ts", "unversioned", "excluded"),
      ]),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/e.ts"));
    const view = screen.getByRole("button", {
      name: "查看阻止原因（1）",
    });
    expect(view).toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(1);
    expect(primaryButtons(container)[0]).toBe(view);
    // 阻止态不渲染提交主按钮（fail-closed，不静默过滤）。
    expect(
      screen.queryByRole("button", { name: /检查并提交所选/ }),
    ).not.toBeInTheDocument();
    await fireEvent.click(view);
    expect(
      screen.getByRole("status", { name: "阻止提交原因" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/src\/e\.ts/)).toBeInTheDocument();
  });

  it("范围仅阻止项（无可提交）：唯一主操作“查看阻止原因”", async () => {
    const { container } = render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("ext/lib.ts", "external", "blocked"),
      ]),
      onAction: vi.fn(),
    });
    const view = screen.getByRole("button", {
      name: "查看阻止原因（1）",
    });
    expect(view).toBeInTheDocument();
    expect(primaryButtons(container)).toHaveLength(1);
  });

  it("混合选择（含阻止项）：提交主按钮 disabled 并保留阻断提示", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/e.ts", "unversioned", "excluded"),
      ]),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/e.ts"));
    const submit = screen.getByRole("button", {
      name: "检查并提交所选（1）",
    });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/有 1 个所选文件不可提交/)).toBeInTheDocument();
  });

  it("更多菜单：只把范围可提交项灌入选择，不直接打开 Commit", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "modified", "needsReview"),
        changeFile("src/c.ts", "conflicted", "blocked"),
      ]),
      onAction,
    });
    await fireEvent.click(screen.getByRole("button", { name: "更多批量操作" }));
    const item = screen.getByRole("menuitem", {
      name: "选择当前范围可提交的 2 个文件",
    });
    expect(item).toBeInTheDocument();
    await fireEvent.click(item);
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/c.ts")).not.toBeChecked();
    expect(onAction).not.toHaveBeenCalledWith(
      "open-module",
      expect.objectContaining({ moduleId: "commit" }),
    );
  });

  it("主按钮数量来自权威集合：筛选隐藏推荐项后数量不变", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "modified", "selected"),
      ]),
      onAction: vi.fn(),
    });
    // 筛选只剩 a.ts，但权威推荐仍为 2。
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "a.ts" },
    });
    expect(screen.queryByText("b.ts")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "选择建议的 2 个文件" }),
    ).toBeInTheDocument();
  });

  it("旧同权双 CTA 已移除：不存在“检查当前范围并提交”", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
      ]),
      onAction: vi.fn(),
    });
    expect(
      screen.queryByRole("button", { name: /检查当前范围并提交/ }),
    ).not.toBeInTheDocument();
  });
});
