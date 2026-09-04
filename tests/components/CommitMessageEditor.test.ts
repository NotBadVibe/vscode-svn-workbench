import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CommitMessageEditor from "../../src/webview/features/commit/CommitMessageEditor.svelte";

/*
 * v0.1.6 V016-E CommitMessageEditor：提交说明编辑区独立组件。
 * - state 仍由父模块权威（`bind:message` 受控展示 + 事件透传）；
 *   本文件覆盖 IME/字数/模板应用/issue 展示四项契约。
 */

function renderEditor(
  overrides: Partial<{
    message: string;
    messageIssues: string[];
    conventionHint: string | undefined;
  }> = {},
) {
  const onApplyTemplate = vi.fn();
  const onDraftUpdate = vi.fn();
  const onPreviewRequest = vi.fn();
  const result = render(CommitMessageEditor, {
    message: "feat(core): update",
    templates: [{ id: "feature", label: "需求开发", body: "需求: " }],
    messageIssues: [],
    conventionHint: undefined,
    onApplyTemplate,
    onDraftUpdate,
    onPreviewRequest,
    ...overrides,
  });
  return { ...result, onApplyTemplate, onDraftUpdate, onPreviewRequest };
}

describe("CommitMessageEditor", () => {
  it("展示字数与快捷键说明", () => {
    renderEditor({ message: "abc" });
    expect(screen.getByText("3/2000 个字符")).toBeTruthy();
    expect(screen.getByText("按 Ctrl/⌘ + Enter 生成提交预览")).toBeTruthy();
  });

  it("模板按钮透传 templateId", async () => {
    const { onApplyTemplate } = renderEditor();
    await fireEvent.click(screen.getByRole("button", { name: "需求开发" }));
    expect(onApplyTemplate).toHaveBeenCalledWith("feature");
  });

  it("展示 messageIssues 与团队规范提示", () => {
    renderEditor({
      messageIssues: ["缺少工单号前缀"],
      conventionHint: "前缀：feat",
    });
    expect(screen.getByRole("alert")).toHaveTextContent("缺少工单号前缀");
    expect(screen.getByText("团队规范已加载")).toBeTruthy();
  });

  it("输入与失焦同步草稿给父模块", async () => {
    const { onDraftUpdate } = renderEditor();
    const textarea = screen.getByLabelText("提交说明");
    await fireEvent.input(textarea, { target: { value: "fix: typo" } });
    expect(onDraftUpdate).toHaveBeenLastCalledWith("fix: typo");
    await fireEvent.blur(textarea);
    expect(onDraftUpdate).toHaveBeenCalledTimes(2);
  });

  it("Ctrl+Enter 请求预览；IME 候选阶段 Enter 不触发", async () => {
    const { onPreviewRequest } = renderEditor();
    const textarea = screen.getByLabelText("提交说明");
    await fireEvent.keyDown(textarea, {
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    });
    expect(onPreviewRequest).not.toHaveBeenCalled();
    await fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    // keyCode 229（IME 候选）同样不触发。
    await fireEvent.keyDown(textarea, {
      key: "Enter",
      ctrlKey: true,
      keyCode: 229,
    });
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    // 普通 Enter（无组合键）不是显式提交快捷键。
    await fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
  });
});
