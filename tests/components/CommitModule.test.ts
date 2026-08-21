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
    // 批次 C：确认提交先打开通用操作意向单对话框
    await fireEvent.click(screen.getByRole("button", { name: /确认提交/ }));
    expect(
      screen.getByRole("dialog", { name: "提交 1 个文件" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "提交 1 个文件 · 执行前将重新校验范围、文件状态与远端更新",
      ),
    ).toBeInTheDocument();
    // 对话框内影响清单可搜索/复制（复用 PreviewPathList）
    expect(screen.getByPlaceholderText("路径…")).toBeInTheDocument();
    // 通过对话框确认后才携带 token 执行
    const dialog = screen.getByRole("dialog", { name: "提交 1 个文件" });
    const confirmInDialog = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("确认提交"),
    ) as HTMLElement;
    expect(confirmInDialog).toBeInTheDocument();
    await fireEvent.click(confirmInDialog);
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

    expect(screen.getByText(/来源：模型建议/)).toBeInTheDocument();
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

    // v0.0.10：列表结果数量也是 role=status，反馈断言改为按文本定位。
    expect(
      screen
        .getAllByRole("status")
        .some((node) =>
          node.textContent?.includes(
            "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
          ),
        ),
    ).toBe(true);
  });
});

describe("CommitModule 提交说明建议草稿（v0.0.9 §4）", () => {
  const suggestion = {
    token: "suggestion-token-1",
    message: "feat(core): update flow\n\n影响：涉及核心流程\n风险：低",
    source: "configured-model" as const,
    model: "deepseek-v4-flash",
    metadataOnly: false,
    diffMode: "metadata-only" as const,
    warnings: [],
    binding: {
      repositoryUuid: "uuid-1",
      scopeHash: "scope-1",
      candidateHash: "candidates-1",
      generatedAt: "2026-07-30T10:00:00.000Z",
      model: "deepseek-v4-flash",
    },
  };

  function renderWithSuggestion(overrides: Partial<CommitSnapshot> = {}) {
    return renderCommit({ messageSuggestion: suggestion, ...overrides });
  }

  it("建议草稿只展示在建议区，不覆盖主草稿输入框", () => {
    renderWithSuggestion();
    expect(
      screen.getByRole("region", { name: "提交说明建议草稿" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("建议草稿（不覆盖当前提交说明）"),
    ).toBeInTheDocument();
    // 主草稿仍是用户已填内容，未被建议替换。
    expect(screen.getByLabelText("提交说明")).toHaveValue("feat(core): update");
    // 来源与“仅文件信息”声明可见。
    expect(screen.getByText(/来源：模型建议/)).toBeInTheDocument();
    expect(
      screen.getByText(/生成输入仅包含文件信息与差异统计，不能证明具体行为/),
    ).toBeInTheDocument();
  });

  it("展示与当前草稿的行级差异", () => {
    renderWithSuggestion();
    expect(screen.getByText("与当前草稿的差异")).toBeInTheDocument();
    expect(screen.getByText("建议新增（4 行）")).toBeInTheDocument();
    expect(screen.getByText("替换将移除（1 行）")).toBeInTheDocument();
  });

  it("插入空白字段：本地合并后发送 adopt-suggestion（insert-blank-fields）", async () => {
    const onAction = renderWithSuggestion();
    await fireEvent.click(screen.getByRole("button", { name: "插入空白字段" }));
    expect(onAction).toHaveBeenCalledWith("commit/adopt-suggestion", {
      token: "suggestion-token-1",
      mode: "insert-blank-fields",
      currentMessage: expect.any(String),
    });
  });

  it("替换草稿：按钮显示字符数，确认框写明前后字符数", async () => {
    const onAction = renderWithSuggestion();
    await fireEvent.click(
      screen.getByRole("button", { name: "替换草稿（39 字符）" }),
    );
    const dialog = screen.getByRole("alertdialog", {
      name: "确认替换提交说明",
    });
    expect(dialog).toBeInTheDocument();
    const confirmText = dialog.querySelector("strong")?.textContent ?? "";
    expect(confirmText).toContain("当前 18 字符");
    expect(confirmText).toContain("39 字符");
    await fireEvent.click(
      screen.getByRole("button", { name: "确认替换（39 字符）" }),
    );
    expect(onAction).toHaveBeenCalledWith("commit/adopt-suggestion", {
      token: "suggestion-token-1",
      mode: "replace",
      currentMessage: "feat(core): update",
    });
  });

  it("确认框“不替换”关闭且不发送采用动作", async () => {
    const onAction = renderWithSuggestion();
    await fireEvent.click(
      screen.getByRole("button", { name: "替换草稿（39 字符）" }),
    );
    await fireEvent.click(screen.getByRole("button", { name: "不替换" }));
    expect(
      screen.queryByRole("alertdialog", { name: "确认替换提交说明" }),
    ).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalledWith(
      "commit/adopt-suggestion",
      expect.anything(),
    );
  });

  it("复制建议与放弃分别发送对应动作", async () => {
    const onAction = renderWithSuggestion();
    await fireEvent.click(screen.getByRole("button", { name: "复制建议" }));
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: suggestion.message,
    });
    await fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(onAction).toHaveBeenCalledWith("commit/discard-suggestion", {
      token: "suggestion-token-1",
    });
  });

  it("过期建议只读：插入与替换禁用，仍可复制与放弃", async () => {
    const onAction = renderWithSuggestion({
      messageSuggestion: { ...suggestion, stale: true },
    });
    expect(screen.getByText("已过期")).toBeInTheDocument();
    expect(
      screen.getByText(
        /范围或候选已变化，该建议只能查看，不能直接采用；当前提交说明保持不变/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "插入空白字段" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "替换草稿（39 字符）" }),
    ).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "复制建议" }));
    expect(onAction).toHaveBeenCalledWith("copy-text", {
      text: suggestion.message,
    });
    await fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(onAction).toHaveBeenCalledWith("commit/discard-suggestion", {
      token: "suggestion-token-1",
    });
  });

  it("替换后反馈包含“已用建议替换提交说明”时提供撤销替换入口", async () => {
    const onAction = renderWithSuggestion({
      feedback: {
        tone: "success",
        message: "已用建议替换提交说明；可撤销替换恢复原内容。",
      },
    });
    await fireEvent.click(screen.getByRole("button", { name: "撤销替换" }));
    expect(onAction).toHaveBeenCalledWith("commit/undo-suggestion-replace");
  });

  it("本地回退建议标记“基于文件信息”占位", () => {
    renderWithSuggestion({
      messageSuggestion: {
        ...suggestion,
        source: "local-rule-fallback",
        metadataOnly: true,
      },
    });
    expect(
      screen.getByText(/基于文件信息生成，未读取差异正文/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/来源：模型不可用，已保留本地结果/),
    ).toBeInTheDocument();
  });
});

