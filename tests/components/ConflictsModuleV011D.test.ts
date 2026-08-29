import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

vi.mock(
  "../../src/webview/features/conflicts/ConflictDiffView.svelte",
  async () => {
    const actual = await vi.importActual<
      typeof import("../../src/webview/features/conflicts/ConflictDiffView.svelte")
    >("../../src/webview/features/conflicts/ConflictDiffView.svelte");
    return actual;
  },
);

// mock pierre to avoid heavy mount in this integration test - use real adapter mock via ConflictDiffView internal mock? Keep simple.
vi.mock("@pierre/diffs", () => ({
  UnresolvedFile: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
  FileDiff: class {},
}));

const snapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [{ relativePath: "src/a.ts", type: "text", operation: "update" }],
  selected: {
    relativePath: "src/a.ts",
    sourceLeftRevision: "127",
    sourceRightRevision: "128",
    contents: {
      working: {
        content: "<<<<<<< .mine\nlocal\n=======\nremote\n>>>>>>> .r5\n",
        truncated: false,
      },
      mine: { content: "local", truncated: false },
      theirs: { content: "remote", truncated: false },
      base: { content: "base", truncated: false },
    },
    mergeEditor: { token: "edit-1", editable: true, issues: [] },
  },
};

describe("ConflictsModule V011-D 重排", () => {
  it("显示紧凑导航（文件/块）与块进度", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });
    expect(
      screen.getByRole("navigation", { name: "冲突导航" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("block-progress")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "上一个文件" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "下一个文件" }),
    ).toBeInTheDocument();
  });
  it("固定角色说明可见且不只依赖颜色（含文字与图标）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });
    const bar = screen.getByTestId("conflict-role-bar");
    expect(bar).toBeInTheDocument();
    expect(bar.textContent).toContain("我的修改（本地）");
    expect(bar.textContent).toContain("对方修改（仓库）");
    expect(bar.textContent).toContain("共同基线（BASE）");
    expect(bar.textContent).toContain("合并结果");
    // 图标存在表示不只颜色
    expect(bar.querySelectorAll(".codicon").length).toBeGreaterThanOrEqual(4);
  });
  it("来源内容在折叠区默认收起，点击展开后可见来源 Tab", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });
    const details = screen.getByTestId(
      "conflict-source-details",
    ) as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = details.querySelector("summary") as HTMLElement;
    await fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(
      screen.getByRole("tablist", { name: "来源版本" }),
    ).toBeInTheDocument();
  });
  it("顶部显示文件路径与 revision 始终可见", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });
    expect(screen.getAllByText("src/a.ts").length).toBeGreaterThan(0);
    expect(screen.getByText(/r127/)).toBeInTheDocument();
  });
});
