import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type ChangelistsSnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { buildCandidateId } from "../../src/commit/commitDiffEvidence";
import { hashCandidateState } from "../../src/extension/workbench/workbenchSupport";
import { updateUnderstandingConfirmations } from "../../src/extension/workbench/understandingConfirmations";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.12 批次 B：按改动意图拆分 + 提交说明接入有效确认事实（Controller 级）。
 * - changelist/preview-receipt 只下发回执（任务 changelist-split）；
 * - changelist/run-semantic 校验任务/token/范围/候选后语义拆分，跨任务拒绝；
 * - changelist/preview-apply 拒绝把已属于其他真实 Changelist 的文件重复加入；
 * - commit/generate-message 只使用仍有效的确认事实（候选 hash 一致）。
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

const diffControl = vi.hoisted(() => ({
  fragments: [] as Array<{
    candidateId: string;
    projectRelativePath: string;
    status: string;
    diffHash: string;
    content: string;
    hunks: Array<{ hunkId: string; header: string }>;
    truncated: boolean;
    binary: boolean;
  }>,
  revision: "7",
}));

vi.mock("../../src/commit/commitDiffCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitDiffCollector")
    >();
  return {
    ...actual,
    collectLimitedCommitDiffs: async () => ({
      fragments: diffControl.fragments,
      coverage: diffControl.fragments.map((fragment) => ({
        candidateId: fragment.candidateId,
        projectRelativePath: fragment.projectRelativePath,
        status: fragment.status,
        state: "analyzed" as const,
        diffHash: fragment.diffHash,
        charCount: fragment.content.length,
        hunkCount: fragment.hunks.length,
      })),
      summary: {
        total: diffControl.fragments.length,
        analyzed: diffControl.fragments.length,
        truncated: 0,
        binary: 0,
        readFailed: 0,
        budgetExcluded: 0,
      },
      revision: diffControl.revision,
      excludedCount: 0,
    }),
  };
});

