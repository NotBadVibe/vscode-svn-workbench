import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type ChangelistsSnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * V025-R49：本地整理与模型语义拆分明确分开。
 * - 本地整理（changelist/suggest mode:metadata）走纯本地规则，不经 runAiScenario：
 *   有/无模型配置时均无外部请求且结果稳定，来源固定 local-rule；
 * - 模型拆分仍需确认回执（run-semantic 链不动）；
 * - 仅元数据模式不声称理解业务意图（purpose 声明未读取差异正文）。
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

const collectorControl = vi.hoisted(() => ({
  candidates: [] as Array<{
    absolutePath: string;
    relativePath: string;
    status: string;
    selection: string;
  }>,
}));

vi.mock("../../src/commit/commitCandidateCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitCandidateCollector")
    >();
  return {
    ...actual,
    collectCommitCandidates: async () => collectorControl.candidates,
  };
});

const changelistControl = vi.hoisted(() => ({
  groups: [] as Array<{ name: string; paths: string[] }>,
}));

vi.mock("../../src/changelist/svnChangelists", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/changelist/svnChangelists")
    >();
  return {
    ...actual,
    collectSvnChangelists: async () => changelistControl.groups,
  };
});

/** 若本地整理误走模型链，此 mock 会抛错使测试失败（平台无关断言）。 */
const providerControl = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../src/ai/openAiCompatibleProvider", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/ai/openAiCompatibleProvider")
    >();
  return {
    ...actual,
    OpenAiCompatibleProvider: class extends actual.OpenAiCompatibleProvider {
      override async suggestCommitSplits(
        ...args: Parameters<
          actual.OpenAiCompatibleProvider["suggestCommitSplits"]
        >
      ) {
        providerControl.calls += 1;
        return super.suggestCommitSplits(...args);
      }
    },
  };
});

const WC_ROOT = "/repo/code";

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

async function createSession() {
  const controller = new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
    { servedModule: "changelists" },
  );
  await controller.open({
    moduleId: "changelists",
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
  const send = async (action: string, data?: Record<string, unknown>) => {
    await panel.__onMessage?.({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "workbench/action",
      moduleId: "changelists",
      taskId: "changelists/manage",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
  };
  return { controller, session, send };
}

function changelistSnapshotOf(): ChangelistsSnapshot | undefined {
  const snapshot = [...posted]
    .reverse()
    .find(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind?: string } } }).payload
          .snapshot.kind === "changelists",
    );
  return (snapshot as { payload: { snapshot: ChangelistsSnapshot } })?.payload
    .snapshot;
}

beforeEach(() => {
  collectorControl.candidates = [
    {
      absolutePath: `${WC_ROOT}/app/a.ts`,
      relativePath: "app/a.ts",
      status: "modified",
      selection: "selected",
    },
    {
      absolutePath: `${WC_ROOT}/docs/b.md`,
      relativePath: "docs/b.md",
      status: "added",
      selection: "selected",
    },
  ];
  changelistControl.groups = [];
  providerControl.calls = 0;
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("V025-R49 本地整理确定性（不经模型）", () => {
  it("metadata 整理不触发 provider 调用且来源为本地检查", async () => {
    const { send } = await createSession();
    await send("changelist/suggest", { mode: "metadata" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = changelistSnapshotOf();
    expect(snapshot?.suggestions?.length).toBeGreaterThan(0);
    // 确定性独立动作：固定 local-rule，不走 runAiScenario 的 fallback。
    expect(snapshot?.source).toBe("local-rule");
    expect(snapshot?.fallbackReason).toBeUndefined();
    expect(providerControl.calls).toBe(0);
  });

  it("默认模式（无 mode）同样走本地整理且结果稳定", async () => {
    const { send } = await createSession();
    await send("changelist/suggest", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const first = changelistSnapshotOf();
    const firstTitles = first?.suggestions.map((item) => item.title);
    expect(first?.source).toBe("local-rule");
    expect(providerControl.calls).toBe(0);
    posted.length = 0;
    await send("changelist/suggest", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const second = changelistSnapshotOf();
    expect(second?.suggestions.map((item) => item.title)).toEqual(firstTitles);
    expect(providerControl.calls).toBe(0);
  });

  it("仅元数据模式不声称理解业务意图", async () => {
    const { send } = await createSession();
    await send("changelist/suggest", { mode: "metadata" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = changelistSnapshotOf();
    for (const suggestion of snapshot?.suggestions ?? []) {
      expect(suggestion.purpose ?? "").toContain("未读取差异正文");
    }
  });

  it("模型拆分回执过期失败不覆盖人工方案与选择", async () => {
    const { session, send } = await createSession();
    const manual = [
      {
        id: "manual-1",
        title: "人工方案",
        summary: "人工保留",
        message: "人工保留",
        paths: ["app/a.ts"],
        reason: "人工",
        risks: [],
      },
    ];
    session.changelistState = {
      suggestions: manual,
      warnings: [],
      source: "local-rule",
    };
    await send("changelist/run-semantic", { receiptToken: "expired" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const errors = posted.filter((m) => m.type === "operation/error");
    expect(errors.length).toBeGreaterThan(0);
    // 失败不覆盖人工方案：suggestions 保持，provider 未被调用。
    expect(session.changelistState?.suggestions).toEqual(manual);
    expect(providerControl.calls).toBe(0);
  });
});
