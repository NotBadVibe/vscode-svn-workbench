import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
  type SettingsSnapshot,
} from "../../src/protocol/workbenchProtocol";
import { CommitSelectionRuleService } from "../../src/commit/commitSelectionRuleService";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * V025-R47 团队规则示例即时校验（Host 权威，Controller 级）：
 * - settings/preview-team-sample 复用提交页同一校验逻辑，逐规则返回结论；
 * - 非法正则、空允许列表、中文模块、真实/缺失工单号、超预算均有明确原因；
 * - 预览不写团队配置（updateSvnWorkbenchConfig 未被调用），不发模型请求；
 * - 保存成功后旧预览清除，仍走配置写入边界。
 */

vi.mock("../../src/extension/workbench/WebviewAssetManifest", () => ({
  readWebviewAssets: async () => ({
    scriptUri: { toString: () => "mock-script" },
    styleUris: [],
    localResourceRoot: { fsPath: "/ext/dist/webview" },
  }),
}));

vi.mock("../../src/extension/workbench/renderWebviewShell", () => ({
  renderWebviewShell: () => "<html/>",
  renderWebviewBuildError: () => "<html/>",
}));

vi.mock(
  "../../src/extension/workbench/workbenchSupport",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/extension/workbench/workbenchSupport")
      >();
    return {
      ...actual,
      resolveRepositoryUuid: async () => "test-repository-uuid",
      resolveRepositoryRootUrl: async () => undefined,
      resolveWorkingCopyUrl: async () => undefined,
      resolveWorkingCopyRevision: async () => "7",
    };
  },
);

vi.mock("../../src/commit/commitCandidateCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitCandidateCollector")
    >();
  return { ...actual, collectCommitCandidates: async () => [] };
});

const configWriteControl = vi.hoisted(() => ({ calls: 0 }));

vi.mock("../../src/config/svnWorkbenchConfig", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/config/svnWorkbenchConfig")
    >();
  return {
    ...actual,
    // 只记录写入意图，不触碰真实文件系统：预览路径不得调用，保存路径必须调用一次。
    updateSvnWorkbenchConfig: async () => {
      configWriteControl.calls += 1;
      return {
        configPath: `${WC_ROOT}/app/.svn-workbench.json`,
        warnings: [],
      };
    },
  };
});

const WC_ROOT = "/repo/team-sample";

function makeScope(): OperationScope {
  const projectRoot = `${WC_ROOT}/app`;
  return {
    id: "scope",
    repositoryRoot: WC_ROOT,
    source: "explorerFolder",
    roots: [{ absolutePath: projectRoot, relativePath: "app", kind: "folder" }],
    project: {
      projectRoot,
      projectName: "app",
      rootIsFallback: false,
      workingCopyRelativePath: "app",
    },
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

function makeContext() {
  const store: Record<string, unknown> = {};
  return {
    secrets: { get: async () => undefined },
    extensionUri: { fsPath: "/ext" },
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: {
      get: (key: string, fallback?: unknown) =>
        key in store ? store[key] : fallback,
      update: async (key: string, value: unknown) => {
        if (value === undefined) {
          delete store[key];
        } else {
          store[key] = value;
        }
      },
    },
  };
}

type ControllerInternals = { session?: WorkbenchSession };

let posted: HostToWebviewMessage[] = [];

async function createSettingsSession() {
  // 设置快照需要有效规则解析（layers 结构），使用真实服务；
  // 测试仓库下无配置文件，服务返回内置默认，不触碰真实工作副本。
  const controller = new WorkbenchController(
    makeContext() as never,
    new CommitSelectionRuleService(),
    { servedModule: "settings" },
  );
  await controller.open({
    moduleId: "settings",
    taskId: "settings/team",
    svnPath: "svn",
    scope: makeScope(),
  });
  const panel = __webviewPanels[0];
  posted = [];
  panel.webview.postMessage = async (message: unknown) => {
    posted.push(message as HostToWebviewMessage);
  };
  const session = (controller as unknown as ControllerInternals).session;
  if (!session) throw new Error("会话尚未建立");
  // Host 经 void handleMessage 异步处理：每次发送后等待快照下发再断言。
  const send = async (action: string, data?: Record<string, unknown>) => {
    posted.length = 0;
    await panel.__onMessage?.({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "workbench/action",
      moduleId: "settings",
      taskId: "settings/team",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
  };
  return { controller, session, send };
}

function latestSettingsSnapshot(): SettingsSnapshot {
  const snapshot = [...posted]
    .reverse()
    .find(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind?: string } } }).payload
          .snapshot.kind === "settings",
    );
  if (!snapshot) throw new Error("未收到设置快照");
  return (snapshot as unknown as { payload: { snapshot: SettingsSnapshot } })
    .payload.snapshot;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    requiredIssueId: true,
    issueIdPattern: "[A-Z]+-\\d+",
    requiredModule: true,
    allowedModulesText: "order, user",
    requiredPrefix: true,
    allowedPrefixesText: "feat, fix",
    ...overrides,
  };
}

