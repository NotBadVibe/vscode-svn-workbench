import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type ChangeUnderstandingSnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { buildCandidateId } from "../../src/commit/commitDiffEvidence";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.12 批次 A：变更解读 Controller 级 —— run-local 不调用模型；
 * preview-receipt 只下发回执；run-model 校验任务/token/范围/候选；
 * 确认仅会话内且变化待复核；open-evidence 复验后路由 Diff；
 * retry-failed 只重采失败项；回执跨任务一律拒绝。
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
    propStatus?: string;
    fileType?: string;
    templateGroup?: string;
    generatedDecision?: string;
    reason?: string;
  }>,
  fail: false,
}));

vi.mock("../../src/commit/commitCandidateCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitCandidateCollector")
    >();
  return {
    ...actual,
    collectCommitCandidates: async () => {
      if (collectorControl.fail) throw new Error("svn 状态采集失败");
      return collectorControl.candidates;
    },
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
  readFailedIds: [] as string[],
  revision: "7",
}));

vi.mock("../../src/commit/commitDiffCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitDiffCollector")
    >();
  return {
    ...actual,
    collectLimitedCommitDiffs: async () => {
      const failed = new Set(diffControl.readFailedIds);
      const coverage = diffControl.fragments.map((fragment) => {
        const isFailed = failed.has(fragment.candidateId);
        return {
          candidateId: fragment.candidateId,
          projectRelativePath: fragment.projectRelativePath,
          status: fragment.status,
          state: isFailed ? ("readFailed" as const) : ("analyzed" as const),
          diffHash: isFailed ? "" : fragment.diffHash,
          charCount: isFailed ? 0 : fragment.content.length,
          hunkCount: isFailed ? 0 : fragment.hunks.length,
          ...(isFailed ? { reason: "svn diff 读取失败" } : {}),
        };
      });
      return {
        fragments: diffControl.fragments.filter(
          (fragment) => !failed.has(fragment.candidateId),
        ),
        coverage,
        summary: {
          total: coverage.length,
          analyzed: coverage.filter((item) => item.state === "analyzed").length,
          truncated: 0,
          binary: 0,
          readFailed: coverage.filter((item) => item.state === "readFailed")
            .length,
          budgetExcluded: 0,
        },
        revision: diffControl.revision,
        excludedCount: 0,
      };
    },
  };
});

const WC_ROOT = "/repo/code";
const CAND_A = buildCandidateId(WC_ROOT, `${WC_ROOT}/app/a.ts`);
const HUNK_A = buildCandidateId(
  `${WC_ROOT}\u0000@@ -1,1 +1,2 @@\u0000+新增配置\n-移除旧值`,
);

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

async function createUnderstandingSession() {
  const controller = new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
    { servedModule: "understanding" },
  );
  await controller.open({
    moduleId: "understanding",
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
      moduleId: "understanding",
      taskId: "understanding/analyze",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
  };
  return { controller, session, send };
}

function understandingSnapshotOf(): ChangeUnderstandingSnapshot | undefined {
  const snapshot = [...posted]
    .reverse()
    .find(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind?: string } } }).payload
          .snapshot.kind === "change-understanding",
    );
  return (
    snapshot as {
      payload: { snapshot: ChangeUnderstandingSnapshot };
    }
  )?.payload.snapshot;
}

