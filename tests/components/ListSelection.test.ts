import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import type { ChangesSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.8 选择与批量闭环（UX08-SEL-01/02/03/04/07、SORT-01/02）。
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

const threeFiles = () => [
  changeFile("src/a.ts", "modified", "selected"),
  changeFile("src/b.ts", "modified", "needsReview"),
  changeFile("src/c.ts", "conflicted", "blocked"),
];

describe("Changes 选择闭环（v0.0.8）", () => {
  it("三态表头只作用于当前筛选可操作项；blocked 永不加入", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction: vi.fn(),
    });
    const header = screen.getByRole("checkbox", {
      name: "选择当前筛选可操作项（2）",
    });
    expect(header).not.toBeChecked();
    // 全选当前筛选可操作项。
    await fireEvent.click(header);
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/c.ts")).toBeDisabled();
    // 摘要与批量按钮数量一致。
    expect(screen.getAllByText(/已选 2/).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "检查并提交所选（2）" }),
    ).toBeInTheDocument();
    // 再次点击全部取消。
    await fireEvent.click(header);
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
  });

  it("筛选外隐藏选择可见、可单独清除；只看已选；清空全部", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    // 筛选掉已选项 → 隐藏选择 1。
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "b.ts" },
    });
    expect(screen.getByText(/隐藏 1/)).toBeInTheDocument();
    // 只看已选：列表只剩已选行（a.ts 被筛选排除 → 空态提示）。
    await fireEvent.click(screen.getByRole("button", { name: "只看已选" }));
    expect(screen.getByText("已选文件不在当前筛选中")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "只看已选" }));
    // 清除隐藏：选择清空但可见筛选不变。
    await fireEvent.click(screen.getByRole("button", { name: "清除隐藏选择" }));
    expect(screen.getByText(/隐藏 0/)).toBeInTheDocument();
    // 重新选择后清空全部。
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.click(screen.getByRole("button", { name: "清空全部" }));
    expect(screen.getByLabelText("选择 src/b.ts")).not.toBeChecked();
  });

  it("排序稳定且不改变选择；可恢复默认顺序", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/z10.ts", "modified", "selected"),
        changeFile("src/z2.ts", "modified", "selected"),
        changeFile("src/a.ts", "conflicted", "blocked"),
      ]),
      onAction: vi.fn(),
    });
    // 默认顺序 = 快照顺序。
    const before = screen
      .getAllByRole("listitem")
      .map((row) => row.getAttribute("data-row-index"));
    expect(before).toEqual(["0", "1", "2"]);
    // 自然排序：file2 < file10。
    await fireEvent.click(screen.getByRole("button", { name: /文件/ }));
    const names = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(names[0]).toContain("a.ts");
    expect(names[1]).toContain("z2.ts");
    expect(names[2]).toContain("z10.ts");
    // 状态排序：冲突优先级最高；再次点击反向。
    await fireEvent.click(screen.getByRole("button", { name: /状态/ }));
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("a.ts");
    // aria-sort 与中文方向文字。
    expect(
      screen.getAllByRole("columnheader").some((header) => {
        return header.getAttribute("aria-sort") !== "none";
      }),
    ).toBe(true);
    // 恢复默认顺序。
    await fireEvent.click(screen.getByRole("button", { name: "恢复默认顺序" }));
    expect(screen.getAllByRole("listitem")[0].textContent).toContain("z10.ts");
  });

  it("快照刷新只保留合法交集并播报移除；新文件不自动加入", async () => {
    const { rerender } = render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    // 新快照：a.ts 保留、b.ts 变 blocked、新增 d.ts。
    await rerender({
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "conflicted", "blocked"),
        changeFile("src/d.ts", "added", "selected"),
      ]),
      onAction: vi.fn(),
    });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/d.ts")).not.toBeChecked();
    expect(screen.getByText(/刷新后移除 1 个失效选择/)).toBeInTheDocument();
  });

  it("Ctrl/⌘+A 在列表内选择当前筛选可操作项，IME 候选期间不触发", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction: vi.fn(),
    });
    const list = screen.getByRole("list", { name: "SVN 变更文件" });
    await fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    // 清空后模拟 IME 候选：不再触发。
    await fireEvent.click(screen.getByRole("button", { name: "清空全部" }));
    await fireEvent.keyDown(list, {
      key: "a",
      ctrlKey: true,
      isComposing: true,
    });
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
  });

  it("Changes 下 excluded 可逐项选择，但“检查并提交所选”被阻止并提示（Task 2）", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/e.ts", "unversioned", "excluded"),
        changeFile("src/d.ts", "conflicted", "blocked"),
      ]),
      onAction,
    });
    // excluded/blocked 在 Changes 可逐项明确选择（非提交动作）。
    const excludedBox = screen.getByLabelText("选择 src/e.ts");
    expect(excludedBox).not.toBeDisabled();
    await fireEvent.click(excludedBox);
    expect(excludedBox).toBeChecked();
    // 提交按钮被阻止：role=status 提示 + 数量显示可提交数（0），payload 不发。
    expect(screen.getByText(/有 1 个所选文件不可提交/)).toBeInTheDocument();
    const submit = screen.getByRole("button", {
      name: "检查并提交所选（0）",
    });
    expect(submit).toBeDisabled();
    // 取消 excluded 后按钮恢复，数量与 payload 一致。
    await fireEvent.click(excludedBox);
    const ok = screen.getByRole("button", {
      name: "检查并提交所选（0）",
    });
    expect(ok).toBeDisabled();
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    const ready = screen.getByRole("button", {
      name: "检查并提交所选（1）",
    });
    expect(ready).not.toBeDisabled();
    await fireEvent.click(ready);
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "commit",
      taskId: "commit/compose",
      selectedPaths: ["src/a.ts"],
    });
  });

  it("Ctrl/⌘+A 幂等：连按仍全选当前筛选可操作项，不反向清空（Task 4）", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction: vi.fn(),
    });
    const list = screen.getByRole("list", { name: "SVN 变更文件" });
    await fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    await fireEvent.keyDown(list, { key: "a", ctrlKey: true });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    // blocked 永不进入。
    expect(screen.getByLabelText("选择 src/c.ts")).not.toBeChecked();
  });

  it("PageDown 按一页可见行数移动活动行并保持局部滚动（Task 4）", async () => {
    const files = [] as ReturnType<typeof changeFile>[];
    for (let index = 0; index < 120; index += 1) {
      files.push(changeFile(`src/file-${index}.ts`, "modified", "selected"));
    }
    render(ChangesModule, {
      snapshot: changesSnapshot(files),
      onAction: vi.fn(),
    });
    const list = screen.getByRole("list", { name: "SVN 变更文件" });
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await fireEvent.keyDown(list, { key: "PageDown" });
    // 活动行按一页可见行数移动：分页后活动行索引大于 1（首行 + 一页）。
    // requestAnimationFrame 聚焦后，活动行获得焦点。
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const active = document.querySelector(".file-row--active");
    expect(active).not.toBeNull();
    expect(list.contains(active)).toBe(true);
  });

  it("Commit 5,000 候选窗口化：全选完整可提交集且挂载行数受限（Task 5）", async () => {
    const files = [] as ReturnType<typeof changeFile>[];
    for (let index = 0; index < 5_000; index += 1) {
      files.push(changeFile(`src/file-${index}.ts`, "modified", "selected"));
    }
    render(CommitModule, {
      snapshot: commitSnapshotWith(files, []),
      onAction: vi.fn(),
    });
    // 窗口化：挂载行数远小于完整数据集。
    const mounted = document.querySelectorAll(".commit-file-row").length;
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(100);
    // 全选作用于完整数据集（表头勾选后提交按钮显示完整数量）。
    const header = screen.getByRole("checkbox", {
      name: "选择当前筛选可提交项（5000）",
    });
    await fireEvent.click(header);
    expect(
      screen.getByRole("button", { name: "生成提交预览（5000）" }),
    ).toBeInTheDocument();
  });

  it("Commit 窗口化下 End 跳到远端行：目标行挂载且活动焦点正确（Task A）", async () => {
    const files = [] as ReturnType<typeof changeFile>[];
    for (let index = 0; index < 5_000; index += 1) {
      files.push(changeFile(`src/file-${index}.ts`, "modified", "selected"));
    }
    render(CommitModule, {
      snapshot: commitSnapshotWith(files, []),
      onAction: vi.fn(),
    });
    const list = screen.getByRole("list", { name: "提交候选文件" });
    // 建立活动行，再 End 跳到最后一行。
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    await fireEvent.keyDown(list, { key: "End" });
    // requestAnimationFrame 聚焦后，远端行必须已挂载并获得活动焦点。
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const active = document.querySelector(".commit-file-row--active");
    expect(active).not.toBeNull();
    expect(active?.getAttribute("data-row-index")).toBe("4999");
    // 活动行真实获得焦点（bind:element 使虚拟化滚动生效）。
    expect(document.activeElement).toBe(active);
    expect(list.contains(active)).toBe(true);
  });

  it("Shift+方向键连续选择且活动行与选择分离", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts", "modified", "selected"),
        changeFile("src/b.ts", "modified", "selected"),
        changeFile("src/c.ts", "modified", "selected"),
      ]),
      onAction: vi.fn(),
    });
    const list = screen.getByRole("list", { name: "SVN 变更文件" });
    await fireEvent.keyDown(list, { key: "ArrowDown" });
    // 仅移动活动行，不改变选择。
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
    await fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/c.ts")).not.toBeChecked();
  });

  it("批量 payload 与按钮数量一致", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot(threeFiles()),
      onAction,
    });
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    await fireEvent.click(
      screen.getByRole("button", { name: "检查并提交所选（2）" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "commit",
      taskId: "commit/compose",
      selectedPaths: ["src/a.ts", "src/b.ts"],
    });
  });
});

