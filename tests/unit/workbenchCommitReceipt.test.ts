import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type CommitMessageSuggestion,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import {
  hashText,
  buildCandidateId,
} from "../../src/commit/commitDiffEvidence";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.11 §3/§4 受限差异外发回执与有证据的提交说明（Controller 级）：
 * - commit/preview-receipt 只采集/脱敏/裁剪并下发回执，不调用模型；
 * - commit/generate-message（limited-diff + receiptToken）确认后调用模型，
 *   生成建议携带 coverage、回执与经校验的证据引用；
 * - 回执令牌不匹配、范围/候选变化后拒绝生成，草稿保持不变；
 * - commit/receipt-dismiss 放弃回执，不外发；
 * - 建议时效绑定工作副本 revision（adopt 前重新校验）。
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

const wcRevisionControl = vi.hoisted(() => ({ revision: "7" }));

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
      resolveWorkingCopyRevision: async () => wcRevisionControl.revision,
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

vi.mock("../../src/commit/commitDiffSummary", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commit/commitDiffSummary")>();
  return {
    ...actual,
    collectCommitDiffSummaries: async () => [],
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
  /** 命中 candidateId 返回 readFailed coverage，不产生片段。 */
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

async function createCommitSession() {
  const controller = new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
    { servedModule: "commit" },
  );
  await controller.open({
    moduleId: "commit",
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
      moduleId: "commit",
      taskId: "commit/compose",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
  };
  return { controller, session, send };
}

function messagesOfType(type: string): HostToWebviewMessage[] {
  return posted.filter((message) => message.type === type);
}

function latestCommitSnapshot(): {
  message?: string;
  feedback?: { message: string };
  messageSuggestion?: CommitMessageSuggestion;
} {
  const snapshot = [...posted]
    .reverse()
    .find(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind?: string } } }).payload
          .snapshot.kind === "commit",
    );
  return (
    (
      snapshot as {
        payload: {
          snapshot: {
            message?: string;
            feedback?: { message: string };
            messageSuggestion?: CommitMessageSuggestion;
          };
        };
      }
    )?.payload.snapshot ?? {}
  );
}

function receiptMessages() {
  return messagesOfType("commit/receipt").map(
    (message) => (message as { payload: { token: string } }).payload,
  );
}

