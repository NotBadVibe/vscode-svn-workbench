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
    draft: {
      content: "draft-content",
      revision: 2,
      updatedAt: Date.now(),
      hasDraft: true,
      dirty: true,
    },
  },
};

describe("ConflictsModule V011-E 降级", () => {
  it("渲染异常 fail-closed 保留草稿并提供使用简化编辑器出口", async () => {
    const onAction = vi.fn();
    // 用截断内容模拟 UnresolvedFile 不可用切换到简化编辑器的 fallback分支
    const fallbackSnapshot: typeof baseSnapshot = {
      ...baseSnapshot,
      selected: {
        ...baseSnapshot.selected!,
        contents: {
          working: {
            content: undefined,
            truncated: true,
            readError: "内容已截断，请使用简化编辑器",
          },
        },
      },
    };
    render(ConflictsModule, { snapshot: fallbackSnapshot, onAction });
    expect(
      await screen.findByTestId("content-fallback-warning"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/草稿/).length).toBeGreaterThan(0);
    await fireEvent.click(screen.getByTestId("use-simple-editor-content"));
    expect(
      await screen.findByTestId("simplified-fallback-notice"),
    ).toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/save-working",
      expect.anything(),
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });
  it("二进制/截断内容显示真实原因并提供在编辑器中打开", async () => {
    const onAction = vi.fn();
    const binarySnapshot: ConflictSnapshot = {
      ...baseSnapshot,
      selected: {
        ...baseSnapshot.selected!,
        contents: {
          working: {
            content: undefined,
            truncated: true,
            readError: "二进制文件不支持内嵌合并",
          },
        },
      },
    };
    render(ConflictsModule, { snapshot: binarySnapshot, onAction });
    expect(
      await screen.findByTestId("content-fallback-warning"),
    ).toBeInTheDocument();
    expect(screen.getByText(/二进制文件不支持内嵌合并/)).toBeInTheDocument();
    expect(screen.getAllByText("在编辑器中打开").length).toBeGreaterThan(0);
  });
  it("草稿存在时失败不丢弃，仍可导出", async () => {
    const onAction = vi.fn();
    const fallbackSnapshot: typeof baseSnapshot = {
      ...baseSnapshot,
      selected: {
        ...baseSnapshot.selected!,
        contents: {
          working: {
            content: undefined,
            truncated: true,
            readError: "内容截断",
          },
        },
      },
    };
    render(ConflictsModule, { snapshot: fallbackSnapshot, onAction });
    await screen.findByTestId("content-fallback-warning");
    expect(screen.getAllByText(/草稿/).length).toBeGreaterThan(0);
    const exportBtn = screen.getAllByText("导出草稿")[0];
    await fireEvent.click(exportBtn as HTMLElement);
    expect(onAction).toHaveBeenCalledWith("conflict/draft-export", {
      relativePath: "src/a.ts",
    });
  });
});
