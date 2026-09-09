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
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * V025-R50 · 语义拆分输入与用户选择一致（先复现后修复）。
 * 复现证据：.validation/evidence/v0.2.x/r50-repro/repro.log（红跑记录）。
 * 四阶段路径集合：交接 session.selectedPaths → 改选 payload →
 * 回执 pendingReceipt/files → 模型请求 buildCommitSplitAiRequest.files。
 * 现状缺陷：preview-receipt / run-semantic 的 selectedPaths 从全部非
 * blocked/excluded 候选推导，不等于明确勾选集合；模型结果静默修剪。
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

/**
 * 忠实 mock：按传入 selectedPaths 过滤片段（与真实
 * collectUnderstandingDiffs → collectLimitedCommitDiffs 契约一致）。
 */
vi.mock("../../src/commit/commitDiffCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/commit/commitDiffCollector")
    >();
  return {
    ...actual,
    collectLimitedCommitDiffs: async (input: {
      selectedPaths: string[];
      scope: { repositoryRoot: string };
    }) => {
      const path = await import("node:path");
      const picked = (input.selectedPaths ?? []).map((absolutePath) => {
        const relativePath = path
          .relative(input.scope.repositoryRoot, absolutePath)
          .replace(/\\/g, "/");
        return {
          candidateId: buildCandidateId(
            input.scope.repositoryRoot,
            absolutePath,
          ),
          projectRelativePath: relativePath,
          status: "modified",
          diffHash: `hash-${relativePath}`,
          content: `@@ -1 +1 @@\n+${relativePath}`,
          hunks: [{ hunkId: "h-1", header: "@@ -1 +1 @@" }],
          truncated: false,
          binary: false,
        };
      });
      return {
        fragments: picked,
        coverage: picked.map((fragment) => ({
          candidateId: fragment.candidateId,
          projectRelativePath: fragment.projectRelativePath,
          status: fragment.status,
          state: "analyzed" as const,
          diffHash: fragment.diffHash,
          charCount: fragment.content.length,
          hunkCount: fragment.hunks.length,
        })),
        summary: {
          total: picked.length,
          analyzed: picked.length,
          truncated: 0,
          binary: 0,
          readFailed: 0,
          budgetExcluded: 0,
        },
        revision: "7",
        excludedCount: 0,
      };
    },
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
  return (
    snapshot as {
      payload: { snapshot: ChangelistsSnapshot };
    }
  )?.payload.snapshot;
}

function receiptMessages() {
  return posted
    .filter((message) => message.type === "changelist/receipt")
    .map(
      (message) =>
        message as {
          payload: {
            token: string;
            files: Array<{ projectRelativePath: string }>;
          };
        },
    );
}

function errorTitles(): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) => (message as { payload: { title: string } }).payload.title,
    );
}

/** 目录 10 项候选（全部 selection=selected，可提交）。 */
function tenCandidates() {
  collectorControl.candidates = Array.from({ length: 10 }, (_, index) => {
    const name = `f${String(index + 1).padStart(2, "0")}.ts`;
    return {
      absolutePath: `${WC_ROOT}/app/${name}`,
      relativePath: `app/${name}`,
      status: "modified",
      selection: "selected",
    };
  });
}