function commitSnapshotWith(
  files: ReturnType<typeof changeFile>[],
  selectedPaths: string[],
  preview?: unknown,
) {
  return {
    kind: "commit" as const,
    files: files.map((file) => ({
      ...file,
      evaluation: {
        decision: "recommended" as const,
        reasonKey: "statusPolicy" as const,
        statusPolicyKey: "modified" as const,
        safetyLocked: false,
      },
    })),
    summary: {
      total: files.length,
      selected: files.filter((file) => file.selection === "selected").length,
      needsReview: files.filter((file) => file.selection === "needsReview")
        .length,
      excluded: files.filter((file) => file.selection === "excluded").length,
      blocked: files.filter((file) => file.selection === "blocked").length,
    },
    selectedPaths,
    message: "feat: x",
    messageIssues: [],
    conventionHint: "",
    templates: [],
    selectionAi: { configured: false },
    aiPrivacy: [],
    preview: preview as never,
  };
}

describe("Commit 选择闭环（v0.0.8）", () => {
  it("三态只含可提交项；excluded/blocked 不可勾选，needsReview 可显式选择", async () => {
    render(CommitModule, {
      snapshot: commitSnapshotWith(
        [
          changeFile("src/a.ts", "modified", "selected"),
          changeFile("src/b.ts", "modified", "needsReview"),
          changeFile("src/c.ts", "unversioned", "excluded"),
          changeFile("src/d.ts", "conflicted", "blocked"),
        ],
        ["src/a.ts"],
      ),
      onAction: vi.fn(),
    });
    expect(
      screen.getByRole("checkbox", { name: "选择当前筛选可提交项（2）" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("选择 src/c.ts")).toBeDisabled();
    expect(screen.getByLabelText("选择 src/d.ts")).toBeDisabled();
    // needsReview 可显式选择。
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
  });

  it("选择变化使旧预览失效并提示重新生成", async () => {
    const onAction = vi.fn();
    render(CommitModule, {
      snapshot: commitSnapshotWith(
        [changeFile("src/a.ts", "modified", "selected")],
        ["src/a.ts"],
        {
          token: "t1",
          canExecute: true,
          selectedPaths: ["src/a.ts"],
          addPaths: [],
          removePaths: [],
          commands: [],
          issues: [],
          outOfDatePaths: [],
          createdAt: "2026-08-14T10:00:00.000Z",
        },
      ),
      onAction,
    });
    expect(
      screen.getByRole("button", { name: /确认提交（1）/ }),
    ).toBeInTheDocument();
    // 本地取消选择 → 旧预览不可用。
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    expect(screen.getByText(/选择已变化，旧预览已失效/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /确认提交/ }),
    ).not.toBeInTheDocument();
    // 无选择时预览按钮禁用并说明。
    expect(
      screen.getByRole("button", { name: "生成提交预览（0）" }),
    ).toBeDisabled();
    expect(screen.getByText(/先选择至少 1 个可提交文件/)).toBeInTheDocument();
    // commit/update-selection 已同步 Host。
    expect(onAction).toHaveBeenCalledWith("commit/update-selection", {
      selectedPaths: [],
    });
  });

  it("回声防护：未回显前旧快照不覆盖用户刚操作的选择", async () => {
    const { rerender } = render(CommitModule, {
      snapshot: commitSnapshotWith(
        [
          changeFile("src/a.ts", "modified", "selected"),
          changeFile("src/b.ts", "modified", "selected"),
        ],
        ["src/a.ts"],
      ),
      onAction: vi.fn(),
    });
    // 用户勾选 b.ts（pending echo）。
    await fireEvent.click(screen.getByLabelText("选择 src/b.ts"));
    // 旧快照回声（仍只有 a.ts）不得覆盖用户操作。
    await rerender({
      snapshot: commitSnapshotWith(
        [
          changeFile("src/a.ts", "modified", "selected"),
          changeFile("src/b.ts", "modified", "selected"),
        ],
        ["src/a.ts"],
      ),
      onAction: vi.fn(),
    });
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    // Host 权威回显匹配后清除 pending。
    await rerender({
      snapshot: commitSnapshotWith(
        [
          changeFile("src/a.ts", "modified", "selected"),
          changeFile("src/b.ts", "modified", "selected"),
        ],
        ["src/a.ts", "src/b.ts"],
      ),
      onAction: vi.fn(),
    });
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
  });

  it("隐藏选择计数与摘要文案", async () => {
    render(CommitModule, {
      snapshot: commitSnapshotWith(
        [
          changeFile("src/a.ts", "modified", "selected"),
          changeFile("src/b.ts", "modified", "selected"),
        ],
        ["src/a.ts", "src/b.ts"],
      ),
      onAction: vi.fn(),
    });
    await fireEvent.input(screen.getByLabelText("筛选提交文件"), {
      target: { value: "a.ts" },
    });
    expect(screen.getByText(/另有 1 个隐藏选择/)).toBeInTheDocument();
  });
});
