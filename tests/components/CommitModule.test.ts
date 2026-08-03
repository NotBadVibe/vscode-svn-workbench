import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import type { CommitSnapshot } from "../../src/protocol/workbenchProtocol";

const snapshot: CommitSnapshot = {
  kind: "commit",
  files: [
    { relativePath: "src/a.ts", status: "modified", selection: "selected" },
    {
      relativePath: "dist/out.js",
      status: "unversioned",
      selection: "excluded",
    },
  ],
  summary: { total: 2, selected: 1, needsReview: 0, excluded: 1, blocked: 0 },
  selectedPaths: ["src/a.ts"],
  message: "feat(core): update",
  messageIssues: [],
  conventionHint: "前缀：feat",
  aiPrivacy: [
    {
      scenario: "selection",
      model: "local",
      fileLimit: 200,
      data: "metadata",
      historyIncluded: false,
    },
    {
      scenario: "message",
      model: "local",
      fileLimit: 80,
      data: "statistics",
      historyIncluded: false,
    },
  ],
  templates: [{ id: "feature", label: "需求开发", body: "需求: " }],
  preview: {
    token: "preview-1",
    canExecute: true,
    selectedPaths: ["src/a.ts"],
    addPaths: [],
    removePaths: [],
    commands: ['svn commit "src/a.ts" -F <message-file>'],
    issues: [],
    outOfDatePaths: [],
    createdAt: "2026-07-30T10:00:00.000Z",
  },
};

describe("CommitModule", () => {
  it("keeps excluded files disabled and executes only with the preview token", async () => {
    const onAction = vi.fn();
    render(CommitModule, { snapshot, onAction });

    expect(screen.getByLabelText("选择 dist/out.js")).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "确认提交" }));
    expect(onAction).toHaveBeenCalledWith("commit/execute", {
      previewToken: "preview-1",
    });
  });

  it("opens diff without toggling the file selection", async () => {
    const onAction = vi.fn();
    render(CommitModule, { snapshot, onAction });
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 差异" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-diff", {
      relativePath: "src/a.ts",
    });
  });

  it("中文输入法选词期间 Ctrl+Enter 不生成提交预览", async () => {
    const onAction = vi.fn();
    render(CommitModule, { snapshot, onAction });
    const input = screen.getByLabelText("提交说明");
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composing, "isComposing", { value: true });
    input.dispatchEvent(composing);
    expect(onAction).not.toHaveBeenCalledWith(
      "commit/preview",
      expect.anything(),
    );

    await fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith("commit/preview", {
      selectedPaths: ["src/a.ts"],
      message: "feat(core): update",
    });
  });
});
