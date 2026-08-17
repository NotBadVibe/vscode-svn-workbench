import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SettingsModule from "../../src/webview/features/settings/SettingsModule.svelte";
import { naturalCompare } from "../../src/selection/selectionSort";
import type {
  CommitSelectionSettingsSection,
  SettingsSnapshot,
} from "../../src/protocol/workbenchProtocol";

const snapshot: SettingsSnapshot = {
  kind: "settings",
  svnSecurity: {
    authenticationActive: true,
    hasStoredAuthentication: true,
    passwordTransport: "stdin",
    certificateTrust: "explicit-svn-cache",
  },
  ai: {
    presets: [
      {
        id: "custom",
        label: "自定义",
        baseUrl: "",
        model: "",
        description: "",
      },
    ],
    scenarios: [],
    providerPreset: "custom",
    baseUrl: "https://ai.example/v1",
    model: "model-a",
    scenarioModels: {},
    hasApiKey: true,
    includeCommitHistory: false,
    historyLimit: 10,
    models: [],
  },
  team: {
    configPath: ".svn-workbench.json",
    enabled: false,
    requiredIssueId: false,
    issueIdPattern: "",
    requiredModule: false,
    allowedModulesText: "",
    requiredPrefix: false,
    allowedPrefixesText: "",
    warnings: [],
    memory: {
      source: "当前仓库成功提交",
      count: 1,
      maxEntries: 50,
      externallyShared: false,
      recent: [
        {
          revision: "8",
          summary: "feat: workbench",
          recordedAt: "2026-07-30T08:00:00.000Z",
        },
      ],
    },
  },
  selection: {
    editingScope: "repository",
    configPath: ".svn-workbench.json",
    layers: {
      user: { editable: false, state: "empty", errors: [], warnings: [] },
      workspace: { editable: false, state: "empty", errors: [], warnings: [] },
      repository: { editable: true, state: "empty", errors: [], warnings: [] },
    },
    effective: {
      statusRules: {
        modified: "recommended",
        added: "recommended",
        deleted: "recommended",
        replaced: "recommended",
        propertyModified: "recommended",
        missing: "needsReview",
        unversioned: "needsReview",
        unknown: "needsReview",
        normal: "excluded",
      },
      pathRules: [],
    },
    errors: [],
    warnings: [],
    preview: { state: "empty", items: [] },
  },
};

describe("SettingsModule", () => {
  it("不把已保存密钥回填到密码输入框，并把新密钥只作为保存动作发送", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    const key = screen.getByLabelText("API 密钥");
    expect(key).toHaveValue("");
    await fireEvent.input(key, { target: { value: "new-secret" } });
    await fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(onAction).toHaveBeenCalledWith(
      "settings/save-ai",
      expect.objectContaining({ apiKey: "new-secret" }),
    );
  });

  it("只显示 SVN 凭据状态并通过 Host 安全动作配置或清除", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    await fireEvent.click(screen.getByRole("tab", { name: "SVN 安全" }));
    expect(screen.queryByLabelText("SVN 密码")).not.toBeInTheDocument();
    expect(
      screen.getByText("VS Code 安全存储 / 系统凭据存储"),
    ).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "配置 SVN 认证" }),
    );
    expect(onAction).toHaveBeenCalledWith("security/configure-authentication");
  });

  it("显示团队记忆来源、数量并由 Host 清除", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot, onAction });
    await fireEvent.click(screen.getByRole("tab", { name: "团队提交规范" }));
    expect(screen.getByText("feat: workbench")).toBeInTheDocument();
    expect(screen.getByText(/当前仓库成功提交/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除团队记忆" }));
    expect(onAction).toHaveBeenCalledWith("settings/clear-team-memory");
  });
});

