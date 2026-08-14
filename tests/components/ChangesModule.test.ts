import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ChangesModule from "../../src/webview/features/changes/ChangesModule.svelte";

const key = (relativePath: string) => `test-wc::${relativePath}`;

const snapshot = {
  kind: "changes" as const,
  commitDraft: "feat: initial",
  files: [
    {
      relativePath: "src/a.ts",
      selectionKey: key("src/a.ts"),
      status: "modified" as const,
      selection: "selected" as const,
      reason: "本地修改",
    },
    {
      relativePath: "src/b.ts",
      selectionKey: key("src/b.ts"),
      status: "conflicted" as const,
      selection: "blocked" as const,
      reason: "存在冲突",
    },
  ],
  summary: { modified: 1, conflicted: 1 },
  refreshedAt: "2026-07-30T10:00:00.000Z",
};

describe("ChangesModule", () => {
  it("filters files and opens a diff from the visible row", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });

    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "a.ts" },
    });
    // PathCell：第一行文件名，第二行项目内父目录。
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(screen.queryByText("b.ts")).not.toBeInTheDocument();

    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 差异" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-diff", {
      relativePath: "src/a.ts",
    });
  });

  it("does not allow selecting a blocked conflict", () => {
    render(ChangesModule, { snapshot, onAction: vi.fn() });
    expect(screen.getByLabelText("选择 src/b.ts")).toBeDisabled();
  });

  it("中文、空格、括号和井号路径可以筛选并原样打开", async () => {
    const onAction = vi.fn();
    const relativePath = "项目资料/空 格（终版）#1/很长很长的组件名称.ts";
    render(ChangesModule, {
      snapshot: {
        ...snapshot,
        files: [
          {
            relativePath,
            selectionKey: key(relativePath),
            status: "modified" as const,
            selection: "selected" as const,
            reason: "本地修改",
          },
        ],
        summary: { modified: 1 },
      },
      onAction,
    });
    await fireEvent.input(screen.getByLabelText("筛选变更文件"), {
      target: { value: "终版" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: `查看 ${relativePath} 差异` }),
    );
    expect(onAction).toHaveBeenCalledWith("open-diff", { relativePath });
  });

  it("virtualizes a 5000-file working copy instead of mounting every row", () => {
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

    expect(screen.getByRole("list", { name: "SVN 变更文件" })).toHaveClass(
      "file-list--virtual",
    );
    expect(screen.getAllByRole("listitem").length).toBeLessThan(100);
    expect(screen.getByText("file-0.ts")).toBeInTheDocument();
  });

  it("在 Changes 中编辑并保存与提交模块共享的 Host 草稿", async () => {
    const onAction = vi.fn();
    render(ChangesModule, { snapshot, onAction });
    // 脏草稿始终可见（自动展开）。
    expect(screen.getByLabelText("共享提交草稿")).toHaveValue("feat: initial");
    await fireEvent.input(screen.getByLabelText("共享提交草稿"), {
      target: { value: "fix: shared draft" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "保存共享草稿" }));
    expect(onAction).toHaveBeenCalledWith("commit/update-draft", {
      message: "fix: shared draft",
    });
  });

  it("Revert 必须展示不可恢复说明并完成二次勾选", async () => {
    const onAction = vi.fn();
    render(ChangesModule, {
      snapshot: {
        ...snapshot,
        operationPreview: {
          token: "revert-1",
          operation: "revert" as const,
          paths: ["src/a.ts"],
          command: 'svn revert "src/a.ts"',
          consequences: ["丢弃本地变更。"],
          destructive: true,
          recoverability: "SVN 无法恢复。",
          canExecute: true,
          issues: [],
        },
      },
      onAction,
    });
    const execute = screen.getByRole("button", { name: "确认还原本地修改" });
    expect(screen.getByText(/可恢复性：/)).toBeInTheDocument();
    expect(execute).toBeDisabled();
    await fireEvent.click(
      screen.getByRole("checkbox", { name: /逐项核对文件清单/ }),
    );
    await fireEvent.click(execute);
    expect(onAction).toHaveBeenCalledWith("changes/execute-operation", {
      previewToken: "revert-1",
    });
  });
});
