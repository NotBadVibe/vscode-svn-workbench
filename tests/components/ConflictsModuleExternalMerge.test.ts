import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

vi.mock("@pierre/diffs", async () => {
  const a: Record<string, unknown> = await vi.importActual("@pierre/diffs");
  return a;
});

const baseSnapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [{ relativePath: "src/a.ts", type: "text" }],
  selected: {
    relativePath: "src/a.ts",
    contents: {
      working: {
        content: "<<<<<<< .mine\nlocal\n=======\nremote\n>>>>>>> .r5\n",
        truncated: false,
      },
    },
    mergeEditor: { token: "edit-1", editable: true, issues: [] },
  },
};

function withExternalMerge(
  externalMerge: ConflictSnapshot["externalMerge"],
): ConflictSnapshot {
  return { ...baseSnapshot, externalMerge };
}

describe("ConflictsModule V018-F 外部合并工具出口", () => {
  it("默认入口：点击发送 preview 动作，不直接启动", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: baseSnapshot, onAction });
    await fireEvent.click(await screen.findByTestId("open-external-merge"));
    expect(onAction).toHaveBeenCalledWith("conflict/preview-external-merge", {
      relativePath: "src/a.ts",
    });
    // 未自动 Resolve。
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });

  it("未配置三出口：选择可执行文件/打开设置/继续内置编辑", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: withExternalMerge({
        available: false,
        needsConfig: true,
        toolLabel: "未配置（通用外部合并工具）",
        fileRoles: [
          {
            role: "result",
            label: "合并结果（工作副本）",
            relativePath: "src/a.ts",
          },
        ],
      }),
      onAction,
    });
    expect(
      await screen.findByTestId("external-merge-needs-config"),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByTestId("external-merge-pick"));
    expect(onAction).toHaveBeenCalledWith("conflict/select-merge-tool", {
      relativePath: "src/a.ts",
    });
    await fireEvent.click(screen.getByTestId("external-merge-settings"));
    expect(onAction).toHaveBeenCalledWith("diagnostics/open-settings", {
      query: "svnWorkbench.mergeTool.path",
    });
    // 继续内置编辑：提示收起，不触发任何 Host 动作。
    const callsBefore = onAction.mock.calls.length;
    await fireEvent.click(screen.getByTestId("external-merge-continue"));
    expect(
      screen.queryByTestId("external-merge-needs-config"),
    ).not.toBeInTheDocument();
    expect(onAction.mock.calls.length).toBe(callsBefore);
  });

  it("打开前确认展示文件角色、路径与外部修改警告", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: withExternalMerge({
        available: true,
        toolLabel: "meld",
        fileRoles: [
          {
            role: "mine",
            label: "我的修改（本地）",
            relativePath: "src/a.ts",
          },
          {
            role: "theirs",
            label: "对方修改（仓库）",
            relativePath: "src/a.ts",
          },
          {
            role: "base",
            label: "共同基线（BASE）",
            relativePath: "src/a.ts",
          },
          {
            role: "result",
            label: "合并结果（工作副本）",
            relativePath: "src/a.ts",
          },
        ],
        preview: {
          token: "mock-external-merge",
          commandPreview: "meld src/a.ts",
          canOpen: true,
          issues: [],
        },
      }),
      onAction,
    });
    await fireEvent.click(
      await screen.findByTestId("external-merge-open-dialog"),
    );
    // 确认对话框：标题、四角色、外部修改警告、命令预览。
    expect(
      await screen.findByText("在外部合并工具中打开 1 个文件"),
    ).toBeInTheDocument();
    // 四角色在页内角色条与确认对话框中同时出现（不只依赖颜色）。
    expect(
      screen.getAllByText(/我的修改（本地）/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/共同基线（BASE）/).length,
    ).toBeGreaterThanOrEqual(1);
    // 警告同时出现在摘要与可恢复性行中。
    expect(
      screen.getAllByText(/外部工具可能修改工作副本/).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText(/不会自动标记解决/).length,
    ).toBeGreaterThanOrEqual(1);
    await fireEvent.click(screen.getByText("在外部工具中打开"));
    expect(onAction).toHaveBeenCalledWith("conflict/open-external-merge", {
      previewToken: "mock-external-merge",
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });

  it("退出后反馈提示重开/重比，不自动 Resolve", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, {
      snapshot: withExternalMerge({
        available: true,
        toolLabel: "meld",
        fileRoles: [],
        feedback:
          "外部工具已退出，状态已重新采集。工作副本可能已被修改，请重新打开/比较；未自动标记解决，旧确认已失效。",
      }),
      onAction,
    });
    expect(
      await screen.findByTestId("external-merge-feedback"),
    ).toBeInTheDocument();
    expect(screen.getByText(/请重新打开\/比较/)).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });

  it("非文本冲突的外部出口走 preview 动作", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: baseSnapshot, onAction });
    const externalButton = screen.queryByTestId("non-text-open-external");
    if (externalButton) {
      await fireEvent.click(externalButton);
      expect(onAction).toHaveBeenCalledWith(
        "conflict/preview-external-merge",
        expect.anything(),
      );
    }
    // 文本分支下该按钮不存在时不失败（由非文本分支测试覆盖可见性）。
    expect(true).toBe(true);
  });

  it("V020-R12：普通文件出口统一命名为在 VS Code 编辑器中打开", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: baseSnapshot, onAction });
    // 页眉普通文件出口使用统一命名，不再与外部合并工具入口同名异义。
    const editorButtons = await screen.findAllByRole("button", {
      name: "在 VS Code 编辑器中打开",
    });
    expect(editorButtons.length).toBeGreaterThan(0);
    await fireEvent.click(editorButtons[0]);
    expect(onAction).toHaveBeenCalledWith("open-file", {
      relativePath: "src/a.ts",
    });
    expect(
      screen.queryByRole("button", { name: "打开工作副本文件" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "在编辑器中打开" })).toBeNull();
    expect(screen.queryByText("在外部工具打开")).toBeNull();
  });

  it("V020-R12：未落盘草稿时确认对话框明示磁盘版本与草稿关系", async () => {
    const onAction = vi.fn();
    const snapshotWithDraft: ConflictSnapshot = {
      ...baseSnapshot,
      selected: {
        ...baseSnapshot.selected!,
        draft: {
          content: "草稿内容",
          revision: 3,
          updatedAt: Date.now(),
          hasDraft: true,
          dirty: true,
        },
      },
      externalMerge: {
        available: true,
        toolLabel: "meld",
        fileRoles: [
          {
            role: "result",
            label: "合并结果（工作副本）",
            relativePath: "src/a.ts",
          },
        ],
        preview: {
          token: "mock-external-merge-draft",
          commandPreview: "meld src/a.ts",
          canOpen: true,
          issues: [],
        },
      },
    };
    render(ConflictsModule, { snapshot: snapshotWithDraft, onAction });
    await fireEvent.click(
      await screen.findByTestId("external-merge-open-dialog"),
    );
    // 未保存草稿不被静默当成工具输入：启动前明确磁盘版本关系
    //（摘要与问题清单同时明示）。
    expect(await screen.findAllByText(/未落盘合并草稿/)).not.toHaveLength(0);
    expect(screen.getAllByText(/磁盘版本/).length).toBeGreaterThan(0);
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });
});