/** 提交选择规则段的富夹具：仓库层已配置 1 条状态策略 + 1 条路径规则，预览含 5 类典型条目。 */
const selectionBase: CommitSelectionSettingsSection = {
  editingScope: "repository",
  configPath: ".svn-workbench.json",
  layers: {
    user: { editable: false, state: "empty", errors: [], warnings: [] },
    workspace: { editable: false, state: "empty", errors: [], warnings: [] },
    repository: {
      editable: true,
      state: "applied",
      config: {
        version: 1,
        statusRules: { unversioned: "recommended" },
        pathRules: [
          {
            id: "team-fixtures",
            enabled: true,
            pattern: "tests/fixtures/**",
            decision: "needsReview",
            reason: "测试夹具需要人工确认",
          },
        ],
      },
      errors: [],
      warnings: [],
    },
  },
  effective: {
    statusRules: {
      modified: "recommended",
      added: "recommended",
      deleted: "recommended",
      replaced: "recommended",
      propertyModified: "recommended",
      missing: "needsReview",
      unversioned: "recommended",
      unknown: "needsReview",
      normal: "excluded",
    },
    pathRules: [
      {
        id: "team-fixtures",
        enabled: true,
        pattern: "tests/fixtures/**",
        decision: "needsReview",
        reason: "测试夹具需要人工确认",
        source: "repository",
        normalizedPattern: "tests/fixtures/**",
      },
    ],
  },
  errors: [],
  warnings: [],
  preview: {
    state: "ready",
    items: [
      {
        relativePath: "src/extension.ts",
        status: "modified",
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "modified",
        safetyLocked: false,
      },
      {
        relativePath: "dist/debug.log",
        status: "unversioned",
        decision: "excluded",
        reasonKey: "pathRule",
        matchedRuleId: "generated-dist",
        ruleSource: "builtin",
        safetyLocked: false,
      },
      {
        relativePath: "src/conflict/example.ts",
        status: "conflicted",
        decision: "blocked",
        reasonKey: "safetyBlocked",
        safetyLocked: true,
      },
      {
        relativePath: "assets/icon.svg",
        status: "normal",
        propStatus: "modified",
        decision: "recommended",
        reasonKey: "statusPolicy",
        statusPolicyKey: "propertyModified",
        safetyLocked: false,
      },
      {
        relativePath: "tests/fixtures/case.ts",
        status: "added",
        decision: "needsReview",
        reasonKey: "pathRule",
        matchedRuleId: "team-fixtures",
        ruleSource: "repository",
        safetyLocked: false,
      },
    ],
  },
};

function snapshotWithSelection(
  overrides: Partial<CommitSelectionSettingsSection> = {},
): SettingsSnapshot {
  return { ...snapshot, selection: { ...selectionBase, ...overrides } };
}