beforeEach(() => {
  wcRevisionControl.revision = "7";
  collectorControl.fail = false;
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
      candidateId: buildCandidateId(WC_ROOT, `${WC_ROOT}/app/a.ts`),
      projectRelativePath: "app/a.ts",
      status: "modified",
      diffHash: hashText("+新增配置\n-移除旧值"),
      content: "@@ -1,1 +1,2 @@\n+新增配置\n-移除旧值",
      hunks: [
        {
          hunkId: hashText(
            `${buildCandidateId(WC_ROOT, `${WC_ROOT}/app/a.ts`)}\u0000@@ -1,1 +1,2 @@\u0000+新增配置\n-移除旧值`,
          ),
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

describe("commit/preview-receipt 受限差异回执（不调用模型）", () => {
  it("下发回执（任务/模型/预算/覆盖率/文件清单），不生成建议", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    // 只有回执消息，没有生成建议的快照。
    expect(receiptMessages()).toHaveLength(1);
    const receipt = receiptMessages()[0];
    expect(receipt.token).toBeTruthy();
    expect(latestCommitSnapshot().messageSuggestion).toBeUndefined();
    // pending 回执进入会话状态。
    expect(session.commitState?.pendingReceipt?.token).toBe(receipt.token);
    expect(session.commitState?.pendingReceipt?.scopeHash).toBe(
      session.scopeHash,
    );
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
  });

  it("没有勾选文件时不建立回执并给出中文反馈", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: [],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(receiptMessages()).toHaveLength(0);
    expect(session.commitState?.pendingReceipt).toBeUndefined();
    expect(latestCommitSnapshot().feedback?.message).toContain("请先选择文件");
  });
});

describe("commit/generate-message 受限差异确认后生成", () => {
  it("携带匹配 token 时生成建议，带 coverage/receipt/有效证据/revision", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion).toBeDefined();
    expect(suggestion?.diffMode).toBe("limited-diff");
    expect(suggestion?.metadataOnly).toBe(false);
    expect(suggestion?.coverage?.analyzed).toBe(1);
    expect(suggestion?.receipt?.task).toBe("commit-draft");
    expect(suggestion?.binding?.revision).toBe("7");
    // 证据引用全部有效（本地回退引用真实差异块）。
    expect(suggestion?.evidence?.length).toBeGreaterThan(0);
    expect(suggestion?.evidence?.every((item) => item.valid)).toBe(true);
    // 生成后 pending 回执消费清除。
    expect(session.commitState?.pendingReceipt).toBeUndefined();
    // 用户草稿保持不变（v0.0.9 §4）。
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
  });

  it("token 不匹配或缺失：拒绝生成，草稿不变，pending 清除", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: "wrong-token",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.messageSuggestion).toBeUndefined();
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(messagesOfType("operation/error").length).toBeGreaterThan(0);
    expect(
      (
        messagesOfType("operation/error")[0] as {
          payload: { title: string };
        }
      ).payload.title,
    ).toBe("外发回执已失效");
  });

  it("候选变化后回执失效：拒绝生成（fail-closed）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;

    // 候选集合变化（候选状态改变 → candidateHash 变化）。
    collectorControl.candidates = [
      {
        absolutePath: `${WC_ROOT}/app/a.ts`,
        relativePath: "app/a.ts",
        status: "deleted",
        selection: "selected",
      },
    ];

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.messageSuggestion).toBeUndefined();
    expect(messagesOfType("operation/error").length).toBeGreaterThan(0);
    expect(
      (
        messagesOfType("operation/error")[0] as {
          payload: { title: string };
        }
      ).payload.title,
    ).toBe("外发回执已失效");
  });

  it("commit/receipt-dismiss 放弃回执：pending 清除，不生成建议", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    expect(session.commitState?.pendingReceipt).toBeDefined();
    posted.length = 0;

    await send("commit/receipt-dismiss", { token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.pendingReceipt).toBeUndefined();
    expect(session.commitState?.messageSuggestion).toBeUndefined();
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    // 取消后明确说明未发生外发（规划 §3）。
    expect(latestCommitSnapshot().feedback?.message).toContain(
      "未发送任何差异内容",
    );
  });
});

describe("commit/generate-message 仅文件信息（默认）", () => {
  it("不要求回执即可生成，diffMode 为 metadata-only", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion).toBeDefined();
    expect(suggestion?.diffMode).toBe("metadata-only");
    expect(suggestion?.metadataOnly).toBe(true);
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
  });
});

describe("建议采用与时效（revision 绑定）", () => {
  it("adopt-suggestion 采用前重新校验候选与范围；建议携带 revision", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion).toBeDefined();
    expect(suggestion?.binding?.revision).toBe("7");
    posted.length = 0;

    await send("commit/adopt-suggestion", {
      token: suggestion?.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toContain("app/a.ts");
  });
});