beforeEach(() => {
  tenCandidates();
  changelistControl.groups = [];
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("V025-R50 语义拆分输入与用户选择一致", () => {
  it("R50-1：目录 10 项仅勾 2 项时，回执只含这 2 项", async () => {
    const { send } = await createSession();
    await send("changelist/preview-receipt", {
      selectedPaths: ["app/f01.ts", "app/f02.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    const files = receiptMessages()[0].payload.files.map(
      (file) => file.projectRelativePath,
    );
    expect(files.sort()).toEqual(["app/f01.ts", "app/f02.ts"]);
  });

  it("R50-2：空选择时不生成回执，要求明确选择分析范围", async () => {
    const { session, send } = await createSession();
    await send("changelist/preview-receipt", { selectedPaths: [] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(0);
    expect(session.changelistState?.pendingReceipt).toBeUndefined();
    expect(changelistSnapshotOf()?.feedback).toContain("选择");
  });

  it("R50-3：当前范围全部候选是显式选项（selectAll），仍不超出原 scope", async () => {
    const { send } = await createSession();
    await send("changelist/preview-receipt", { selectAll: true });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    const files = receiptMessages()[0].payload.files.map(
      (file) => file.projectRelativePath,
    );
    expect(files).toHaveLength(10);
    expect(files.every((file) => file.startsWith("app/"))).toBe(true);
  });

  it("R50-4：改选后旧 token 被拒（回执绑定明确勾选集合）", async () => {
    const { session, send } = await createSession();
    await send("changelist/preview-receipt", {
      selectedPaths: ["app/f01.ts", "app/f02.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].payload.token;
    posted.length = 0;
    // 用户改选为另 2 项后，用旧 token 确认。
    await send("changelist/run-semantic", {
      receiptToken: token,
      selectedPaths: ["app/f03.ts", "app/f04.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");
    expect(session.changelistState?.pendingReceipt).toBeUndefined();
    expect(changelistSnapshotOf()?.suggestions ?? []).toHaveLength(0);
  });

  it("R50-5：模型虚构/重复/范围外路径整体被拒，人工选择保留", async () => {
    const { controller, session, send } = await createSession();
    await send("changelist/preview-receipt", {
      selectedPaths: ["app/f01.ts", "app/f02.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].payload.token;
    // 人工选择与草稿（必须保留）。
    session.selectedPaths = ["app/f01.ts", "app/f02.ts"];
    // 伪造配置模型路径：解析存储 provider 成功，返回含虚构/重复/范围外路径的结果。
    vi.spyOn(
      controller as unknown as {
        resolveStoredAiProvider: (scenario: string) => Promise<never>;
      },
      "resolveStoredAiProvider",
    ).mockResolvedValue({} as never);
    const { OpenAiCompatibleProvider } =
      await import("../../src/ai/openAiCompatibleProvider");
    const splitSpy = vi
      .spyOn(OpenAiCompatibleProvider.prototype, "suggestCommitSplits")
      .mockImplementation(async (request) => {
        // 模型请求必须只含明确勾选的 2 项。
        expect(request.files.map((file) => file.path).sort()).toEqual([
          "app/f01.ts",
          "app/f02.ts",
        ]);
        return {
          splits: [
            {
              id: "s1",
              title: "拆分 1",
              summary: "虚构",
              message: "msg",
              paths: ["app/f01.ts", "app/ghost.ts"],
              reason: "r",
              risks: [],
            },
            {
              id: "s2",
              title: "拆分 2",
              summary: "重复+越界",
              message: "msg",
              paths: ["app/f01.ts", "../outside.ts"],
              reason: "r",
              risks: [],
            },
          ],
          warnings: [],
        };
      });
    try {
      posted.length = 0;
      await send("changelist/run-semantic", {
        receiptToken: token,
        selectedPaths: ["app/f01.ts", "app/f02.ts"],
      });
      await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
      // 整份建议被拒：不展示修剪后的残余。
      expect(changelistSnapshotOf()?.suggestions ?? []).toHaveLength(0);
      const feedback = changelistSnapshotOf()?.feedback ?? "";
      expect(feedback).toContain("拒绝");
      // 人工选择与草稿继续保留。
      expect(session.selectedPaths).toEqual(["app/f01.ts", "app/f02.ts"]);
    } finally {
      splitSpy.mockRestore();
    }
  });

  it("R50-5b：预置手工建议遇严格失败后清空建议但人工选择保留", async () => {
    const { controller, session, send } = await createSession();
    await send("changelist/preview-receipt", {
      selectedPaths: ["app/f01.ts", "app/f02.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].payload.token;
    // 预置手工/本地整理建议与人工选择（平台无关相对路径断言）。
    // 注意：仅替换 suggestions，保留 preview-receipt 建立的 pendingReceipt。
    if (!session.changelistState) throw new Error("缺少 changelistState");
    session.changelistState.suggestions = [
      {
        id: "manual-1",
        title: "人工方案",
        summary: "人工保留",
        message: "人工保留",
        paths: ["app/f01.ts"],
        reason: "人工",
        risks: [],
      },
    ];
    session.selectedPaths = ["app/f01.ts", "app/f02.ts"];
    vi.spyOn(
      controller as unknown as {
        resolveStoredAiProvider: (scenario: string) => Promise<never>;
      },
      "resolveStoredAiProvider",
    ).mockResolvedValue({} as never);
    const { OpenAiCompatibleProvider } =
      await import("../../src/ai/openAiCompatibleProvider");
    const splitSpy = vi
      .spyOn(OpenAiCompatibleProvider.prototype, "suggestCommitSplits")
      .mockResolvedValue({
        splits: [
          {
            id: "bad-1",
            title: "无效拆分",
            summary: "虚构",
            message: "msg",
            paths: ["app/f01.ts", "app/ghost.ts"],
            reason: "r",
            risks: [],
          },
        ],
        warnings: [],
      });
    try {
      posted.length = 0;
      await send("changelist/run-semantic", {
        receiptToken: token,
        selectedPaths: ["app/f01.ts", "app/f02.ts"],
      });
      await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
      // 严格失败清空建议（含此前本地整理建议），但人工选择保留。
      expect(changelistSnapshotOf()?.suggestions ?? []).toHaveLength(0);
      expect(session.selectedPaths).toEqual(["app/f01.ts", "app/f02.ts"]);
      const feedback = changelistSnapshotOf()?.feedback ?? "";
      expect(feedback).toContain("已一并清空");
      expect(feedback).toContain("人工选择保留");
    } finally {
      splitSpy.mockRestore();
    }
  });

  it("R50-7：会话共享选择与刷新后候选求交收缩并说明移除原因", async () => {
    const { session, send } = await createSession();
    // 交接带入 3 项，其中 1 项已不在当前候选（过期）。
    session.selectedPaths = ["app/f01.ts", "app/f02.ts", "app/ghost.ts"];
    await send("changelist/preview-receipt", {});
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    const files = receiptMessages()[0].payload.files.map(
      (file) => file.projectRelativePath,
    );
    expect(files.sort()).toEqual(["app/f01.ts", "app/f02.ts"]);
    expect(changelistSnapshotOf()?.feedback).toContain("收缩");
  });

  it("R50-6：取消回执无外发（provider 零调用）", async () => {
    const { session, send } = await createSession();
    const { OpenAiCompatibleProvider } =
      await import("../../src/ai/openAiCompatibleProvider");
    const splitSpy = vi
      .spyOn(OpenAiCompatibleProvider.prototype, "suggestCommitSplits")
      .mockRejectedValue(new Error("不应调用模型"));
    try {
      await send("changelist/preview-receipt", {
        selectedPaths: ["app/f01.ts", "app/f02.ts"],
      });
      await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
      const token = receiptMessages()[0].payload.token;
      posted.length = 0;
      await send("changelist/receipt-dismiss", { token });
      await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
      expect(session.changelistState?.pendingReceipt).toBeUndefined();
      expect(splitSpy).not.toHaveBeenCalled();
      expect(changelistSnapshotOf()?.feedback).toContain("未发送");
    } finally {
      splitSpy.mockRestore();
    }
  });
});