describe("SettingsModule 提交选择规则", () => {
  async function renderSelectionTab(
    onAction: ReturnType<typeof vi.fn>,
    selectionOverrides: Partial<CommitSelectionSettingsSection> = {},
  ) {
    render(SettingsModule, {
      snapshot: snapshotWithSelection(selectionOverrides),
      onAction,
    });
    await fireEvent.click(screen.getByRole("tab", { name: "提交选择规则" }));
    await screen.findByText("规则来源与覆盖关系");
  }

  function saveCalls(onAction: ReturnType<typeof vi.fn>) {
    return onAction.mock.calls.filter(
      (call) => call[0] === "settings/save-selection",
    );
  }

  it("深链接 settings/selection 落在提交选择规则标签", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: snapshotWithSelection(),
      taskId: "settings/selection",
      onAction,
    });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "提交选择规则" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
    expect(screen.getByText("规则来源与覆盖关系")).toBeInTheDocument();
    expect(screen.getByText("按状态的默认决策")).toBeInTheDocument();
    expect(screen.getByText(/Glob 路径规则/)).toBeInTheDocument();
    expect(screen.getByText("当前仓库候选命中结果")).toBeInTheDocument();
  });

  it("切换标签时发送 open-module 深链接", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot: snapshotWithSelection(), onAction });
    await fireEvent.click(screen.getByRole("tab", { name: "提交选择规则" }));
    expect(onAction).toHaveBeenCalledWith("open-module", {
      moduleId: "settings",
      taskId: "settings/selection",
    });
  });

  it("展示三层配置来源，用户与工作区层提供 VS Code 设置编辑入口", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    expect(screen.getByText("用户默认")).toBeInTheDocument();
    expect(screen.getByText("当前工作区")).toBeInTheDocument();
    expect(screen.getByText(/当前仓库（本页编辑）/)).toBeInTheDocument();
    expect(
      screen.getByText("已应用：1 条状态策略 · 1 条路径规则"),
    ).toBeInTheDocument();
    const openButtons = screen.getAllByRole("button", {
      name: "在 VS Code 设置中编辑",
    });
    expect(openButtons).toHaveLength(2);
    await fireEvent.click(openButtons[0]);
    expect(onAction).toHaveBeenCalledWith(
      "settings/open-selection-vscode-settings",
      { layer: "user" },
    );
    await fireEvent.click(openButtons[1]);
    expect(onAction).toHaveBeenCalledWith(
      "settings/open-selection-vscode-settings",
      { layer: "workspace" },
    );
  });

  it("编辑状态策略后随保存动作发送仓库层配置，未编辑的键不写入", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    const missing = screen.getByLabelText("文件缺失的默认决策");
    expect(missing).toHaveValue("inherit");
    // 仓库层已覆盖的键显示具体决策而非继承
    expect(screen.getByLabelText("未纳入版本控制的默认决策")).toHaveValue(
      "recommended",
    );
    await fireEvent.change(missing, { target: { value: "recommended" } });
    await fireEvent.click(
      screen.getByRole("button", { name: "保存当前仓库规则" }),
    );
    const calls = saveCalls(onAction);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({
      scope: "repository",
      statusRules: { unversioned: "recommended", missing: "recommended" },
    });
    expect(calls[0][1].statusRules).not.toHaveProperty("modified");
  });

  it("路径规则支持新增、编辑、删除与上下移动排序", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    expect(screen.getByDisplayValue("tests/fixtures/**")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "新增规则" }));
    const idInputs = screen.getAllByLabelText("规则 ID");
    expect(idInputs).toHaveLength(2);
    expect(idInputs[0]).toHaveValue("team-fixtures");
    expect(idInputs[1]).toHaveValue("team-rule-2");
    await fireEvent.input(screen.getAllByLabelText("Glob 表达式")[1], {
      target: { value: "logs/**" },
    });
    await fireEvent.click(
      screen.getByRole("button", { name: "下移规则 team-fixtures" }),
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "保存当前仓库规则" }),
    );
    const calls = saveCalls(onAction);
    const pathRules = calls[0][1].pathRules as Array<{
      id: string;
      pattern: string;
    }>;
    expect(pathRules.map((rule) => rule.id)).toEqual([
      "team-rule-2",
      "team-fixtures",
    ]);
    expect(pathRules[0].pattern).toBe("logs/**");

    await fireEvent.click(
      screen.getByRole("button", { name: "删除规则 team-rule-2" }),
    );
    expect(screen.queryByDisplayValue("logs/**")).not.toBeInTheDocument();
  });

  it("内置规则可禁用并生成同 ID 覆盖", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    const toggle = screen.getByLabelText("启用规则 generated-dist");
    expect(toggle).toBeChecked();
    await fireEvent.click(toggle);
    await fireEvent.click(
      screen.getByRole("button", { name: "保存当前仓库规则" }),
    );
    const calls = saveCalls(onAction);
    const pathRules = calls[0][1].pathRules as Array<{
      id: string;
      enabled: boolean;
      pattern: string;
    }>;
    expect(
      pathRules.find((rule) => rule.id === "generated-dist"),
    ).toMatchObject({ enabled: false, pattern: "**/dist/**" });
  });

  it("非法 glob 与重复 ID 行内提示并阻止保存", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    await fireEvent.click(screen.getByRole("button", { name: "新增规则" }));
    expect(screen.getByText("pattern 必须是非空字符串。")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "保存当前仓库规则" }),
    ).toBeDisabled();
    await fireEvent.input(screen.getAllByLabelText("规则 ID")[1], {
      target: { value: "team-fixtures" },
    });
    // 两条同 ID 规则都会被行内标注
    expect(
      screen.getAllByText(/规则 ID “team-fixtures” 重复/).length,
    ).toBeGreaterThan(0);
    expect(saveCalls(onAction)).toHaveLength(0);
  });

  it("预览在 Webview 端本地随草稿重新计算，不请求 Host", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    const previewRegion = screen.getByRole("region", {
      name: "提交选择规则预览结果",
    });
    const fixtureRow = () =>
      within(previewRegion)
        .getByText("tests/fixtures/case.ts")
        .closest(".selection-preview-row");
    expect(fixtureRow()?.textContent).toContain("需要确认");
    await fireEvent.input(screen.getAllByLabelText("Glob 表达式")[0], {
      target: { value: "nomatch/**" },
    });
    // 编辑输入 debounce 后本地重算：规则不再命中，回退到状态策略“已新增 → 推荐提交”
    await waitFor(
      () => expect(fixtureRow()?.textContent).toContain("推荐提交"),
      { timeout: 2000 },
    );
    expect(
      onAction.mock.calls.filter(
        (call) => call[0] === "settings/refresh-selection-preview",
      ),
    ).toHaveLength(0);
  });

  it("预览空态提供可恢复提示", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction, {
      preview: { state: "empty", items: [] },
    });
    expect(
      screen.getByText(/当前仓库没有可预览的候选文件/),
    ).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重新采集候选" }));
    expect(onAction).toHaveBeenCalledWith("settings/refresh-selection-preview");
  });

  it("预览错误态展示原因与恢复动作", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction, {
      preview: {
        state: "error",
        error: "无法采集当前仓库候选文件：svn status 执行失败",
        items: [],
      },
    });
    expect(screen.getByText(/无法生成规则预览/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "重新采集候选" }));
    expect(onAction).toHaveBeenCalledWith("settings/refresh-selection-preview");
  });

  it("预览支持路径搜索与决策筛选（v0.0.10）", async () => {
    await renderSelectionTab(vi.fn());
    const input = screen.getByRole("textbox", { name: "筛选预览路径" });
    const count = () => screen.getByText(/\d+ 条结果/);
    expect(count()).toBeInTheDocument();
    await fireEvent.input(input, { target: { value: "nomatch-path" } });
    expect(screen.getByText(/没有匹配的候选/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));
    // 决策筛选：只看需要确认。
    const decisionMenu = screen.getByRole("combobox", {
      name: "决策筛选",
    }) as HTMLSelectElement;
    await fireEvent.change(decisionMenu, { target: { value: "needsReview" } });
    const previewRegion = screen.getByRole("region", {
      name: "提交选择规则预览结果",
    });
    const rows = within(previewRegion).getAllByText(/./);
    expect(rows.length).toBeGreaterThan(0);
    expect(within(previewRegion).queryByText("推荐提交")).toBeNull();
    await fireEvent.change(decisionMenu, { target: { value: "all" } });
  });

  it("预览排序不改变规则优先级语义（v0.0.10）", async () => {
    await renderSelectionTab(vi.fn());
    const previewRegion = screen.getByRole("region", {
      name: "提交选择规则预览结果",
    });
    const rowPaths = () =>
      Array.from(
        previewRegion.querySelectorAll(
          ".selection-preview-row .selection-preview-path",
        ),
      ).map((node) => node.textContent ?? "");
    const sortMenu = screen.getByRole("combobox", {
      name: "预览排序",
    }) as HTMLSelectElement;
    const defaultOrder = rowPaths();
    expect(defaultOrder.length).toBeGreaterThan(1);
    await fireEvent.change(sortMenu, { target: { value: "pathAsc" } });
    expect(rowPaths()).toEqual(
      [...defaultOrder].sort((a, b) => naturalCompare(a, b)),
    );
    await fireEvent.change(sortMenu, { target: { value: "pathDesc" } });
    expect(rowPaths()).toEqual(
      [...defaultOrder].sort((a, b) => naturalCompare(b, a)),
    );
    // 恢复默认顺序回到快照顺序。
    await fireEvent.change(sortMenu, { target: { value: "default" } });
    expect(rowPaths()).toEqual(defaultOrder);
    // 规则表的上移/下移入口仍在（优先级只由它改变）。
    expect(screen.getAllByLabelText(/上移规则/).length).toBeGreaterThan(0);
  });

  it("展示保存反馈与结构化校验错误", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction, {
      feedback: {
        tone: "success",
        message:
          "提交选择规则已保存到 .svn-workbench.json，文件其他配置与未知字段保持不变。",
      },
    });
    expect(
      screen.getByText(/提交选择规则已保存到 .svn-workbench.json/),
    ).toBeInTheDocument();
  });

  it("保存失败时展示错误反馈与逐条校验错误", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction, {
      feedback: {
        tone: "error",
        message:
          "保存被拒绝：提交选择规则校验失败，未写入任何内容。请修正下列错误后重试。",
      },
      saveErrors: ["当前仓库 commitSelection.pathRules[0] 的规则 ID 无效。"],
    });
    expect(screen.getByText(/未写入任何内容/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "当前仓库 commitSelection.pathRules[0] 的规则 ID 无效。",
      ),
    ).toBeInTheDocument();
  });

  it("配置损坏拒绝保存时展示可恢复中文错误，并提供打开配置文件动作", async () => {
    const onAction = vi.fn();
    // 与 Host 侧 saveRepositoryRules 拒绝时下发的文案保持一致。
    const message =
      ".svn-workbench.json 配置损坏（.svn-workbench.json 不是合法 JSON：Unexpected token），保存已拒绝，文件内容保持原样。请打开 .svn-workbench.json 修复后重试。";
    await renderSelectionTab(onAction, {
      feedback: { tone: "error", message },
      saveErrors: [message],
    });
    // feedback 通知与 saveErrors 列表同时呈现同一条可恢复错误。
    expect(
      screen.getAllByText(/配置损坏（\.svn-workbench\.json 不是合法 JSON/),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(
        /保存已拒绝，文件内容保持原样。请打开 \.svn-workbench\.json 修复后重试/,
      ),
    ).toHaveLength(2);
    await fireEvent.click(
      screen.getByRole("button", { name: "打开 .svn-workbench.json" }),
    );
    expect(onAction).toHaveBeenCalledWith("settings/open-selection-file");
  });

  it("恢复默认值与打开配置文件通过 Host 动作执行", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    await fireEvent.click(
      screen.getByRole("button", { name: "恢复当前仓库规则为默认值" }),
    );
    expect(onAction).toHaveBeenCalledWith(
      "settings/restore-selection-defaults",
    );
    await fireEvent.click(
      screen.getByRole("button", { name: "打开 .svn-workbench.json" }),
    );
    expect(onAction).toHaveBeenCalledWith("settings/open-selection-file");
  });

  it("中文 IME 候选阶段与普通 Enter 都不会触发保存", async () => {
    const onAction = vi.fn();
    await renderSelectionTab(onAction);
    const patternInput = screen.getAllByLabelText("Glob 表达式")[0];
    await fireEvent.keyDown(patternInput, {
      key: "Enter",
      isComposing: true,
      keyCode: 229,
    });
    await fireEvent.keyDown(patternInput, { key: "Enter" });
    expect(saveCalls(onAction)).toHaveLength(0);
  });

  it("AI 页模型场景列表使用收敛后的读屏标签（v0.0.9 缺陷修复）", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: {
        ...snapshot,
        ai: {
          ...snapshot.ai,
          scenarios: [
            {
              id: "commitMessage",
              label: "提交说明",
              description: "生成提交说明建议草稿",
            },
            {
              id: "conflictAdvice",
              label: "冲突处理",
              description: "冲突处理建议",
            },
          ],
        },
      },
      onAction,
    });
    // 读屏可辨识的滚动区名称统一为“模型场景列表”，不残留“AI 场景”表述。
    expect(
      screen.getByRole("region", { name: "模型场景列表" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "AI 场景模型列表" }),
    ).not.toBeInTheDocument();
  });
});