function receiptMessages() {
  return posted
    .filter((message) => message.type === "understanding/receipt")
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
  collectorControl.fail = false;
  collectorControl.candidates = [
    {
      absolutePath: `${WC_ROOT}/app/a.ts`,
      relativePath: "app/a.ts",
      status: "modified",
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
      hunks: [
        {
          hunkId: HUNK_A,
          header: "@@ -1,1 +1,2 @@",
        },
      ],
      truncated: false,
      binary: false,
    },
  ];
  diffControl.readFailedIds = [];
  diffControl.revision = "7";
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("understanding/run-local（只本地检查，不调用模型）", () => {
  it("生成 ready 快照，来源 local-rule，声明为推断", async () => {
    const { send } = await createUnderstandingSession();
    await send("understanding/run-local", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = understandingSnapshotOf();
    expect(snapshot?.state).toBe("ready");
    expect(snapshot?.source).toBe("local-rule");
    expect(snapshot?.changes.length).toBeGreaterThan(0);
    expect(snapshot?.changes[0].status).toBe("inferred");
    expect(snapshot?.binding?.revision).toBe("7");
    // 未调用模型：没有模型来源。
    expect(
      snapshot?.changes.some((item) => item.source === "configured-model"),
    ).toBe(false);
  });
});

describe("understanding/preview-receipt 与 run-model", () => {
  it("preview-receipt 只下发回执（不调用模型、不生成结果）", async () => {
    const { session, send } = await createUnderstandingSession();
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    const pending = session.understandingState?.pendingReceipt;
    expect(pending?.task).toBe("understand-changes");
  });

  it("run-model 携带匹配 token 时生成模型结果（本地回退来源）", async () => {
    const { session, send } = await createUnderstandingSession();
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("understanding/run-model", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = understandingSnapshotOf();
    expect(snapshot?.state).toBe("ready");
    // 未配置模型 → 本地回退来源。
    expect(snapshot?.source).toBe("local-rule-fallback");
    expect(session.understandingState?.pendingReceipt).toBeUndefined();
    expect(session.understandingState?.binding?.candidateHash).toBeTruthy();
  });

  it("token 不匹配 / 任务不符 / 候选变化：拒绝并说明", async () => {
    const { send } = await createUnderstandingSession();
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    // token 不匹配。
    await send("understanding/run-model", { receiptToken: "wrong" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");

    // 候选变化后旧回执失效（重新 preview → 新 token → 改候选 → 拒绝）。
    posted.length = 0;
    collectorControl.candidates = [
      {
        absolutePath: `${WC_ROOT}/app/a.ts`,
        relativePath: "app/a.ts",
        status: "deleted",
        selection: "selected",
      },
    ];
    await send("understanding/run-model", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");
  });

  it("跨任务回执一律拒绝：用 commit 回执 token 调用 run-model 无效", async () => {
    const { session, send } = await createUnderstandingSession();
    // 伪造一个 commit-draft 任务的 pending 回执。
    session.understandingState = {
      userConfirmations: [],
      pendingReceipt: {
        token: "commit-token",
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
    await send("understanding/run-model", { receiptToken: "commit-token" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");
  });

  it("receipt-dismiss 放弃回执并说明未外发", async () => {
    const { session, send } = await createUnderstandingSession();
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("understanding/receipt-dismiss", { token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.understandingState?.pendingReceipt).toBeUndefined();
    expect(understandingSnapshotOf()?.feedback?.message).toContain(
      "未发送任何差异内容",
    );
  });
});

describe("understanding/confirm-fact（会话内确认与待复核）", () => {
  it("确认事实写入会话状态，快照可见；清除可移除", async () => {
    const { session, send } = await createUnderstandingSession();
    await send("understanding/confirm-fact", {
      statement: "确认 a.ts 只影响配置。",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.understandingState?.userConfirmations).toHaveLength(1);
    expect(understandingSnapshotOf()?.userConfirmations[0].statement).toBe(
      "确认 a.ts 只影响配置。",
    );
    posted.length = 0;
    await send("understanding/clear-confirmations", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.understandingState?.userConfirmations).toHaveLength(0);
  });

  it("候选变化后确认标记待复核，不会静默沿用", async () => {
    const { send } = await createUnderstandingSession();
    await send("understanding/confirm-fact", { statement: "事实 A。" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    collectorControl.candidates = [
      {
        absolutePath: `${WC_ROOT}/app/a.ts`,
        relativePath: "app/a.ts",
        status: "deleted",
        selection: "selected",
      },
    ];
    await send("refresh", {});
    await vi.waitFor(() => {
      const snap = understandingSnapshotOf();
      expect(snap?.userConfirmations?.[0]?.needsReview).toBe(true);
    });
    expect(understandingSnapshotOf()?.userConfirmations[0].needsReview).toBe(
      true,
    );
  });

  it("项目切换守卫把会话内确认计为未完成内容", async () => {
    const { collectUnfinishedContent } =
      await import("../../src/extension/workbench/projectSwitchGuard");
    const check = collectUnfinishedContent({
      hasUnderstandingConfirmations: true,
    });
    expect(check.hasContent).toBe(true);
    expect(check.reasons.join("、")).toContain("变更解读的会话内确认");
  });
});

describe("understanding/open-evidence 与 retry-failed", () => {
  async function runModel(
    send: (a: string, d?: Record<string, unknown>) => Promise<void>,
  ) {
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("understanding/run-model", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
  }

  it("open-evidence 打开有效证据对应文件差异", async () => {
    const { session, send } = await createUnderstandingSession();
    await runModel(send);
    posted.length = 0;
    await send("understanding/open-evidence", {
      candidateId: CAND_A,
      hunkId: HUNK_A,
      projectRelativePath: "app/a.ts",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.moduleId).toBe("diff");
    expect(session.targetFile).toBe(`${WC_ROOT}/app/a.ts`);
  });

  it("open-evidence 拒绝虚构/无效证据", async () => {
    const { session, send } = await createUnderstandingSession();
    await runModel(send);
    posted.length = 0;
    await send("understanding/open-evidence", {
      candidateId: "ghost",
      projectRelativePath: "app/ghost.ts",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.moduleId).toBe("understanding");
    expect(errorTitles()).toContain("证据已失效");
  });

  it("retry-failed 只对读取失败项重采并下发回执", async () => {
    const { session, send } = await createUnderstandingSession();
    // 首次分析即有读取失败项。
    diffControl.readFailedIds = [CAND_A];
    await send("understanding/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("understanding/run-model", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = understandingSnapshotOf();
    expect(snapshot?.state).toBe("partial");
    posted.length = 0;
    await send("understanding/retry-failed", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    expect(session.understandingState?.pendingReceipt?.retryNote).toContain(
      "重试仅覆盖 1 个",
    );
  });
});