describe("commit/open-evidence 打开证据（v0.0.11 §4）", () => {
  async function generateLimitedSuggestion(
    send: (action: string, data?: Record<string, unknown>) => Promise<void>,
  ): Promise<{
    suggestion: CommitMessageSuggestion;
    validEvidence: NonNullable<CommitMessageSuggestion["evidence"]>[number];
  }> {
    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = latestCommitSnapshot().messageSuggestion;
    if (!suggestion) throw new Error("没有生成建议");
    const validEvidence = suggestion.evidence?.find((item) => item.valid);
    if (!validEvidence) throw new Error("没有有效证据");
    return { suggestion, validEvidence };
  }

  it("有效证据引用打开对应文件差异（路由到 diff 会话）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    const { suggestion, validEvidence } = await generateLimitedSuggestion(send);
    posted.length = 0;

    await send("commit/open-evidence", {
      token: suggestion.token,
      candidateId: validEvidence.reference.candidateId,
      hunkId: validEvidence.reference.hunkId,
      projectRelativePath: validEvidence.reference.projectRelativePath,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 未接线窗口路由时在面板内切换到 diff 会话，目标为该证据文件。
    expect(session.moduleId).toBe("diff");
    expect(session.targetFile).toBe(`${WC_ROOT}/app/a.ts`);
  });

  it("token 不匹配或引用不在有效证据集合内：拒绝打开", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await generateLimitedSuggestion(send);
    posted.length = 0;

    await send("commit/open-evidence", {
      token: "wrong-token",
      candidateId: "ghost",
      projectRelativePath: "app/a.ts",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.moduleId).toBe("commit");
    expect(
      (messagesOfType("operation/error")[0] as { payload: { title: string } })
        .payload.title,
    ).toBe("无法打开证据");
  });

  it("建议过期后拒绝打开证据", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    const { suggestion, validEvidence } = await generateLimitedSuggestion(send);
    posted.length = 0;
    // 候选状态变化使建议过期（candidateHash 不匹配）。
    collectorControl.candidates = [
      {
        absolutePath: `${WC_ROOT}/app/a.ts`,
        relativePath: "app/a.ts",
        status: "deleted",
        selection: "selected",
      },
    ];

    await send("commit/open-evidence", {
      token: suggestion.token,
      candidateId: validEvidence.reference.candidateId,
      projectRelativePath: validEvidence.reference.projectRelativePath,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.moduleId).toBe("commit");
    expect(
      (messagesOfType("operation/error")[0] as { payload: { title: string } })
        .payload.title,
    ).toBe("建议已过期");
  });
});

describe("commit/retry-failed-diff 只重试失败项（v0.0.11 §6）", () => {
  it("存在失败项时对失败文件重新采集并下发回执（不调用模型）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    // 首次采集即存在读取失败项（app/a.ts），建议携带 coverageFiles。
    diffControl.readFailedIds = [
      buildCandidateId(WC_ROOT, `${WC_ROOT}/app/a.ts`),
    ];
    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    expect(
      suggestion?.coverageFiles?.some((file) => file.state === "readFailed"),
    ).toBe(true);
    posted.length = 0;

    // 重试只重采集失败项并下发回执，不调用模型。
    await send("commit/retry-failed-diff", { token: suggestion?.token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(receiptMessages()).toHaveLength(1);
    expect(session.commitState?.pendingReceipt?.retryNote).toContain(
      "重试仅覆盖 1 个",
    );
    // 未调用模型：没有生成新建议，草稿不变。
    expect(session.commitState?.messageSuggestion?.token).toBe(
      suggestion?.token,
    );
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
  });

  it("没有可重试失败项时给出中文反馈", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    posted.length = 0;

    await send("commit/retry-failed-diff", { token: suggestion?.token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(receiptMessages()).toHaveLength(0);
    expect(session.commitState?.pendingReceipt).toBeUndefined();
    expect(latestCommitSnapshot().feedback?.message).toContain(
      "没有可重试的失败项",
    );
  });

  it("仅文件信息建议不支持重试失败项", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "metadata-only",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const suggestion = session.commitState?.messageSuggestion;
    posted.length = 0;

    await send("commit/retry-failed-diff", { token: suggestion?.token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(
      (messagesOfType("operation/error")[0] as { payload: { title: string } })
        .payload.title,
    ).toBe("无法重试失败项");
  });
});

describe("commit/generate-message 受限差异逐条声明（v0.0.11 §5）", () => {
  it("建议携带 claims：已证实声明带有效证据，无证据的待确认项保留", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/preview-receipt", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "limited-diff",
      receiptToken: token,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion?.claims?.length).toBeGreaterThan(0);
    // 本地回退为已分析文件生成 confirmed 声明，且证据经 Host 校验后有效。
    const confirmed = suggestion?.claims?.find(
      (claim) => claim.status === "confirmed",
    );
    expect(confirmed).toBeDefined();
    expect(confirmed?.evidence.length).toBeGreaterThan(0);
    expect(confirmed?.downgraded).toBe(false);
    // 声明的证据可被 open-evidence 打开。
    expect(suggestion?.evidence?.length).toBeGreaterThan(0);
  });

  it("仅文件信息模式不生成 claims", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts"],
      message: "需求: 修复登录超时",
      diffMode: "metadata-only",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.messageSuggestion?.claims).toBeUndefined();
    expect(session.commitState?.messageSuggestion?.diffMode).toBe(
      "metadata-only",
    );
  });
});
