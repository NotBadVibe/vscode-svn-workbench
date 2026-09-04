import { render, screen, fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

vi.mock("@pierre/diffs", async () => {
  const a: Record<string, unknown> = await vi.importActual("@pierre/diffs");
  return a;
});

function buildBlocks(count: number): string {
  const parts: string[] = ["// header-do-not-merge"];
  for (let n = 1; n <= count; n++) {
    parts.push(
      `<<<<<<< .mine\nmy-block-${n}-local\n||||||| .r100\nbase-block-${n}\n=======\ntheir-block-${n}-remote\n>>>>>>> .r101`,
    );
  }
  parts.push("// footer-end");
  return parts.join("\n");
}

function snapshotFor(workingContent: string): ConflictSnapshot {
  return {
    kind: "conflicts",
    conflicts: [{ relativePath: "src/a.ts", type: "text" }],
    selected: {
      relativePath: "src/a.ts",
      contents: {
        working: { content: workingContent, truncated: false },
      },
      mergeEditor: { token: "edit-1", editable: true, issues: [] },
      draft: {
        content: workingContent,
        revision: 2,
        updatedAt: Date.now(),
        hasDraft: true,
        dirty: true,
      },
    },
  } as unknown as ConflictSnapshot;
}

describe("ConflictsModule V018-C 降级链", () => {
  it("精简档：长行触发原因可见/模式可见/草稿保留/可恢复完整视图", async () => {
    const onAction = vi.fn();
    const working = `<<<<<<< .mine\n${"x".repeat(5000)}\n=======\nremote\n>>>>>>> .r5\n`;
    render(ConflictsModule, { snapshot: snapshotFor(working), onAction });
    const summary = await screen.findByTestId("conflict-perf-summary");
    expect(summary).toBeInTheDocument();
    expect(screen.getByTestId("conflict-perf-mode")).toHaveTextContent(
      "精简视图",
    );
    // 草稿保留（Host 内存草稿文案仍可见）
    expect(screen.getAllByText(/草稿/).length).toBeGreaterThan(0);
    // 恢复出口：强制完整视图后摘要消失
    await fireEvent.click(screen.getByTestId("restore-full-perf"));
    expect(screen.queryByTestId("conflict-perf-summary")).toBeNull();
    // 回到降级视图可恢复
    await fireEvent.click(screen.getByTestId("restore-perf-perf"));
    expect(
      await screen.findByTestId("conflict-perf-summary"),
    ).toBeInTheDocument();
    // 降级链不触发写操作
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/save-working",
      expect.anything(),
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  });

  it("简化档：超行数显示简化出口，切换保留草稿不丢", async () => {
    const onAction = vi.fn();
    const blocks = buildBlocks(10);
    const filler = Array.from(
      { length: 10100 },
      (_, i) => `// filler ${i} 中文占位`,
    ).join("\n");
    const working = `${blocks}\n${filler}`;
    render(ConflictsModule, { snapshot: snapshotFor(working), onAction });
    const summary = await screen.findByTestId("conflict-perf-summary");
    expect(summary).toBeInTheDocument();
    expect(screen.getByTestId("conflict-perf-mode")).toHaveTextContent(
      "简化编辑器",
    );
    await fireEvent.click(screen.getByTestId("use-simplified-perf"));
    expect(
      await screen.findByTestId("simplified-fallback-notice"),
    ).toBeInTheDocument();
    // 草稿仍保留可导出/复制语义（文案可见），且不自动保存/解决
    expect(screen.getAllByText(/草稿/).length).toBeGreaterThan(0);
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/save-working",
      expect.anything(),
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  }, 30000);

  it("简化档：外部工具出口仅发起 open-file，不触发写操作", async () => {
    const onAction = vi.fn();
    const blocks = buildBlocks(10);
    const filler = Array.from(
      { length: 10100 },
      (_, i) => `// filler ${i} 中文占位`,
    ).join("\n");
    render(ConflictsModule, {
      snapshot: snapshotFor(`${blocks}\n${filler}`),
      onAction,
    });
    await screen.findByTestId("conflict-perf-summary");
    await fireEvent.click(screen.getByTestId("open-external-perf"));
    expect(onAction).toHaveBeenCalledWith(
      "open-file",
      expect.objectContaining({ relativePath: "src/a.ts" }),
    );
    expect(onAction).not.toHaveBeenCalledWith(
      "conflict/resolve",
      expect.anything(),
    );
  }, 30000);
});
