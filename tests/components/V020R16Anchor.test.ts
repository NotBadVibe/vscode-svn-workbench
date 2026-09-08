import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import type { ChangesSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V020-R16 · 排序筛选后的 Shift 选择锚点（先复现后修复）。
 *
 * 复现链路：长列表建立锚点 → 筛选/排序改变可见集合 → Shift 鼠标/键盘连续选择。
 * 契约：
 * - 锚点使用稳定身份（selectionKey）；目标不在新集合时清除并建立新锚点；
 * - 越界旧位置不得沿用（80 行锚点筛至 5 行后 Shift 点击只作用于新集合语义）；
 * - 范围选择始终过滤不可操作项（blocked 永不批量加入）；
 * - 旧隐藏选择不被扩大（筛选外已选项保留但不参与新范围）。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

function changeFile(
  relativePath: string,
  status = "modified",
  selection = "selected",
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

/** 80 行：5 个 keep + 75 个 drop，锚点建在末尾 drop 行。 */
function eightyFiles() {
  const files = [] as ReturnType<typeof changeFile>[];
  for (let index = 0; index < 5; index += 1) {
    files.push(changeFile(`src/keep-${index}.ts`));
  }
  for (let index = 0; index < 75; index += 1) {
    files.push(changeFile(`src/drop-${index}.ts`));
  }
  return files;
}

describe("V020-R16 Shift 选择锚点", () => {
  it("鼠标：80 行锚点筛至 5 行后 Shift 点击不沿用越界位置", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(eightyFiles()),
      onAction: vi.fn(),
    });
    // 在第 80 行（drop-74）单击建立锚点：选中 1 个。
    await fireEvent.click(screen.getByLabelText("选择 src/drop-74.ts"));
    expect(screen.getByLabelText("选择 src/drop-74.ts")).toBeChecked();
    // 筛选至 5 行 keep：锚点目标不在新集合中。
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "keep-" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByRole("status", { name: /隐藏 1/ })).toBeInTheDocument();
    // Shift 点击首行：越界锚点已清除，应只选中该行（+ 隐藏 1，共 2）。
    const firstBox = screen.getByLabelText("选择 src/keep-0.ts");
    await fireEvent.click(firstBox, { shiftKey: true });
    expect(firstBox).toBeChecked();
    // 其余可见行不得被旧锚点连带选中。
    expect(screen.getByLabelText("选择 src/keep-1.ts")).not.toBeChecked();
    expect(screen.getByLabelText("选择 src/keep-4.ts")).not.toBeChecked();
    expect(screen.getAllByText(/已选 2/).length).toBeGreaterThan(0);
  });

  it("键盘：筛至 5 行后 Shift+方向键不沿用越界锚点", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot(eightyFiles()),
      onAction: vi.fn(),
    });
    await fireEvent.click(screen.getByLabelText("选择 src/drop-74.ts"));
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "keep-" },
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    const list = screen.getByRole("list", { name: "SVN 变更文件" });
    // 越界锚点已清除：首次 Shift+Down 不得一次性选中全部 5 行。
    await fireEvent.keyDown(list, { key: "ArrowDown", shiftKey: true });
    const checkedCount = ["keep-0", "keep-1", "keep-2", "keep-3", "keep-4"]
      .map((name) => screen.getByLabelText(`选择 src/${name}.ts`))
      .filter((box) => (box as HTMLInputElement).checked).length;
    expect(checkedCount).toBeLessThan(5);
  });

  it("排序：锚点跟随稳定身份，Shift 范围符合可见顺序", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/c.ts"),
        changeFile("src/a.ts"),
        changeFile("src/e.ts"),
        changeFile("src/b.ts"),
        changeFile("src/d.ts"),
      ]),
      onAction: vi.fn(),
    });
    // 在 c.ts（快照索引 0）单击建立锚点（身份锚 = c）。
    await fireEvent.click(screen.getByLabelText("选择 src/c.ts"));
    // 按文件名升序：可见顺序变为 a b c d e，c 到索引 2。
    await fireEvent.click(screen.getByRole("button", { name: /^文件/ }));
    const names = screen
      .getAllByRole("listitem")
      .map((row) => row.textContent ?? "");
    expect(names[0]).toContain("a.ts");
    expect(names[2]).toContain("c.ts");
    // Shift 点击末行 e：范围应为可见顺序 c→e（3 个），而非旧位置 0→4（5 个）。
    const boxes = screen.getAllByRole("listitem");
    const lastBox = boxes[4].querySelector('input[type="checkbox"]')!;
    await fireEvent.click(lastBox, { shiftKey: true });
    expect(screen.getByLabelText("选择 src/c.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/d.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/e.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/a.ts")).not.toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).not.toBeChecked();
  });

  it("范围选择始终过滤不可操作项（blocked/external 不被批量选中）", async () => {
    render(ChangesModule, {
      snapshot: changesSnapshot([
        changeFile("src/a.ts"),
        changeFile("src/x.ts", "conflicted", "blocked"),
        changeFile("src/b.ts"),
        // 中文注释：external 由本地规则映射为 excluded，批量同样不可操作。
        changeFile("src/y.ts", "external", "excluded"),
        changeFile("src/c.ts"),
      ]),
      onAction: vi.fn(),
    });
    // 锚点 a.ts，Shift 点击 c.ts：区间含 blocked 与 external 行。
    await fireEvent.click(screen.getByLabelText("选择 src/a.ts"));
    // a.ts 已选中，再次点击会取消——先取消再重建锚点语义：直接 Shift 点 c。
    await fireEvent.click(screen.getByLabelText("选择 src/c.ts"), {
      shiftKey: true,
    });
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/b.ts")).toBeChecked();
    expect(screen.getByLabelText("选择 src/c.ts")).toBeChecked();
    // blocked/external 行永不进入批量选择。
    expect(screen.getByLabelText("选择 src/x.ts")).not.toBeChecked();
    expect(screen.getByLabelText("选择 src/y.ts")).not.toBeChecked();
  });
});
