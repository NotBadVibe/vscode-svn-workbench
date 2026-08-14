import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import CommitModule from "../../src/webview/features/commit/CommitModule.svelte";
import type { CommitSnapshot } from "../../src/protocol/workbenchProtocol";

const snapshot: CommitSnapshot = {
  kind: "commit",
  files: [
    {
      relativePath: "src/a.ts",
      selectionKey: "test-wc::src/a.ts" as never,
      status: "modified",
      selection: "selected",
      evaluation: {
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
    },
    {
      relativePath: "dist/out.js",
      selectionKey: "test-wc::dist/out.js" as never,
      status: "unversioned",
      selection: "excluded",
      evaluation: {
        decision: "excluded",
        reasonKey: "pathRule",
        matchedRuleId: "builtin-dist",
        ruleSource: "builtin",
        safetyLocked: false,
      },
    },
  ],
  summary: { total: 2, selected: 1, needsReview: 0, excluded: 1, blocked: 0 },
  selectedPaths: ["src/a.ts"],
  message: "feat(core): update",
  messageIssues: [],
  conventionHint: "前缀：feat",
  selectionAi: { configured: true, model: "deepseek-v4-flash" },
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

function renderCommit(overrides: Partial<CommitSnapshot> = {}) {
  const onAction = vi.fn();
  render(CommitModule, { snapshot: { ...snapshot, ...overrides }, onAction });
  return onAction;
}

describe("CommitModule", () => {
  it("keeps excluded files disabled and executes only with the preview token", async () => {
    const onAction = renderCommit();

    expect(screen.getByLabelText("选择 dist/out.js")).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: /确认提交/ }));
    expect(onAction).toHaveBeenCalledWith("commit/execute", {
      previewToken: "preview-1",
    });
  });

  it("opens diff without toggling the file selection", async () => {
    const onAction = renderCommit();
    await fireEvent.click(
      screen.getByRole("button", { name: "查看 src/a.ts 差异" }),
    );
    expect(onAction).toHaveBeenCalledWith("open-diff", {
      relativePath: "src/a.ts",
    });
  });

  it("中文输入法选词期间 Ctrl+Enter 不生成提交预览", async () => {
    const onAction = renderCommit();
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

  it("始终提供“应用本地规则”，AI 已配置时提供“获取 AI 建议”", async () => {
    const onAction = renderCommit();

    await fireEvent.click(screen.getByRole("button", { name: "应用本地规则" }));
    expect(onAction).toHaveBeenCalledWith("commit/apply-local-rules");

    await fireEvent.click(screen.getByRole("button", { name: "获取 AI 建议" }));
    expect(onAction).toHaveBeenCalledWith("commit/ai-select");
    expect(
      screen.queryByRole("button", { name: /AI 建议选择/ }),
    ).not.toBeInTheDocument();
  });

  it("未配置 AI 时显示“配置 AI”入口并跳转设置 AI 标签", async () => {
    const onAction = renderCommit({
      selectionAi: { configured: false },
    });

    expect(
      screen.queryByRole("button", { name: "获取 AI 建议" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /AI 建议选择/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "应用本地规则" }),
    ).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "配置 AI" }));
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "settings",
      taskId: "settings/ai",
    });
  });

  it("未配置 AI 时不显示选择场景的外发预览", () => {
    renderCommit({ selectionAi: { configured: false } });
    expect(screen.queryByText(/最多 200 个文件/)).not.toBeInTheDocument();
  });

  it("AI 失败时保留当前选择并提供“应用本地规则”恢复动作", async () => {
    const onAction = renderCommit({
      ai: {
        source: "local-rule-fallback",
        summary: "AI 建议获取失败，已保留当前选择。",
        warnings: [],
        fallbackReason: "AI 服务连接超时。",
        failed: true,
      },
    });

    expect(
      screen.getByText("AI 建议获取失败，已保留当前选择。"),
    ).toBeInTheDocument();
    expect(screen.getByText(/来源：AI 失败/)).toBeInTheDocument();
    expect(screen.getByText(/失败原因：AI 服务连接超时。/)).toBeInTheDocument();
    // 当前选择不被失败结果替换。
    expect(screen.getByLabelText("选择 src/a.ts")).toBeChecked();

    // 工具栏与失败卡片各有一个“应用本地规则”；失败卡片上的为恢复动作。
    const recoverButtons = screen.getAllByRole("button", {
      name: "应用本地规则",
    });
    expect(recoverButtons).toHaveLength(2);
    await fireEvent.click(recoverButtons[1]);
    expect(onAction).toHaveBeenCalledWith("commit/apply-local-rules");
  });

  it("展示每个候选的最终决策、决策原因、命中规则及来源", () => {
    renderCommit();

    expect(
      screen.getByText("推荐提交 · 按状态默认策略：已修改"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("排除 · 命中路径规则 builtin-dist（内置默认）"),
    ).toBeInTheDocument();
  });

  it("安全锁定结果同时以文字表达", () => {
    renderCommit({
      files: [
        {
          relativePath: "src/conflict.ts",
          status: "conflicted",
          selection: "blocked",
          evaluation: {
            decision: "blocked",
            reasonKey: "safetyBlocked",
            safetyLocked: true,
          },
        },
      ],
      summary: {
        total: 1,
        selected: 0,
        needsReview: 0,
        excluded: 0,
        blocked: 1,
      },
      selectedPaths: [],
    });

    expect(
      screen.getByText("阻止提交 · 安全规则：始终阻止提交 · 安全锁定"),
    ).toBeInTheDocument();
  });

  it("摘要分别统计推荐、待确认、排除与阻止数量", () => {
    renderCommit();

    expect(screen.getByText("推荐 1")).toBeInTheDocument();
    expect(screen.getByText("待确认 0")).toBeInTheDocument();
    expect(screen.getByText("排除 1")).toBeInTheDocument();
    expect(screen.getByText("阻止 0")).toBeInTheDocument();
  });

  it("AI 成功结果展示来源、模型与生成时间", () => {
    renderCommit({
      ai: {
        source: "configured-model",
        summary: "建议选择 1 个文件。",
        warnings: [],
        binding: {
          repositoryUuid: "uuid-1",
          scopeHash: "scope-1",
          candidateHash: "candidates-1",
          generatedAt: "2026-07-30T10:00:00.000Z",
          model: "deepseek-v4-flash",
        },
      },
    });

    expect(screen.getByText(/来源：已配置模型/)).toBeInTheDocument();
    expect(screen.getByText(/模型 deepseek-v4-flash/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-30 18:00/)).toBeInTheDocument();
  });

  it("AI 结果过期时标记已过期且不能直接采用", () => {
    renderCommit({
      ai: {
        source: "configured-model",
        summary: "建议选择 1 个文件。",
        warnings: [],
        stale: true,
        binding: {
          repositoryUuid: "uuid-1",
          scopeHash: "scope-1",
          candidateHash: "candidates-1",
          generatedAt: "2026-07-30T10:00:00.000Z",
          model: "deepseek-v4-flash",
        },
      },
    });

    expect(screen.getByText(/结果已过期/)).toBeInTheDocument();
    expect(
      screen.getByText(/只能查看，不能直接采用；请重新获取 AI 建议。/),
    ).toBeInTheDocument();
  });

  it("渲染一次性反馈（规则更新提示与应用本地规则结果）", () => {
    renderCommit({
      feedback: {
        tone: "warning",
        message:
          "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
      },
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
    );
  });
});