describe("CommitModule 受限差异外发回执（v0.0.11 §3）", () => {
  const receipt = {
    token: "receipt-token-1",
    receipt: {
      task: "commit-draft" as const,
      projectId: "project-1",
      model: "deepseek-v4-flash",
      dataTypes: ["项目内相对路径、SVN 状态、脱敏差异片段"],
      files: 1,
      totalBudget: 40000,
      perFileBudget: 6000,
      historyIncluded: false,
    },
    coverage: {
      total: 2,
      analyzed: 1,
      truncated: 1,
      binary: 0,
      readFailed: 0,
      budgetExcluded: 0,
    },
    files: [
      {
        candidateId: "cand-a",
        projectRelativePath: "src/a.ts" as never,
        status: "modified",
        state: "analyzed" as const,
        diffHash: "deadbeef",
        charCount: 320,
        hunkCount: 2,
      },
      {
        candidateId: "cand-b",
        projectRelativePath: "dist/out.js" as never,
        status: "modified",
        state: "truncated" as const,
        diffHash: "deadbeef",
        charCount: 6000,
        hunkCount: 1,
        reason: "差异超过单文件预算，已截断",
      },
    ],
    excludedCount: 1,
    historyIncluded: false,
    notSent: ["本地绝对路径（只发送项目内相对路径）", "范围外文件内容"],
    retentionNote:
      "数据保留策略由模型服务商策略决定，本插件无法证明其保留期限。",
  };

  function renderWithReceipt(overrides: Record<string, unknown> = {}) {
    const onAction = vi.fn();
    render(CommitModule, {
      snapshot,
      onAction,
      commitReceipt: { ...receipt, ...overrides },
    });
    return onAction;
  }

  it("展示回执（任务/模型/预算/覆盖率/排除文件），不显示建议", () => {
    renderWithReceipt();
    expect(
      screen.getByRole("region", { name: "受限差异外发回执" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("受限差异外发回执（尚未发送）"),
    ).toBeInTheDocument();
    expect(screen.getByText("提交说明（commit-draft）")).toBeInTheDocument();
    expect(screen.getByText("deepseek-v4-flash")).toBeInTheDocument();
    expect(
      screen.getByText(/单文件 6000 字符 \/ 总计 40000 字符/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/已分析 1 · 截断 1 · 二进制 0 · 读取失败 0 · 预算外 0/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/数据保留策略由模型服务商策略决定/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "提交说明建议草稿" }),
    ).not.toBeInTheDocument();
  });

  it("可展开包含 / 排除文件清单", async () => {
    const onAction = renderWithReceipt();
    // 回执文件清单收起时不在 DOM，对话框隐藏清单不计入此断言
    expect(document.querySelector(".commit-receipt__files")).toBeNull();
    expect(screen.queryByText("dist/out.js")).not.toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "展开包含 / 排除文件清单" }),
    );
    const files = document.querySelector(
      ".commit-receipt__files",
    ) as HTMLElement;
    expect(files).toBeInTheDocument();
    expect(files.textContent).toContain("src/a.ts");
    expect(files.textContent).toContain("dist/out.js");
    expect(onAction).not.toHaveBeenCalled();
  });

  it("“开始模型生成”携带回执 token 与受限差异模式", async () => {
    const onAction = renderWithReceipt();
    await fireEvent.click(screen.getByRole("button", { name: "开始模型生成" }));
    expect(onAction).toHaveBeenCalledWith("commit/generate-message", {
      selectedPaths: ["src/a.ts"],
      message: "feat(core): update",
      diffMode: "limited-diff",
      receiptToken: "receipt-token-1",
    });
  });

  it("“继续仅文件信息”先放弃回执再按仅文件信息生成", async () => {
    const onAction = renderWithReceipt();
    await fireEvent.click(
      screen.getByRole("button", { name: "继续仅文件信息" }),
    );
    expect(onAction).toHaveBeenCalledWith("commit/receipt-dismiss", {
      token: "receipt-token-1",
    });
    expect(onAction).toHaveBeenCalledWith("commit/generate-message", {
      selectedPaths: ["src/a.ts"],
      message: "feat(core): update",
      diffMode: "metadata-only",
    });
  });

  it("“放弃”只放弃回执，不调用模型", async () => {
    const onAction = renderWithReceipt();
    await fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(onAction).toHaveBeenCalledWith("commit/receipt-dismiss", {
      token: "receipt-token-1",
    });
    expect(onAction).not.toHaveBeenCalledWith(
      "commit/generate-message",
      expect.anything(),
    );
  });

  it("选择“含差异（需确认）”后点击生成走 preview-receipt", async () => {
    const onAction = renderCommit();
    await fireEvent.change(screen.getByLabelText("生成输入模式"), {
      target: { value: "limited-diff" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "生成建议草稿" }));
    expect(onAction).toHaveBeenCalledWith("commit/preview-receipt", {
      selectedPaths: ["src/a.ts"],
      message: "feat(core): update",
    });
  });

  it("默认“仅文件信息”点击生成直接 generate-message（metadata-only）", async () => {
    const onAction = renderCommit();
    await fireEvent.click(screen.getByRole("button", { name: "生成建议草稿" }));
    expect(onAction).toHaveBeenCalledWith("commit/generate-message", {
      selectedPaths: ["src/a.ts"],
      message: "feat(core): update",
      diffMode: "metadata-only",
    });
  });
});

