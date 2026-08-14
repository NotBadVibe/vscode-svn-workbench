import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import SettingsModule from "../../src/webview/features/settings/SettingsModule.svelte";
import type { SettingsSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.7 §9 团队规则：来源显示（当前项目/继承自工作副本根）与迁移
 * 预览 → 明确确认。
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

describe("团队规则来源与迁移（v0.0.7 §9）", () => {
  it("继承工作副本根配置时明示来源并提供迁移预览入口", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: teamSnapshot({
        configSource: "workingCopy",
        inheritedFromWorkingCopy: true,
        migrationAvailable: true,
      }),
      onAction,
    });
    await openTeamTab();
    expect(screen.getByText(/继承自工作副本根/)).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", { name: "预览迁移到项目根" }),
    );
    expect(onAction).toHaveBeenCalledWith("settings/preview-team-migration");
  });

  it("项目根独立配置显示“当前项目”，不出现迁移入口", async () => {
    render(SettingsModule, {
      snapshot: teamSnapshot({ configSource: "project" }),
      onAction: vi.fn(),
    });
    await openTeamTab();
    expect(screen.getByText(/来源：当前项目/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "预览迁移到项目根" }),
    ).not.toBeInTheDocument();
  });

  it("迁移预览写明源、目标、影响，确认携带令牌", async () => {
    const onAction = vi.fn();
    render(SettingsModule, {
      snapshot: teamSnapshot({
        configSource: "workingCopy",
        inheritedFromWorkingCopy: true,
        migrationPreview: {
          token: "token-1",
          sourcePath: "/repo/code/.svn-workbench.json",
          targetPath: "/repo/code/EmApi/.svn-workbench.json",
          keys: ["commitConvention", "commitSelection"],
          targetContent: '{ "commitConvention": {} }',
          sourceContentAfter: "{}",
          issues: [],
        },
      }),
      onAction,
    });
    await openTeamTab();
    expect(screen.getByText("迁移预览")).toBeInTheDocument();
    expect(screen.getByText(/不再继承这些规则/)).toBeInTheDocument();
    await fireEvent.click(
      screen.getByRole("button", {
        name: "确认迁移 2 项团队规则到项目根",
      }),
    );
    expect(onAction).toHaveBeenCalledWith("settings/execute-team-migration", {
      token: "token-1",
    });
  });

  it("迁移存在阻止项时不提供确认按钮并说明原因", async () => {
    render(SettingsModule, {
      snapshot: teamSnapshot({
        migrationPreview: {
          token: "token-1",
          sourcePath: "/repo/code/.svn-workbench.json",
          targetPath: "/repo/code/EmApi/.svn-workbench.json",
          keys: ["commitConvention"],
          targetContent: "{}",
          sourceContentAfter: "{}",
          issues: [
            "项目根已存在 .svn-workbench.json，为避免覆盖已有配置已拒绝迁移；请手动合并后重试。",
          ],
        },
      }),
      onAction: vi.fn(),
    });
    await openTeamTab();
    expect(screen.getByRole("alert")).toHaveTextContent("已存在");
    expect(
      screen.queryByRole("button", { name: /确认迁移/ }),
    ).not.toBeInTheDocument();
  });
});
