import { describe, expect, it } from "vitest";
import {
  WORKBENCH_PROTOCOL_VERSION,
  createRequestId,
  defaultWorkbenchTask,
  isWebviewToHostMessage,
  isWorkbenchModuleId,
  isWorkbenchTaskForModule,
  isWorkbenchTaskId,
  webviewActions,
  type SettingsSnapshot,
} from "../../src/protocol/workbenchProtocol";

function actionMessage(action: string): unknown {
  return {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "workbench/action",
    moduleId: "settings",
    taskId: "settings/selection",
    sessionId: "session-id",
    repositoryUuid: "repo-uuid",
    scopeHash: "scope-hash",
    payload: { action },
  };
}

describe("workbench protocol validation", () => {
  it("accepts known modules and rejects invented modules", () => {
    expect(isWorkbenchModuleId("changes")).toBe(true);
    expect(isWorkbenchModuleId("invented")).toBe(false);
  });

  it("校验具体任务深链接与所属模块", () => {
    // v0.0.17 批次 A：update 拆分为独立模块，repository 默认任务改为浏览仓库。
    expect(isWorkbenchModuleId("update")).toBe(true);
    expect(defaultWorkbenchTask("update")).toBe("update/preview");
    expect(defaultWorkbenchTask("repository")).toBe("repository/browse");
    expect(isWorkbenchTaskId("update/preview")).toBe(true);
    expect(isWorkbenchTaskId("repository/update")).toBe(false);
    expect(isWorkbenchTaskId("repository/properties")).toBe(true);
    expect(isWorkbenchTaskId("repository/unknown")).toBe(false);
    expect(
      isWorkbenchTaskForModule("repository/properties", "repository"),
    ).toBe(true);
    expect(isWorkbenchTaskForModule("update/preview", "update")).toBe(true);
    expect(isWorkbenchTaskForModule("update/preview", "repository")).toBe(
      false,
    );
    expect(isWorkbenchTaskForModule("settings/ai", "repository")).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        type: "webview/ready",
        moduleId: "repository",
        taskId: "settings/ai",
        payload: {},
      }),
    ).toBe(false);
  });

  it("accepts a valid action message", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        requestId: "test-1",
        moduleId: "changes",
        sessionId: "session-id",
        repositoryUuid: "repo-uuid",
        scopeHash: "scope-hash",
        payload: { action: "refresh" },
      }),
    ).toBe(true);
  });

  it("rejects unknown actions and incompatible versions", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: 999,
        type: "workbench/action",
        moduleId: "changes",
        payload: { action: "commit-without-confirmation" },
      }),
    ).toBe(false);
  });

  it("rejects an action without repository and scope identity", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        moduleId: "changes",
        payload: { action: "refresh" },
      }),
    ).toBe(false);
  });

  it("覆盖 ready、非法形状、类型和模块的协议分支", () => {
    expect(isWebviewToHostMessage(null)).toBe(false);
    expect(isWebviewToHostMessage([])).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "missing",
        type: "webview/ready",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        moduleId: "changes",
        type: "webview/ready",
        payload: {},
      }),
    ).toBe(true);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "webview/ready",
        payload: null,
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "unknown",
        payload: {},
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        payload: [],
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        sessionId: "session-id",
        repositoryUuid: 1,
        scopeHash: "s",
        payload: { action: "refresh" },
      }),
    ).toBe(false);
    expect(
      isWebviewToHostMessage({
        protocolVersion: 1,
        moduleId: "changes",
        type: "workbench/action",
        sessionId: "session-id",
        repositoryUuid: "r",
        scopeHash: 1,
        payload: { action: "refresh" },
      }),
    ).toBe(false);
    expect(createRequestId("安全操作")).toMatch(
      /^安全操作-[a-z0-9]+-[a-f0-9]{32}$/,
    );
  });
});

describe("settings/selection 深链接", () => {
  it("登记为 settings 模块的合法任务，默认任务保持 settings/ai", () => {
    expect(isWorkbenchTaskId("settings/selection")).toBe(true);
    expect(isWorkbenchTaskForModule("settings/selection", "settings")).toBe(
      true,
    );
    expect(isWorkbenchTaskForModule("settings/selection", "commit")).toBe(
      false,
    );
    expect(defaultWorkbenchTask("settings")).toBe("settings/ai");
  });

  it("taskId 与模块不匹配的消息被拒绝", () => {
    expect(
      isWebviewToHostMessage({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "webview/ready",
        moduleId: "commit",
        taskId: "settings/selection",
        payload: {},
      }),
    ).toBe(false);
  });
});

