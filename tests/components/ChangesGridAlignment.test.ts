import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";

const key = (relativePath: string) => `test-wc::${relativePath}`;

const files = [
  {
    relativePath: "proj-a/src/common.ts",
    selectionKey: key("proj-a/src/common.ts"),
    status: "modified" as const,
    selection: "selected" as const,
    reason: "本地修改",
    projectName: "项目甲",
    repositoryName: "repo-a",
  },
  {
    relativePath: "proj-b/src/common.ts",
    selectionKey: key("proj-b/src/common.ts"),
    status: "conflicted" as const,
    selection: "blocked" as const,
    reason: "存在冲突",
    projectName: "项目乙",
    repositoryName: "repo-b",
  },
  {
    relativePath: "proj-a/src/missing.ts",
    selectionKey: key("proj-a/src/missing.ts"),
    status: "missing" as const,
    selection: "excluded" as const,
    reason: "文件缺失",
    projectName: "项目甲",
    repositoryName: "repo-a",
  },
];

const snapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files,
  summary: { modified: 1, conflicted: 1, missing: 1 },
  refreshedAt: "2026-07-30T10:00:00.000Z",
};

/**
 * V020-R03：Changes 表头与数据列对齐契约。
 * 表头 6 列（选择/文件/状态/选择建议/归属/操作）与每行 6 个直接子节点一一对应；
 * 状态解释、选择解释不再作为独立 grid 节点参与排版。
 */
describe("Changes 表列对齐（V020-R03）", () => {
  it("表头与每行各有 6 个直接 grid 子节点且列归属一致", () => {
    render(ChangesModule, { snapshot, onAction: vi.fn() });

    const header = screen.getByRole("row");
    expect(header.children.length).toBe(6);

    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.children.length).toBe(6);
      expect(row.children[2].className).toContain("file-row__status");
      expect(row.children[3].className).toContain("file-row__selection");
      expect(row.children[4].className).toContain("file-row__ownership");
      expect(row.children[5].className).toContain("file-row__actions");
    }
  });

  /*
   * V022-R32：行内解释收敛进行详情——行内不再有独立解释按钮（每行减少
   * 2 个 Tab 停留点）；状态徽标与选择建议文字直接表达，信息仍完整；
   * 完整解释随路径详情在行详情区展开（见 RowDetailReasons.test.ts）。
   */
  it("行内无独立解释按钮，状态与选择文字直接表达", () => {
    render(ChangesModule, { snapshot, onAction: vi.fn() });

    expect(screen.queryByRole("button", { name: /解释术语：/ })).toBeNull();
    // 状态徽标文字仍在各自状态列内直接表达。
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].children[2].textContent).toContain("已修改");
    expect(rows[1].children[2].textContent).toContain("存在冲突");
    expect(rows[1].children[2].className).toContain("file-row__status");
    // 选择建议文字仍在选择列内直接表达（含阻止行）。
    expect(rows[0].children[3].textContent).toContain("本地修改");
    expect(rows[1].children[3].textContent).toContain("存在冲突");
    expect(rows[1].className).toContain("file-row--blocked");
  });

  it("冲突动作与差异动作归入固定操作列，普通行与冲突行列位置一致", () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });

    const rows = screen.getAllByRole("listitem");
    const normalActions = rows[0].children[5];
    const conflictActions = rows[1].children[5];
    // 普通行：仅差异按钮；冲突行：冲突直达 + 差异按钮。
    expect(normalActions.querySelectorAll("button").length).toBe(1);
    expect(conflictActions.querySelectorAll("button").length).toBe(2);
    expect(
      screen.getByRole("button", {
        name: "处理 proj-b/src/common.ts 的冲突",
      }),
    ).toBeInTheDocument();

    // 操作列仍是每行最后一个 grid 子节点，无漂移。
    for (const row of rows) {
      const last = row.children[row.children.length - 1];
      expect(last.className).toContain("file-row__actions");
    }
  });

  it("同名文件不同项目不误认：归属列与读屏名称均区分项目", () => {
    render(ChangesModule, { snapshot, onAction: vi.fn() });

    const rows = screen.getAllByRole("listitem");
    expect(rows[0].children[4].textContent).toContain("项目甲");
    expect(rows[1].children[4].textContent).toContain("项目乙");
    expect(
      screen.getByRole("button", {
        name: "项目 项目甲，proj-a/src/common.ts，已修改，未选",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "项目 项目乙，proj-b/src/common.ts，存在冲突，未选",
      }),
    ).toBeInTheDocument();
  });

  it("虚拟列表行高与密度一致：宽松 48px，紧凑 36px", () => {
    const largeSnapshot = {
      ...snapshot,
      files: Array.from({ length: 5000 }, (_, index) => ({
        relativePath: `src/generated/file-${index}.ts`,
        selectionKey: key(`src/generated/file-${index}.ts`),
        status: "modified" as const,
        selection: "selected" as const,
        reason: "本地修改",
      })),
      summary: { modified: 5000 },
    };
    render(ChangesModule, { snapshot: largeSnapshot, onAction: vi.fn() });

    // 默认宽松密度：虚拟行内联高度 48px（与 global.css .file-row--virtual 一致）。
    for (const row of screen.getAllByRole("listitem")) {
      expect((row as HTMLElement).style.height).toBe("48px");
    }
  });

  it("紧凑密度切换后虚拟行高为 36px", async () => {
    const largeSnapshot = {
      ...snapshot,
      files: Array.from({ length: 5000 }, (_, index) => ({
        relativePath: `src/generated/file-${index}.ts`,
        selectionKey: key(`src/generated/file-${index}.ts`),
        status: "modified" as const,
        selection: "selected" as const,
        reason: "本地修改",
      })),
      summary: { modified: 5000 },
    };
    render(ChangesModule, { snapshot: largeSnapshot, onAction: vi.fn() });

    await fireEvent.click(screen.getByRole("button", { name: "宽松" }));
    for (const row of screen.getAllByRole("listitem")) {
      expect((row as HTMLElement).style.height).toBe("36px");
    }
  });
});
