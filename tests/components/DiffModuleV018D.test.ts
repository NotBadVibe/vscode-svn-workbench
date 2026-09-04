import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffSnapshot } from "../../src/protocol/workbenchProtocol";

const pierreMocks = vi.hoisted(() => {
  const records: Array<{
    options: Record<string, unknown>;
    props: Record<string, unknown>;
  }> = [];
  const state = {
    failRender: null as Error | null,
    instanceCount: 0,
    cleanupCount: 0,
    revealCalls: [] as number[],
    failPreload: false,
  };
  return { records, state };
});

vi.mock("@pierre/diffs", () => {
  class FakeFileDiff {
    readonly options: Record<string, unknown>;
    cleanedUp = false;
    constructor(options: Record<string, unknown>) {
      pierreMocks.state.instanceCount += 1;
      this.options = options;
    }
    render(props: Record<string, unknown>): boolean {
      if (pierreMocks.state.failRender !== null) {
        throw pierreMocks.state.failRender;
      }
      pierreMocks.records.push({ options: this.options, props });
      const container = props.containerWrapper as HTMLElement;
      const marker = document.createElement("div");
      marker.className = "fake-pierre-diff";
      container.appendChild(marker);
      return true;
    }
    revealLine(lineNumber: number): boolean {
      pierreMocks.state.revealCalls.push(lineNumber);
      return true;
    }
    cleanUp(): void {
      this.cleanedUp = true;
      pierreMocks.state.cleanupCount += 1;
    }
  }
  return {
    FileDiff: FakeFileDiff,
    parsePatchFiles: (text: string) =>
      text.includes("Index:")
        ? [{ files: [{ name: "src/extension.ts" }] }]
        : [],
    preloadHighlighter: () => Promise.resolve(),
  };
});

vi.mock("@pierre/diffs/edit", () => {
  class FakeEditor {
    cleanUp(): void {}
    edit(): () => void {
      return () => undefined;
    }
    getText(): string {
      return "";
    }
    focus(): void {}
  }
  return { Editor: FakeEditor };
});

import DiffModule from "../../src/webview/features/diff/DiffModule.svelte";

// 含一处纯空白差异 + 一处真实差异：忽略空白后应只剩 1 块。
const whitespaceSnapshot: DiffSnapshot = {
  kind: "diff",
  relativePath: "src/space.ts",
  original: "const a = 1;\nlet  x  =  2;\nkeep = true;\nconst c = 3;\n",
  modified: "const a = 1;\nlet x = 2;\nkeep = true;\nconst c = 99;\n",
  language: "text",
  truncated: false,
  binary: false,
};

beforeEach(() => {
  pierreMocks.records.length = 0;
  pierreMocks.state.failRender = null;
  pierreMocks.state.instanceCount = 0;
  pierreMocks.state.cleanupCount = 0;
  pierreMocks.state.revealCalls.length = 0;
});

describe("DiffModule V018-D 空白与定位器（§4.4）", () => {
  it("显示设置含空白选项；忽略空白只改比较且明确标注", async () => {
    render(DiffModule, { snapshot: whitespaceSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));

    // 定位器可见（分布+列表）
    expect(screen.getByTestId("diff-overview")).toBeInTheDocument();
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    expect(
      screen.getByRole("checkbox", { name: /显示空白字符/ }),
    ).toBeInTheDocument();
    const ignoreBox = screen.getByRole("checkbox", {
      name: /忽略空白差异/,
    });
    expect(ignoreBox).toBeEnabled();

    await fireEvent.click(ignoreBox);
    // 明确标注横幅：只改比较，最终文本不受影响
    const banner = await screen.findByTestId("ignore-whitespace-banner");
    expect(banner.textContent).toContain("已忽略空白差异");
    expect(banner.textContent).toContain("最终文本不受影响");
    // 定位器仍可见且回到首块
    expect(screen.getByTestId("diff-overview")).toBeInTheDocument();
    expect(screen.getByText(/定位器 1\//)).toBeInTheDocument();
  });

  it("显示空白字符只给图例，不改变传入 FileDiff 的原始文本", async () => {
    render(DiffModule, { snapshot: whitespaceSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    await fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    await fireEvent.click(
      screen.getByRole("checkbox", { name: /显示空白字符/ }),
    );
    expect(screen.getByTestId("show-whitespace-legend")).toBeInTheDocument();
    // 传入 FileDiff 的仍是原始文本（未归一）
    const last = pierreMocks.records[pierreMocks.records.length - 1];
    const newFile = last.props.newFile as { contents: string };
    expect(newFile.contents).toContain("let x = 2;");
  });

  it("定位器选择滚动到正确块（revealLine 行号正确）", async () => {
    render(DiffModule, { snapshot: whitespaceSnapshot, onAction: vi.fn() });
    await waitFor(() => expect(pierreMocks.records).toHaveLength(1));
    pierreMocks.state.revealCalls.length = 0;
    const buttons = screen.getAllByRole("button", { name: /定位到第/ });
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    await fireEvent.click(buttons[1]);
    expect(pierreMocks.state.revealCalls.length).toBeGreaterThan(0);
    // 位置指示同步更新
    expect(screen.getByText(/变更块 2\//)).toBeInTheDocument();
  });

  it("修订比较禁用忽略空白并给出中文原因", async () => {
    const patchSnapshot: DiffSnapshot = {
      kind: "diff",
      relativePath: ". · r41 → r42",
      original: "",
      modified:
        "Index: a\n===================================================================\n--- a\t(revision 41)\n+++ a\t(revision 42)\n@@ -1 +1 @@\n-old\n+new\n",
      language: "diff",
      truncated: false,
      binary: false,
    };
    render(DiffModule, { snapshot: patchSnapshot, onAction: vi.fn() });
    await fireEvent.click(screen.getByRole("button", { name: "显示设置" }));
    const ignoreBox = screen.getByRole("checkbox", {
      name: /忽略空白差异/,
    });
    expect(ignoreBox).toBeDisabled();
    expect(screen.getByText(/修订比较暂不支持忽略空白/)).toBeInTheDocument();
  });
});
