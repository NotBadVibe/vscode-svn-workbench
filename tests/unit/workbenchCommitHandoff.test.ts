import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import { buildCommitPlanPreview } from "../../src/commit/commitPlanBuilder";
import type { CommitCandidate } from "../../src/commit/commitCandidateCollector";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.1.4 V014-E：Changes → Commit 交接 Host 单测（Host + 协议 + 单测，
 * Commit UI 显示属 E2）。
 *
 * 复验落点：目标打开 Commit 时（open()/同窗 open-module），复用快照构建
 * 同一批权威候选，不在源窗口额外全量采集。
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
  }>,
  count: 0,
}));

vi.mock("../../src/commit/commitDiffSummary", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commit/commitDiffSummary")>();
  return {
    ...actual,
    collectCommitDiffSummaries: async () => [],
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
      collectorControl.count += 1;
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

function createController(servedModule: "commit" | "changes") {
  return new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
    { servedModule },
  );
}

function sessionOf(controller: WorkbenchController): WorkbenchSession {
  const session = (controller as unknown as ControllerInternals).session;
  if (!session) throw new Error("会话尚未建立");
  return session;
}

function trackPosts(): HostToWebviewMessage[] {
  const posted: HostToWebviewMessage[] = [];
  const panel = __webviewPanels[__webviewPanels.length - 1];
  panel.webview.postMessage = async (message: unknown) => {
    posted.push(message as HostToWebviewMessage);
  };
  return posted;
}

async function send(
  session: WorkbenchSession,
  action: string,
  data?: Record<string, unknown>,
) {
  const panel = __webviewPanels[__webviewPanels.length - 1];
  await panel.__onMessage?.({
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "workbench/action",
    moduleId: session.moduleId,
    taskId: session.taskId,
    sessionId: session.sessionId,
    repositoryUuid: session.repositoryUuid,
    scopeHash: session.scopeHash,
    payload: { action, data },
  });
}

function commitSnapshots(posted: HostToWebviewMessage[]) {
  return posted
    .filter(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind: string } } }).payload
          .snapshot.kind === "commit",
    )
    .map(
      (message) =>
        (
          message as {
            payload: { snapshot: Record<string, unknown> };
          }
        ).payload.snapshot,
    );
}

function errorMessages(posted: HostToWebviewMessage[]): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) =>
        (message as { payload: { message: string } }).payload.message,
    );
}

beforeEach(() => {
  __resetWebviewPanels();
  collectorControl.count = 0;
  collectorControl.candidates = [
    {
      absolutePath: `${WC_ROOT}/app/a.ts`,
      relativePath: "app/a.ts",
      status: "modified",
      selection: "selected",
    },
    {
      absolutePath: `${WC_ROOT}/app/review.ts`,
      relativePath: "app/review.ts",
      status: "modified",
      selection: "needsReview",
    },
    {
      absolutePath: `${WC_ROOT}/app/excluded.ts`,
      relativePath: "app/excluded.ts",
      status: "modified",
      selection: "excluded",
    },
    {
      absolutePath: `${WC_ROOT}/app/blocked.ts`,
      relativePath: "app/blocked.ts",
      status: "conflicted",
      selection: "blocked",
    },
  ];
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("跨窗口 open() 交接整批复验", () => {
  it("部分非法 → 收缩为合法交集，handoff 记录来源与移除原因", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/a.ts", "app/ghost.ts", "app/excluded.ts"],
    });
    const session = sessionOf(controller);
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.preview).toBeUndefined();
    // 交接选择不得虚构成手动选择。
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
    const handoff = session.commitState?.handoff;
    expect(handoff?.source).toBe("changes");
    expect(handoff?.selectionVersion).toBe(1);
    expect(handoff?.requestedCount).toBe(3);
    expect(handoff?.keptCount).toBe(1);
    expect(handoff?.removedEntries.map((entry) => entry.reason).sort()).toEqual(
      ["disappeared", "excluded"],
    );

    const posted = trackPosts();
    await send(session, "commit/update-draft", { message: "feat: 交接" });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    const snapshot = commitSnapshots(posted).at(-1)!;
    expect(snapshot.handoff).toMatchObject({ source: "changes" });
    expect((snapshot.feedback as { message: string }).message).toContain(
      "范围未扩大",
    );
  });

  it("全部非法 → 拒绝打开：会话恢复，不改动选择", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/ghost.ts", "app/excluded.ts", "app/blocked.ts"],
    });
    // 无旧会话：新会话被丢弃，未创建面板。
    expect(
      (controller as unknown as ControllerInternals).session,
    ).toBeUndefined();
    expect(__webviewPanels).toHaveLength(0);
  });

  it("空交接保持原有打开行为（默认推荐选择，无 handoff）", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
    });
    const session = sessionOf(controller);
    const posted = trackPosts();
    await send(session, "commit/update-draft", {
      message: session.commitState?.message ?? "",
    });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    expect(commitSnapshots(posted).at(-1)!.handoff).toBeUndefined();
  });
});