afterEach(() => {
  __resetWebviewPanels();
});

describe("settings/preview-team-sample 示例即时校验", () => {
  it("通过的示例返回逐规则通过且骨架不含真实工单号", async () => {
    configWriteControl.calls = 0;
    const { send } = await createSettingsSession();
    await send("settings/preview-team-sample", {
      ...draft(),
      sample: "feat(order): 修复订单列表\n\nPROJ-123",
    });
    const team = latestSettingsSnapshot().team;
    expect(team.samplePreview?.valid).toBe(true);
    expect(team.samplePreview?.draftBased).toBe(true);
    expect(team.samplePreview?.sample).toBe(
      "feat(order): 修复订单列表\n\nPROJ-123",
    );
    for (const rule of team.samplePreview?.ruleResults ?? []) {
      expect(rule.passed).toBe(true);
    }
    expect(team.samplePreview?.skeleton).toContain("feat(order):");
    expect(team.samplePreview?.skeleton).not.toMatch(/[A-Z]+-\d+/);
    // 预览不写团队配置。
    expect(configWriteControl.calls).toBe(0);
  });

  it("非法正则、空允许列表即时拒绝并给出明确原因", async () => {
    configWriteControl.calls = 0;
    const { send } = await createSettingsSession();
    await send("settings/preview-team-sample", {
      ...draft({ issueIdPattern: "[", allowedPrefixesText: "" }),
      sample: "feat(order): 修复",
    });
    const preview = latestSettingsSnapshot().team.samplePreview;
    expect(preview?.valid).toBe(false);
    expect(
      preview?.configIssues.some((issue) => issue.includes("正则不合法")),
    ).toBe(true);
    expect(
      preview?.configIssues.some((issue) =>
        issue.includes("至少需要填写一个允许前缀"),
      ),
    ).toBe(true);
    expect(configWriteControl.calls).toBe(0);
  });

  it("中文模块未通过但真实工单号通过，缺失工单号有明确原因", async () => {
    const { send } = await createSettingsSession();
    await send("settings/preview-team-sample", {
      ...draft(),
      sample: "fix(订单): 修复\n\nPROJ-123",
    });
    const preview = latestSettingsSnapshot().team.samplePreview;
    const module = preview?.ruleResults.find((item) => item.rule === "module");
    const issue = preview?.ruleResults.find((item) => item.rule === "issueId");
    expect(module?.passed).toBe(false);
    expect(module?.message).toContain("订单");
    expect(issue?.passed).toBe(true);
    expect(preview?.valid).toBe(false);

    await send("settings/preview-team-sample", {
      ...draft(),
      sample: "fix(order): 修复",
    });
    const missing = latestSettingsSnapshot().team.samplePreview;
    expect(
      missing?.ruleResults.find((item) => item.rule === "issueId")?.passed,
    ).toBe(false);
    expect(
      missing?.ruleResults
        .find((item) => item.rule === "issueId")
        ?.message.includes("工单号"),
    ).toBe(true);
  });

  it("超预算样例即时拒绝", async () => {
    const { send } = await createSettingsSession();
    await send("settings/preview-team-sample", {
      ...draft(),
      sample: "a".repeat(2001),
    });
    const preview = latestSettingsSnapshot().team.samplePreview;
    expect(preview?.valid).toBe(false);
    expect(preview?.budgetIssue).toContain("2000");
  });

  it("保存成功后旧预览清除，保存仍走配置写入边界", async () => {
    configWriteControl.calls = 0;
    const { send } = await createSettingsSession();
    await send("settings/preview-team-sample", {
      ...draft(),
      sample: "feat(order): 修复\n\nPROJ-123",
    });
    expect(latestSettingsSnapshot().team.samplePreview?.valid).toBe(true);
    await send("settings/save-team", draft());
    expect(configWriteControl.calls).toBe(1);
    expect(latestSettingsSnapshot().team.samplePreview).toBeUndefined();
  });
});
