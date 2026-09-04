/* eslint-disable @typescript-eslint/no-unused-vars */
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

// 与 ConflictsModule.test.ts 一致：jsdom 下 stub 差异引擎，聚焦页面行为。
vi.mock("@pierre/diffs", () => ({
  UnresolvedFile: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
  File: class {
    render() {
      return true;
    }
    cleanUp() {}
  },
}));
vi.mock("@pierre/diffs/edit", () => ({
  Editor: class {
    constructor(..._args: unknown[]) {}
    edit() {
      return () => {};
    }
    getText() {
      return "";
    }
    applyEdits() {}
    cleanUp() {}
    canUndo() {
      return false;
    }
    canRedo() {
      return false;
    }
    undo() {}
    redo() {}
    focus() {}
  },
}));
vi.mock("../../src/webview/features/diff/cspCompatObserver", () => ({
  observeDiffContainer: () => ({ disconnect: () => {} }),
  observeDiffShadowRoot: () => ({ disconnect: () => {} }),
  installDiffCspCompatibilityShim: () => {},
}));

const markedSnapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [{ relativePath: "src/a.ts", type: "text" }],
  selected: {
    relativePath: "src/a.ts",
    contents: {
      working: {
        content:
          "<<<<<<< .mine\nlocal  one\n=======\nremote one\n>>>>>>> .r5\nmid\n<<<<<<< .mine\nlocal two\n=======\nremote two\n>>>>>>> .r6\n",
        truncated: false,
      },
    },
    mergeEditor: { token: "edit-v018d", editable: true, issues: [] },
  },
};

describe("ConflictsModule V018-D 空白与定位器（§4.4）", () => {
  it("空白开关为纯呈现：切换不丢草稿/identity，不触发保存", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: markedSnapshot, onAction });
    // 定位器可见：2 块，未处理标记双通道
    expect(screen.getByTestId("diff-overview")).toBeInTheDocument();
    expect(screen.getAllByText(/未处理冲突/).length).toBeGreaterThanOrEqual(1);

    const showBox = screen.getByRole("checkbox", {
      name: /显示空白字符/,
    });
    const ignoreBox = screen.getByRole("checkbox", {
      name: /忽略空白差异/,
    });
    await fireEvent.click(showBox);
    expect(screen.getByTestId("show-whitespace-legend")).toBeInTheDocument();
    await fireEvent.click(ignoreBox);
    const banner = screen.getByTestId("ignore-whitespace-banner");
    expect(banner.textContent).toContain("已忽略空白差异");
    expect(banner.textContent).toContain("最终文本不受影响");

    // 无 Host 写操作：无 save-working / resolve / draft-update 误发
    const actions = onAction.mock.calls.map((c) => String(c[0]));
    expect(actions).not.toContain("conflict/save-working");
    expect(actions).not.toContain("conflict/resolve");
    // 草稿区仍在（identity/草稿未丢）
    expect(screen.getByTestId("diff-overview")).toBeInTheDocument();
  });

  it("定位器选择只做块导航，不发起 Host 动作", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: markedSnapshot, onAction });
    onAction.mockClear();
    const buttons = screen.getAllByRole("button", { name: /定位到第/ });
    expect(buttons.length).toBe(2);
    await fireEvent.click(buttons[1]);
    const actions = onAction.mock.calls.map((c) => String(c[0]));
    expect(actions).not.toContain("conflict/save-working");
    expect(actions).not.toContain("conflict/resolve");
  });

  it("定位器可折叠收起（小视口不占主编辑区）", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot: markedSnapshot, onAction });
    const toggle = screen.getByTestId("diff-overview-toggle");
    await fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("diff-overview-list")).toBeNull();
    await fireEvent.click(toggle);
    expect(screen.getByTestId("diff-overview-list")).toBeInTheDocument();
  });
});