describe("同窗 open-module 交接", () => {
  it("收缩交接复验后记录 handoff（与跨窗口语义一致）", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
    });
    const posted = trackPosts();
    const session = sessionOf(controller);
    await send(session, "open-module", {
      moduleId: "commit",
      selectedPaths: ["app/a.ts", "app/ghost.ts"],
    });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    expect(session.moduleId).toBe("commit");
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.handoff?.keptCount).toBe(1);
    expect(session.commitState?.handoff?.source).toBe("changes");
  });

  it("全拒交接不改动当前选择并中文报错", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/a.ts"],
    });
    const session = sessionOf(controller);
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    const posted = trackPosts();
    await send(session, "open-module", {
      moduleId: "commit",
      selectedPaths: ["app/ghost.ts", "app/blocked.ts"],
    });
    await vi.waitFor(() =>
      expect(errorMessages(posted).length).toBeGreaterThan(0),
    );
    expect(session.moduleId).toBe("commit");
    // 拒绝不修改既有选择与交接记录。
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.handoff?.keptCount).toBe(1);
    expect(errorMessages(posted)[0]).toContain("已全部失效");
  });
});

describe("交接后失效链", () => {
  it("Commit 侧手动改选 → handoff 失效，preview 失效，草稿保留", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/a.ts"],
    });
    const session = sessionOf(controller);
    expect(session.commitState?.handoff?.source).toBe("changes");
    const posted = trackPosts();
    await send(session, "commit/update-draft", { message: "feat: 草稿保留" });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    posted.length = 0;
    await send(session, "commit/update-selection", {
      selectedPaths: ["app/review.ts"],
    });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    expect(session.commitState?.handoff).toBeUndefined();
    expect(session.commitState?.preview).toBeUndefined();
    expect(session.commitState?.message).toBe("feat: 草稿保留");
    expect(commitSnapshots(posted).at(-1)!.handoff).toBeUndefined();
  });

  it("交接后出现冲突 → preview 失效并给出处理冲突指引，草稿保留", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/a.ts"],
    });
    const session = sessionOf(controller);
    const posted = trackPosts();
    await send(session, "commit/update-draft", { message: "feat: 冲突前草稿" });
    await send(session, "commit/preview", {});
    await vi.waitFor(() =>
      expect(
        commitSnapshots(posted).some(
          (snapshot) => snapshot.preview !== undefined,
        ),
      ).toBe(true),
    );
    expect(session.commitState?.preview).toBeDefined();
    // 工作副本出现冲突：a.ts 变为阻止项。
    collectorControl.candidates = collectorControl.candidates.map((item) =>
      item.relativePath === "app/a.ts"
        ? { ...item, status: "conflicted", selection: "blocked" }
        : item,
    );
    posted.length = 0;
    await send(session, "refresh", {});
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    expect(session.commitState?.preview).toBeUndefined();
    expect(session.commitState?.message).toBe("feat: 冲突前草稿");
    const snapshot = commitSnapshots(posted).at(-1)!;
    expect((snapshot.feedback as { message: string }).message).toContain(
      "处理冲突",
    );
    // 交接记录保留，供 E2 展示来源。
    expect(session.commitState?.handoff?.source).toBe("changes");
  });

  it("旧版本 handoff 在快照挂载时忽略", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["app/a.ts"],
    });
    const session = sessionOf(controller);
    session.commitState!.handoff = {
      ...session.commitState!.handoff!,
      selectionVersion: 999,
    };
    const posted = trackPosts();
    await send(session, "commit/update-draft", {
      message: session.commitState?.message ?? "",
    });
    await vi.waitFor(() =>
      expect(commitSnapshots(posted).length).toBeGreaterThan(0),
    );
    expect(commitSnapshots(posted).at(-1)!.handoff).toBeUndefined();
  });
});

describe("跨仓库交接不合并 revision", () => {
  it("另一仓库的选择在当前仓库全拒（open 层）", async () => {
    const controller = createController("commit");
    await controller.open({
      moduleId: "commit",
      svnPath: "svn",
      scope: makeScope(),
      selectedPaths: ["other-repo/b.ts"],
    });
    expect(
      (controller as unknown as ControllerInternals).session,
    ).toBeUndefined();
  });

  it("混合仓库绝对路径不合并：越界路径进入阻止项且不可提交", () => {
    const scope = makeScope();
    const candidates = [
      {
        absolutePath: `${WC_ROOT}/app/a.ts`,
        relativePath: "app/a.ts",
        status: "modified",
        selection: "selected",
      },
    ] as CommitCandidate[];
    const plan = buildCommitPlanPreview(scope, candidates, [
      `${WC_ROOT}/app/a.ts`,
      "/other-repo/b.ts",
    ]);
    expect(plan.canCommit).toBe(false);
    expect(plan.issues.some((issue) => issue.path === "/other-repo/b.ts")).toBe(
      true,
    );
    // 合法路径仍可独立提交，不与越界路径合并为一次 revision 依据。
    const clean = buildCommitPlanPreview(scope, candidates, [
      `${WC_ROOT}/app/a.ts`,
    ]);
    expect(clean.commitPaths).toEqual([`${WC_ROOT}/app/a.ts`]);
  });
});