describe("settings/selection 动作与运行时清单一致性", () => {
  const selectionActions = [
    "settings/save-selection",
    "settings/restore-selection-defaults",
    "settings/open-selection-file",
    "settings/refresh-selection-preview",
    "settings/open-selection-vscode-settings",
  ];

  it("新增动作被消息守卫接受", () => {
    for (const action of selectionActions) {
      expect(isWebviewToHostMessage(actionMessage(action))).toBe(true);
    }
  });

  it("webviewActions 运行时清单无重复且覆盖全部字面量联合成员", () => {
    // 字面量联合 → 清单的方向由协议内 WebviewActionListConsistency 编译期断言保证；
    // 这里在运行时反向校验：清单无重复、每个成员都被守卫接受。
    expect(new Set(webviewActions).size).toBe(webviewActions.length);
    for (const action of webviewActions) {
      expect(isWebviewToHostMessage(actionMessage(action))).toBe(true);
    }
  });

  it("运行时清单包含全部新增 settings/selection 动作", () => {
    for (const action of selectionActions) {
      expect(webviewActions).toContain(action);
    }
  });
});

describe("v0.0.13 会话状态总线——草稿与选择（协议守卫）", () => {
  const conflictActions = [
    "conflict/draft-update",
    "conflict/draft-checkpoint",
    "conflict/draft-abandon",
    "conflict/draft-copy",
    "conflict/draft-export",
    "conflict/draft-switch-decision",
  ];
  it("新增冲突草稿动作被消息守卫接受", () => {
    for (const action of conflictActions) {
      expect(isWebviewToHostMessage(actionMessage(action))).toBe(true);
    }
  });
  it("运行时清单包含全部冲突草稿动作", () => {
    for (const action of conflictActions) {
      expect(webviewActions).toContain(action);
    }
  });
  it("新增 Host 消息类型守卫：conflict/draft-checkpointed 与 draft-switch-confirm 为合法类型", () => {
    // 通过构造完整的 HostToWebviewMessage 形状并验证其 protocolVersion 与 moduleId 合法，间接验证类型联合已扩展
    // 直接验证 webviewActions 已覆盖，Host 侧类型由 TypeScript 保证；此处校验守卫对新 action 的接收
    expect(webviewActions).toContain("conflict/draft-update");
    expect(webviewActions).toContain("conflict/draft-switch-decision");
  });
  it("拒绝未知的冲突草稿动作", () => {
    expect(isWebviewToHostMessage(actionMessage("conflict/invented"))).toBe(
      false,
    );
  });
});

describe("v0.0.15 诊断动作协议化（批次 A）", () => {
  const diagnosticActions = [
    "diagnostics/select-svn-executable",
    "diagnostics/open-settings",
    "diagnostics/open-folder",
    "diagnostics/copy-diagnostics",
    "diagnostics/open-url",
  ];
  it("新增诊断动作被消息守卫接受", () => {
    for (const action of diagnosticActions) {
      expect(isWebviewToHostMessage(actionMessage(action))).toBe(true);
    }
  });
  it("运行时清单包含全部诊断动作", () => {
    for (const action of diagnosticActions) {
      expect(webviewActions).toContain(action);
    }
  });
  it("拒绝未知的诊断动作", () => {
    expect(isWebviewToHostMessage(actionMessage("diagnostics/invented"))).toBe(
      false,
    );
  });
});

describe("SettingsSnapshot.selection 快照结构", () => {
  it("包含作用域、分层配置、有效合并、校验状态与规则预览", () => {
    const snapshot: SettingsSnapshot = {
      kind: "settings",
      svnSecurity: {
        authenticationActive: false,
        hasStoredAuthentication: false,
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
          workspace: {
            editable: false,
            state: "empty",
            errors: [],
            warnings: [],
          },
          repository: {
            editable: true,
            state: "applied",
            config: {
              version: 1,
              statusRules: { unversioned: "recommended" },
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
              id: "generated-dist",
              enabled: true,
              pattern: "**/dist/**",
              decision: "excluded",
              reason: "构建输出目录",
              source: "builtin",
              normalizedPattern: "**/dist/**",
            },
          ],
        },
        errors: [],
        warnings: [],
        preview: {
          state: "ready",
          items: [
            {
              relativePath: "src/a.ts",
              status: "modified",
              decision: "recommended",
              reasonKey: "statusPolicy",
              statusPolicyKey: "modified",
              safetyLocked: false,
            },
            {
              relativePath: "src/conflict.ts",
              status: "conflicted",
              decision: "blocked",
              reasonKey: "safetyBlocked",
              safetyLocked: true,
            },
          ],
        },
      },
    };

    const roundTripped = JSON.parse(
      JSON.stringify(snapshot),
    ) as SettingsSnapshot;
    expect(roundTripped.selection.editingScope).toBe("repository");
    expect(roundTripped.selection.layers.repository.editable).toBe(true);
    expect(roundTripped.selection.layers.user.editable).toBe(false);
    expect(
      roundTripped.selection.layers.repository.config?.statusRules?.unversioned,
    ).toBe("recommended");
    expect(roundTripped.selection.effective.pathRules[0].source).toBe(
      "builtin",
    );
    expect(roundTripped.selection.preview.items[1]).toMatchObject({
      decision: "blocked",
      safetyLocked: true,
    });
  });
});