describe("CommitModule 有证据的提交说明（v0.0.11 §4）", () => {
  const evidenceSuggestion = {
    token: "suggestion-token-2",
    message: "变更：src/a.ts 的行为调整",
    source: "configured-model" as const,
    model: "deepseek-v4-flash",
    metadataOnly: false,
    diffMode: "limited-diff" as const,
    coverage: {
      total: 2,
      analyzed: 1,
      truncated: 1,
      binary: 0,
      readFailed: 1,
      budgetExcluded: 0,
    },
    coverageFiles: [
      {
        candidateId: "cand-a",
        projectRelativePath: "src/a.ts" as never,
        status: "modified",
        state: "analyzed" as const,
        diffHash: "deadbeef",
        charCount: 320,
        hunkCount: 2,
      },
      {
        candidateId: "cand-failed",
        projectRelativePath: "src/db.ts" as never,
        status: "modified",
        state: "readFailed" as const,
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: "svn diff 读取失败",
      },
    ],
    evidence: [
      {
        reference: {
          candidateId: "cand-a",
          hunkId: "hunk-1",
          projectRelativePath: "src/a.ts",
        },
        valid: true,
      },
      {
        reference: {
          candidateId: "cand-ghost",
          projectRelativePath: "src/ghost.ts",
        },
        valid: false,
        reason: "引用了未授权或范围外文件，已丢弃",
      },
    ],
    claims: [
      {
        text: "src/a.ts：修改了 2 处差异块，具体行为见证据。",
        status: "confirmed" as const,
        downgraded: false,
        evidence: [
          {
            candidateId: "cand-a",
            hunkId: "hunk-1",
            projectRelativePath: "src/a.ts",
          },
        ],
        invalidEvidence: [],
      },
      {
        text: "src/db.ts 的改动无法判断具体行为。",
        status: "toConfirm" as const,
        downgraded: true,
        evidence: [],
        invalidEvidence: [
          {
            reference: {
              candidateId: "cand-ghost",
              projectRelativePath: "src/ghost.ts",
            },
            reason: "引用了未授权或范围外文件，已丢弃",
          },
        ],
      },
    ],
    warnings: [],
    binding: {
      repositoryUuid: "uuid-1",
      scopeHash: "scope-1",
      candidateHash: "candidates-1",
      generatedAt: "2026-07-30T10:00:00.000Z",
      model: "deepseek-v4-flash",
    },
  };

  it("展示差异覆盖率与证据引用（有效 + 无效原因）", () => {
    renderCommit({ messageSuggestion: evidenceSuggestion });
    expect(
      screen.getByText(/差异覆盖率：已分析 1 · 截断 1/),
    ).toBeInTheDocument();
    expect(screen.getByText("证据引用（1 条有效）")).toBeInTheDocument();
    const evidenceList = screen.getByRole("list", {
      name: "建议证据引用",
    });
    expect(evidenceList.textContent).toContain("src/a.ts");
    expect(evidenceList.textContent).toContain("差异块已验证");
    expect(evidenceList.textContent).toContain("src/ghost.ts");
    expect(evidenceList.textContent).toContain(
      "引用了未授权或范围外文件，已丢弃",
    );
  });

  it("仅文件信息建议不展示覆盖率与证据", () => {
    renderCommit({
      messageSuggestion: {
        ...evidenceSuggestion,
        diffMode: "metadata-only",
        metadataOnly: true,
        coverage: undefined,
        evidence: undefined,
      },
    });
    expect(screen.queryByText(/差异覆盖率：已分析/)).not.toBeInTheDocument();
    expect(screen.queryByText(/证据引用/)).not.toBeInTheDocument();
  });

  it("有效证据提供“打开差异”入口，发送 open-evidence", async () => {
    const onAction = renderCommit({
      messageSuggestion: evidenceSuggestion,
    });
    await fireEvent.click(
      screen.getAllByRole("button", { name: "打开差异" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("commit/open-evidence", {
      token: "suggestion-token-2",
      candidateId: "cand-a",
      hunkId: "hunk-1",
      projectRelativePath: "src/a.ts",
    });
  });

  it("逐文件覆盖情况展示失败项，并提供重试失败项入口", async () => {
    const onAction = renderCommit({
      messageSuggestion: evidenceSuggestion,
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "重试失败项（1）" }),
    );
    expect(onAction).toHaveBeenCalledWith("commit/retry-failed-diff", {
      token: "suggestion-token-2",
    });
    const coverageList = screen.getByRole("list", {
      name: "建议逐文件覆盖情况",
    });
    expect(coverageList.textContent).toContain("src/a.ts");
    expect(coverageList.textContent).toContain("src/db.ts");
    expect(coverageList.textContent).toContain("读取失败");
  });

  it("过期建议禁用打开差异且不显示重试入口", () => {
    renderCommit({
      messageSuggestion: { ...evidenceSuggestion, stale: true },
    });
    for (const openButton of screen.getAllByRole("button", {
      name: "打开差异",
    })) {
      expect(openButton).toBeDisabled();
    }
    expect(
      screen.queryByRole("button", { name: "重试失败项（1）" }),
    ).not.toBeInTheDocument();
  });

  it("逐条说明展示状态、降级标记与逐条证据（可打开差异）", async () => {
    const onAction = renderCommit({
      messageSuggestion: evidenceSuggestion,
    });
    const claimList = screen.getByRole("list", { name: "建议逐条说明" });
    expect(claimList.textContent).toContain("已证实");
    expect(claimList.textContent).toContain("待确认");
    expect(claimList.textContent).toContain("已降级");
    expect(claimList.textContent).toContain("src/a.ts");
    // 逐条证据的“打开差异”发送 open-evidence。
    await fireEvent.click(
      screen.getAllByRole("button", { name: "打开差异" })[0],
    );
    expect(onAction).toHaveBeenCalledWith("commit/open-evidence", {
      token: "suggestion-token-2",
      candidateId: "cand-a",
      hunkId: "hunk-1",
      projectRelativePath: "src/a.ts",
    });
  });

  it("仅文件信息建议不展示逐条说明", () => {
    renderCommit({
      messageSuggestion: {
        ...evidenceSuggestion,
        diffMode: "metadata-only",
        metadataOnly: true,
        coverage: undefined,
        coverageFiles: undefined,
        evidence: undefined,
        claims: undefined,
      },
    });
    expect(
      screen.queryByRole("list", { name: "建议逐条说明" }),
    ).not.toBeInTheDocument();
  });
});
