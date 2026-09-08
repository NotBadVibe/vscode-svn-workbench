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

  /*
   * V022-R33：空表单先提示再校验 + composition 保护。
   */
  it("空表单初始只显示中性写作提示，不展示字段错误", () => {
    renderEditor({ message: "", messageIssues: ["提交说明不能为空"] });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/先简要说明改动意图/)).toBeInTheDocument();
  });

  it("空表单失焦后显示字段错误", async () => {
    renderEditor({ message: "", messageIssues: ["提交说明不能为空"] });
    expect(screen.queryByRole("alert")).toBeNull();
    await fireEvent.blur(screen.getByLabelText("提交说明"));
    expect(screen.getByRole("alert")).toHaveTextContent("提交说明不能为空");
  });

  it("父模块已请求预览时空表单直接显示字段错误", () => {
    const onApplyTemplate = vi.fn();
    const onDraftUpdate = vi.fn();
    const onPreviewRequest = vi.fn();
    render(CommitMessageEditor, {
      message: "",
      templates: [],
      messageIssues: ["提交说明不能为空"],
      conventionHint: undefined,
      forceShowValidation: true,
      onApplyTemplate,
      onDraftUpdate,
      onPreviewRequest,
    });
    expect(screen.getByRole("alert")).toHaveTextContent("提交说明不能为空");
  });

  it("有内容时规范问题始终立即展示", () => {
    renderEditor({ message: "wip", messageIssues: ["缺少工单号前缀"] });
    expect(screen.getByRole("alert")).toHaveTextContent("缺少工单号前缀");
  });

  it("中文 IME 候选阶段不同步草稿，组合结束后一次性同步", async () => {
    const { onDraftUpdate } = renderEditor({ message: "" });
    const textarea = screen.getByLabelText("提交说明");
    await fireEvent.compositionStart(textarea);
    await fireEvent.input(textarea, { target: { value: "修复" } });
    expect(onDraftUpdate).not.toHaveBeenCalled();
    await fireEvent.compositionEnd(textarea);
    expect(onDraftUpdate).toHaveBeenLastCalledWith("修复");
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

  /*
   * V020-R02：输入框布局归属组件自身容器 `.commit-message-editor`，
   * 不再依赖 v0.1.4 重构后已不存在的 `.commit-compose` 祖先类
   * （global.css 该规则失效曾使 textarea 回退到 UA 默认小尺寸）。
   * 本用例断言 DOM 归属契约；宽 100%/最小高 150px/纵向可调的像素级
   * 证明由 tests/webview-e2e/v020r02-commit-editor-size.spec.ts
   * 以真实视口盒模型断言（jsdom 不注入 Svelte scoped 样式）。
   */
  it("输入框挂在组件自身容器下，不依赖已失效的祖先类", () => {
    const { container } = renderEditor();
    const textarea = screen.getByLabelText("提交说明");
    // 组件自身容器存在且直接承载输入框（布局归属本组件）。
    const editor = textarea.closest(".commit-message-editor");
    expect(editor).toBeTruthy();
    // 渲染路径上不再出现已失效的祖先类（失效选择器无匹配）。
    expect(container.querySelector(".commit-compose")).toBeNull();
    // textarea 关键行为属性不受影响：2000 字符上限与可访问名称。
    expect(textarea).toHaveAttribute("maxlength", "2000");
  });
});