vi.mock("../../src/commit/commitDiffSummary", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commit/commitDiffSummary")>();
  return {
    ...actual,
    collectCommitDiffSummaries: async () => [],
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

const WC_ROOT = "/repo/code";
const CAND_A = buildCandidateId(WC_ROOT, `${WC_ROOT}/app/a.ts`);

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

async function createSession(moduleId: "changelists" | "commit") {
  const controller = new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
    { servedModule: moduleId },
  );
  await controller.open({ moduleId, svnPath: "svn", scope: makeScope() });
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
      moduleId,
      taskId:
        moduleId === "changelists" ? "changelists/manage" : "commit/compose",
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
  return (
    snapshot as {
      payload: { snapshot: ChangelistsSnapshot };
    }
  )?.payload.snapshot;
}

function receiptMessages() {
  return posted
    .filter((message) => message.type === "changelist/receipt")
    .map((message) => (message as { payload: { token: string } }).payload);
}

function errorTitles(): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) => (message as { payload: { title: string } }).payload.title,
    );
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
      absolutePath: `${WC_ROOT}/app/b.ts`,
      relativePath: "app/b.ts",
      status: "added",
      selection: "selected",
    },
  ];
  diffControl.fragments = [
    {
      candidateId: CAND_A,
      projectRelativePath: "app/a.ts",
      status: "modified",
      diffHash: "deadbeef",
      content: "@@ -1,1 +1,2 @@\n+新增配置\n-移除旧值",
      hunks: [{ hunkId: "h-1", header: "@@ -1,1 +1,2 @@" }],
      truncated: false,
      binary: false,
    },
  ];
  changelistControl.groups = [];
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("changelist 语义拆分（v0.0.12 批次 B）", () => {
  it("preview-receipt 只下发回执（任务 changelist-split），不调用模型", async () => {
    const { session, send } = await createSession("changelists");
    await send("changelist/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    expect(session.changelistState?.pendingReceipt?.task).toBe(
      "changelist-split",
    );
    // 未生成建议快照。
    expect(changelistSnapshotOf()?.suggestions).toBeUndefined();
  });

  it("run-semantic 携带匹配 token 时生成语义建议（含 purpose）", async () => {
    const { session, send } = await createSession("changelists");
    await send("changelist/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("changelist/run-semantic", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = changelistSnapshotOf();
    expect(snapshot?.suggestions?.length).toBeGreaterThan(0);
    expect(session.changelistState?.pendingReceipt).toBeUndefined();
  });

  it("跨任务/过期回执一律拒绝", async () => {
    const { session, send } = await createSession("changelists");
    // 伪造 commit-draft 任务的 pending 回执。
    session.changelistState = {
      suggestions: [],
      warnings: [],
      source: "local-rule",
      pendingReceipt: {
        token: "wrong-task",
        task: "commit-draft",
        receipt: {
          task: "commit-draft",
          projectId: "p",
          model: "m",
          dataTypes: [],
          files: 0,
          totalBudget: 0,
          perFileBudget: 0,
          historyIncluded: false,
        },
        coverage: {
          total: 0,
          analyzed: 0,
          truncated: 0,
          binary: 0,
          readFailed: 0,
          budgetExcluded: 0,
        },
        files: [],
        fragments: [],
        scopeHash: session.scopeHash,
        candidateHash: "c",
        excludedCount: 0,
        historyIncluded: false,
      },
    };
    await send("changelist/run-semantic", { receiptToken: "wrong-task" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");
  });

  it("receipt-dismiss 放弃回执并说明未外发", async () => {
    const { session, send } = await createSession("changelists");
    await send("changelist/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("changelist/receipt-dismiss", { token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.changelistState?.pendingReceipt).toBeUndefined();
    expect(changelistSnapshotOf()?.feedback).toContain("已放弃语义拆分回执");
  });
});

describe("changelist/preview-apply 同文件不得重复加入（v0.0.12 §6）", () => {
  it("文件已属于其他真实 Changelist 时形成阻止 issue", async () => {
    const { send } = await createSession("changelists");
    changelistControl.groups = [{ name: "existing-cl", paths: ["app/a.ts"] }];
    await send("changelist/preview-apply", {
      name: "new-cl",
      paths: ["app/a.ts", "app/b.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = changelistSnapshotOf();
    expect(snapshot?.preview?.canExecute).toBe(false);
    expect(snapshot?.preview?.issues.join("、")).toContain(
      "已属于其他真实 Changelist",
    );
    // 同文件加入自己所属的同一 Changelist 不阻止（幂等/重放）。
    posted.length = 0;
    await send("changelist/preview-apply", {
      name: "existing-cl",
      paths: ["app/a.ts"],
    });
    await vi.waitFor(() => {
      const second = changelistSnapshotOf();
      expect(
        second?.preview?.issues.some((issue) => issue.includes("重复加入")),
      ).toBe(false);
    });
  });
});

describe("commit/generate-message 只使用仍有效的确认事实（v0.0.12 批次 B）", () => {
  it("候选 hash 一致的确认事实进入建议并展示", async () => {
    const { session, send } = await createSession("commit");
    // 写入共享存储（与当前候选 hash 一致）。
    const currentHash = hashOf();
    updateUnderstandingConfirmations({
      projectKey: `${WC_ROOT}/app`,
      scopeHash: session.scopeHash,
      candidateHash: currentHash,
      facts: [
        {
          id: "u1",
          statement: "确认 a.ts 只影响配置。",
          confirmedAt: "2026-08-18T00:00:00.000Z",
          candidateHash: currentHash,
          needsReview: false,
        },
      ],
    });
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "",
      diffMode: "metadata-only",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion?.userConfirmations).toEqual(["确认 a.ts 只影响配置。"]);
  });

  it("候选变化后确认事实被排除（绝不静默沿用）", async () => {
    const { session, send } = await createSession("commit");
    // 确认绑定旧候选 hash；当前候选已变化 → 不一致 → 排除。
    updateUnderstandingConfirmations({
      projectKey: `${WC_ROOT}/app`,
      scopeHash: session.scopeHash,
      candidateHash: "stale-hash",
      facts: [
        {
          id: "u1",
          statement: "已过期的确认。",
          confirmedAt: "2026-08-18T00:00:00.000Z",
          candidateHash: "stale-hash",
          needsReview: false,
        },
      ],
    });
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "",
      diffMode: "metadata-only",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion?.userConfirmations).toBeUndefined();
  });
});

/** 与 Host 一致的候选 hash（真实 hashCandidateState）。 */
function hashOf(): string {
  return hashCandidateState(collectorControl.candidates as never, "", []);
}
