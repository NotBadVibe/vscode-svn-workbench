import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SettingsModule from "../../src/webview/features/settings/SettingsModule.svelte";
import type { SettingsSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * V025-R47 团队规则示例即时校验（Webview 展示层）：
 * - 可编辑样例 + “校验示例”经 Host 动作送出草稿与样例，不自建规则解释；
 * - 逐规则通过/失败、骨架、生效来源、不写配置/不发模型声明如实展示；
 * - 样例或草稿变化后旧结论标过期；“填入骨架”不编造真实工单号；
 * - 中文 IME：候选阶段 Enter 不触发校验，显式 Ctrl+Enter 才请求。
 */

const baseSnapshot: SettingsSnapshot = {
  kind: "settings",
  svnSecurity: {
    authenticationActive: true,
    hasStoredAuthentication: true,
    passwordTransport: "stdin",
    certificateTrust: "explicit-svn-cache",
  },
  ai: {
    presets: [],
    scenarios: [],
    providerPreset: "custom",
    baseUrl: "",
    model: "",
    scenarioModels: {},
    hasApiKey: false,
    includeCommitHistory: false,
    historyLimit: 10,
    models: [],
  },
  team: {
    configPath: ".svn-workbench.json",
    configSource: "project",
    enabled: true,
    requiredIssueId: true,
    issueIdPattern: "[A-Z]+-\\d+",
    requiredModule: true,
    allowedModulesText: "order, user",
    requiredPrefix: true,
    allowedPrefixesText: "feat, fix",
    warnings: [],
    memory: {
      source: "当前仓库成功提交",
      count: 0,
      maxEntries: 50,
      externallyShared: false,
      recent: [],
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

function teamSnapshot(
  team: Partial<SettingsSnapshot["team"]>,
): SettingsSnapshot {
  return {
    ...baseSnapshot,
    team: { ...baseSnapshot.team, ...team },
  };
}

async function openTeamTab() {
  await fireEvent.click(screen.getByRole("tab", { name: "团队提交规范" }));
}

const passingPreview: NonNullable<SettingsSnapshot["team"]["samplePreview"]> = {
  sample: "feat(order): 修复订单列表\n\nPROJ-123",
  skeleton:
    "feat(order): 示例改动说明\n\n工单号：按 [A-Z]+-\\d+ 填写真实工单号，本样例不编造",
  valid: true,
  configIssues: [],
  ruleResults: [
    {
      rule: "prefix",
      label: "前缀",
      required: true,
      passed: true,
      message: "通过：前缀符合允许范围（feat, fix）。",
    },
    {
      rule: "module",
      label: "模块名",
      required: true,
      passed: true,
      message: "通过：模块符合允许范围（order, user）。",
    },
    {
      rule: "issueId",
      label: "工单号",
      required: true,
      passed: true,
      message: "通过：示例包含符合正则的工单号。",
    },
  ],
  draftBased: true as const,
};

describe("SettingsModule 示例即时校验", () => {
  it("无结论时展示空态，校验示例送出草稿与样例", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot: teamSnapshot({}), onAction });
    await openTeamTab();
    expect(screen.getByLabelText("提交说明样例")).toBeInTheDocument();
    expect(screen.getByText(/填写样例并点击“校验示例”/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "填入骨架" })).toBeDisabled();

    const sample = screen.getByLabelText("提交说明样例");
    await fireEvent.input(sample, {
      target: { value: "feat(order): 修复订单列表\n\nPROJ-123" },
    });
    await fireEvent.click(screen.getByRole("button", { name: "校验示例" }));
    expect(onAction).toHaveBeenCalledWith(
      "settings/preview-team-sample",
      expect.objectContaining({
        enabled: true,
        requiredPrefix: true,
        allowedPrefixesText: "feat, fix",
        sample: "feat(order): 修复订单列表\n\nPROJ-123",
      }),
    );
  });

  it("展示逐规则通过/失败、骨架、生效来源与不写配置声明", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: teamSnapshot({
        configSource: "workingCopy",
        inheritedFromWorkingCopy: true,
        samplePreview: {
          ...passingPreview,
          valid: false,
          ruleResults: [
            passingPreview.ruleResults[0],
            {
              rule: "module",
              label: "模块名",
              required: true,
              passed: false,
              message: '提交说明模块 "订单" 不在允许范围：order, user。',
            },
            passingPreview.ruleResults[2],
          ],
          configIssues: ["启用前缀校验时，至少需要填写一个允许前缀。"],
          budgetIssue: undefined,
        },
      }),
      onAction,
    });
    await openTeamTab();
    expect(screen.getByText("示例未通过")).toBeInTheDocument();
    expect(screen.getByText(/前缀.*通过/)).toBeInTheDocument();
    expect(screen.getByText(/模块名.*未通过/)).toBeInTheDocument();
    expect(screen.getByText(/"订单" 不在允许范围/)).toBeInTheDocument();
    expect(screen.getByText(/至少需要填写一个允许前缀/)).toBeInTheDocument();
    expect(
      screen.getByText(/已保存配置的生效位置：自工作副本根继承/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/不会写入团队配置，也不会发起模型请求/),
    ).toBeInTheDocument();
    // 骨架在折叠区内，不编造真实工单号。
    await fireEvent.click(
      screen.getByText(/查看示例骨架（符合前缀\/模块结构，不含真实工单号）/),
    );
    expect(screen.getByText(/本样例不编造/)).toBeInTheDocument();
  });

  it("超预算拒绝有明确原因", async () => {
    render(SettingsModule, {
      snapshot: teamSnapshot({
        samplePreview: {
          ...passingPreview,
          valid: false,
          budgetIssue:
            "提交说明样例超过 2000 个字符，已拒绝校验；请缩短后再试。",
        },
      }),
      onAction: vi.fn(),
    });
    await openTeamTab();
    expect(screen.getByText(/超过 2000 个字符/)).toBeInTheDocument();
  });

  it("样例变化后旧结论标过期，填入骨架写入样例框", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: teamSnapshot({ samplePreview: passingPreview }),
      onAction,
    });
    await openTeamTab();
    // 先把样例框恢复为结论对应的样例 → 不过期。
    await fireEvent.input(screen.getByLabelText("提交说明样例"), {
      target: { value: passingPreview.sample },
    });
    expect(screen.queryByText(/上次结论已过期/)).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "填入骨架" }));
    expect(screen.getByLabelText("提交说明样例")).toHaveValue(
      passingPreview.skeleton,
    );
    // 样例已不同于结论对应的原文 → 标过期，需重新校验。
    expect(screen.getByText(/上次结论已过期/)).toBeInTheDocument();
  });

  it("中文 IME：候选阶段 Enter 不触发，Ctrl+Enter 才请求预览", async () => {
    const onAction = vi.fn();
    render(SettingsModule, { snapshot: teamSnapshot({}), onAction });
    await openTeamTab();
    const sample = screen.getByLabelText("提交说明样例");
    await fireEvent.keyDown(sample, { key: "Enter" });
    expect(onAction).not.toHaveBeenCalledWith(
      "settings/preview-team-sample",
      expect.anything(),
    );
    await fireEvent.keyDown(sample, { key: "Enter", ctrlKey: true });
    expect(onAction).toHaveBeenCalledWith(
      "settings/preview-team-sample",
      expect.anything(),
    );
  });
});
