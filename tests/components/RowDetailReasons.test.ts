import { fireEvent, render, screen, within } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import type { CommitSnapshot } from "../../src/protocol/workbenchProtocol";
import { toDisplayPath } from "../../src/scope/pathBrands";

/*
 * V022-R32：行内解释收敛进行详情。
 * - 行内：状态徽标与选择建议文字直接表达，无独立解释按钮；
 * - 行详情：完整路径出口（路径详情按钮）打开后，同一区域内展示状态与选择说明，
 *   键盘可达（聚焦展开），Esc/关闭按钮回到触发点且不改动滚动位置；
 * - 阻止行保持文字 + 行样式多通道（file-row--blocked + 不可提交文字）。
 */

const key = (relativePath: string) => `test-wc::${relativePath}`;

const changesSnapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [
    {
      relativePath: "app/src/index.ts",
      selectionKey: key("app/src/index.ts"),
      projectRelativePath: toDisplayPath("src/index.ts"),
      projectName: "app",
      status: "conflicted" as const,
      selection: "blocked" as const,
    },
  ],
  summary: { conflicted: 1 },
  refreshedAt: "2026-07-30T10:00:00.000Z",
};

const changesPathDetail = {
  relativePath: "app/src/index.ts",
  detail: {
    projectRelativePath: toDisplayPath("src/index.ts"),
    workingCopyRelativePath: toDisplayPath("app/src/index.ts"),
    repositoryRelativePath: toDisplayPath("trunk/app/src/index.ts"),
    svnUrl: "https://svn.example.internal/svn/Code2/trunk/app/src/index.ts",
    absolutePath: toDisplayPath("/repo/code/app/src/index.ts"),
  },
};

const commitSnapshot: CommitSnapshot = {
  kind: "commit",
  files: [
    {
      relativePath: "src/a.ts",
      selectionKey: key("src/a.ts"),
      status: "modified",
      selection: "selected",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
    },
  ],
  summary: { total: 1, selected: 1, needsReview: 0, excluded: 0, blocked: 0 },
  selectedPaths: ["src/a.ts"],
  message: "",
  messageIssues: [],
  selectionAi: { configured: false },
  aiPrivacy: [],
  templates: [],
};

const commitPathDetail = {
  relativePath: "src/a.ts",
  detail: {
    projectRelativePath: toDisplayPath("src/a.ts"),
    workingCopyRelativePath: toDisplayPath("src/a.ts"),
    repositoryRelativePath: toDisplayPath("trunk/src/a.ts"),
    svnUrl: "https://svn.example.internal/svn/Code2/trunk/src/a.ts",
    absolutePath: toDisplayPath("/repo/code/src/a.ts"),
  },
};

describe("行详情收敛解释（V022-R32）", () => {
  it("Changes：行内无解释按钮，行详情区展示状态与选择说明", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: changesSnapshot,
      onAction,
      pathDetail: changesPathDetail,
    });

    // 行内直接文字表达：行内无独立解释按钮（断言限定在行内，详情区除外）。
    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBe(1);
    expect(
      within(rows[0]).queryByRole("button", { name: /解释术语：/ }),
    ).toBeNull();
    expect(screen.getByText("存在冲突")).toBeInTheDocument();
    expect(screen.getByText("不可提交")).toBeInTheDocument();

    // 行详情区收敛完整解释：状态 + 选择各一个可聚焦展开按钮。
    const group = screen.getByRole("group", { name: "状态与选择说明" });
    expect(group).toBeInTheDocument();
    const statusTrigger = screen.getByRole("button", {
      name: "解释术语：存在冲突",
    });
    expect(group.contains(statusTrigger)).toBe(true);
    expect(
      screen.getByRole("button", { name: "解释术语：不可提交" }),
    ).toBeInTheDocument();

    // 复杂原因可聚焦展开：点击后就地展示解释正文。
    await fireEvent.click(statusTrigger);
    expect(statusTrigger).toHaveAttribute("aria-expanded", "true");

    // 关闭详情回到触发点：详情区收起，行内文字与阻止样式保留。
    await fireEvent.click(screen.getByRole("button", { name: "关闭路径详情" }));
    expect(screen.queryByRole("group", { name: "状态与选择说明" })).toBeNull();
    expect(screen.getByText("存在冲突")).toBeInTheDocument();
    expect(screen.getByText("不可提交")).toBeInTheDocument();
  });

  it("Changes：阻止行保持文字与行样式多通道", () => {
    render(ChangesModule, { snapshot: changesSnapshot, onAction: vi.fn() });
    const row = screen.getByRole("listitem");
    expect(row.className).toContain("file-row--blocked");
    expect(row.textContent).toContain("不可提交");
  });

  it("Commit：行内无解释按钮，行详情区展示状态说明", () => {
    const onAction = vi.fn();
    render(CommitModule, {
      snapshot: commitSnapshot,
      onAction,
      pathDetail: commitPathDetail,
    });

    // 行内无独立解释按钮（断言限定在行内，详情区除外）。
    const row = screen.getByRole("listitem");
    expect(
      within(row).queryByRole("button", { name: /解释术语：/ }),
    ).toBeNull();
    // 决策依据文字仍保留在行内直接表达。
    expect(screen.getByText(/推荐提交/)).toBeInTheDocument();

    const group = screen.getByRole("group", { name: "状态与选择说明" });
    expect(group).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "解释术语：已修改" }),
    ).toBeInTheDocument();
  });
});
