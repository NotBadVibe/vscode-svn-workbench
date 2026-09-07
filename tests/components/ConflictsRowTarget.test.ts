/* eslint-disable @typescript-eslint/no-unused-vars */
import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import ConflictsModule from "../../src/webview/features/conflicts/ConflictsModule.svelte";
import type { ConflictSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V020-R10 · 多个冲突点击非首个文件直接定位正确对象。
 * 列表点击即发送 conflict/select（Host 在原 scope 内复验，不扩大范围）。
 */

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
    constructor(_opts: unknown) {}
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

const snapshot: ConflictSnapshot = {
  kind: "conflicts",
  conflicts: [
    { relativePath: "src/conflict/a.ts", type: "text", operation: "update" },
    { relativePath: "src/conflict/b.ts", type: "text", operation: "update" },
  ],
  selected: {
    relativePath: "src/conflict/a.ts",
    contents: {
      working: { content: "merged", truncated: false },
    },
    mergeEditor: { token: "edit-1", editable: true, issues: [] },
  },
};

describe("V020-R10 冲突列表定位所点文件", () => {
  it("点击非首个冲突直接发送该文件选择", async () => {
    const onAction = vi.fn();
    render(ConflictsModule, { snapshot, onAction });

    await fireEvent.click(
      document.querySelector(
        'button.conflict-row[data-row-index="1"]',
      ) as HTMLElement,
    );
    expect(onAction).toHaveBeenCalledWith("conflict/select", {
      relativePath: "src/conflict/b.ts",
    });
  });
});
