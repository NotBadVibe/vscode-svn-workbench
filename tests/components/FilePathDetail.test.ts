import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import { toDisplayPath } from "../../src/scope/pathBrands";

/*
 * v0.0.7 路径显示与路径详情（§7.1）：默认显示项目内路径、跨项目徽标、
 * 可访问的路径详情（项目内/仓库内/SVN URL/本地完整路径），本地完整
 * 路径复制走 Host action。
 */

const snapshot = {
  kind: "changes" as const,
  commitDraft: "",
  files: [
    {
      relativePath: "app/src/index.ts",
      projectRelativePath: toDisplayPath("src/index.ts"),
      projectName: "app",
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
  ],
  summary: { modified: 1 },
  refreshedAt: "2026-08-13T10:00:00.000Z",
};

const pathDetail = {
  relativePath: "app/src/index.ts",
  detail: {
    projectRelativePath: toDisplayPath("src/index.ts"),
    workingCopyRelativePath: toDisplayPath("app/src/index.ts"),
    repositoryRelativePath: toDisplayPath("trunk/app/src/index.ts"),
    svnUrl: "https://svn.example.internal/svn/Code2/trunk/app/src/index.ts",
    absolutePath: toDisplayPath("/repo/code/app/src/index.ts"),
  },
};

describe("文件路径显示与路径详情（v0.0.7）", () => {
  it("默认显示项目内路径并保留工作副本内路径为 tooltip，跨项目显示徽标", () => {
    render(ChangesModule, { snapshot, onAction: vi.fn() });
    const label = screen.getByText("src/index.ts");
    expect(label.closest("button")?.getAttribute("title")).toBe(
      "app/src/index.ts",
    );
    expect(screen.getByText("app")).toBeInTheDocument();
  });

  it("路径详情按钮发送工作副本内路径，而非显示路径", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 app/src/index.ts 路径详情" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/path-detail", {
      relativePath: "app/src/index.ts",
    });
  });

  it("路径详情分别标注四种路径，本地完整路径复制由 Host 完成", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction, pathDetail });
    expect(screen.getByText("项目内路径")).toBeInTheDocument();
    expect(screen.getByText("工作副本内路径")).toBeInTheDocument();
    expect(screen.getByText("仓库内路径")).toBeInTheDocument();
    // 工作副本内路径与仓库内路径是两个不同字段，不得互相冒充。
    expect(
      screen.getAllByText("app/src/index.ts").length,
    ).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("trunk/app/src/index.ts")).toBeInTheDocument();
    expect(screen.getByText("SVN URL")).toBeInTheDocument();
    expect(
      screen.getByText(
        "https://svn.example.internal/svn/Code2/trunk/app/src/index.ts",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("本地完整路径")).toBeInTheDocument();
    expect(screen.getByText("/repo/code/app/src/index.ts")).toBeInTheDocument();

    await fireEvent.click(
      screen.getByRole("button", { name: "复制本地完整路径" }),
    );
    expect(onAction).toHaveBeenCalledWith("file/copy-path", {
      relativePath: "app/src/index.ts",
    });
  });

  it("路径详情错误如实展示且不渲染路径列表", () => {
    render(ChangesModule, {
      snapshot,
      onAction: vi.fn(),
      pathDetail: {
        relativePath: "app/src/index.ts",
        error: "路径不在当前操作范围内，已拒绝。",
      },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "路径不在当前操作范围内",
    );
    expect(screen.queryByText("本地完整路径")).not.toBeInTheDocument();
  });

  it("详情面板可键盘关闭", async () => {
    render(ChangesModule, { snapshot, onAction: vi.fn(), pathDetail });
    expect(screen.getByText("项目内路径")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "关闭路径详情" }));
    expect(screen.queryByText("项目内路径")).not.toBeInTheDocument();
  });
});

describe("跨项目提交预览分组（v0.0.7 §7.2）", () => {
  const crossProjectSnapshot = {
    kind: "commit" as const,
    files: [
      {
        relativePath: "app/a.ts",
        projectRelativePath: toDisplayPath("a.ts"),
        projectName: "app",
        status: "modified" as const,
        selection: "selected" as const,
      },
      {
        relativePath: "web/b.ts",
        projectRelativePath: toDisplayPath("b.ts"),
        projectName: "web",
        status: "modified" as const,
        selection: "selected" as const,
      },
    ],
    summary: {
      total: 2,
      selected: 2,
      needsReview: 0,
      excluded: 0,
      blocked: 0,
    },
    selectedPaths: ["app/a.ts", "web/b.ts"],
    message: "feat: 跨项目提交",
    messageIssues: [],
    conventionHint: "",
    templates: [],
    selectionAi: { configured: false },
    aiPrivacy: [],
    preview: {
      token: "token-1",
      canExecute: true,
      selectedPaths: ["app/a.ts", "web/b.ts"],
      addPaths: [],
      removePaths: [],
      commands: ["svn commit"],
      issues: [],
      outOfDatePaths: [],
      createdAt: "2026-08-13T10:00:00.000Z",
    },
  };

  it("跨项目 scope 的预览按项目分组并显示项目内路径", () => {
    render(CommitModule, {
      snapshot: crossProjectSnapshot,
      onAction: vi.fn(),
    });
    expect(screen.getByText("按项目分组的提交文件")).toBeInTheDocument();
    const appGroup = screen.getByText("app", { selector: "strong" });
    expect(appGroup).toBeInTheDocument();
    expect(screen.getByText("web", { selector: "strong" })).toBeInTheDocument();
  });

  it("单项目预览不分组", () => {
    render(CommitModule, {
      snapshot: {
        ...crossProjectSnapshot,
        files: crossProjectSnapshot.files.map((file) => ({
          ...file,
          projectName: undefined,
        })),
      },
      onAction: vi.fn(),
    });
    expect(screen.queryByText("按项目分组的提交文件")).not.toBeInTheDocument();
  });
});
