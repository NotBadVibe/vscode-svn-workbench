import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import type {
  PathIdentityKey,
  PathSemantics,
} from "../../src/scope/pathIdentity";
import { createScopedFileKey } from "../../src/scope/projectIdentity";
import { hashOperationScope } from "../../src/extension/workbench/workbenchSupport";
import {
  createContinuityContext,
  invalidateContinuity,
} from "../../src/extension/workbench/taskContinuity";
import {
  buildContinuityRestore,
  continuityResolveKey,
  migrateContinuityForReopen,
} from "../../src/extension/workbench/taskContinuityWiring";
import {
  isChangesSnapshot,
  isContinuityRestoreView,
  WORKBENCH_PROTOCOL_VERSION,
  type ChangesSnapshot,
  type ContinuityRestoreView,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.1.4 V014-C1：连续上下文 Host 接线（协议 + Host + Mock + 守卫 + Host 单测）。
 * Webview 业务消费属 C2，本文件只覆盖 Host 侧与协议守卫。
 *
 * 路径语义：显式构造宿主集成语义对象，不导入生产 native 单例
 * （测试夹具与生产边界隔离，见 pathIdentityBoundary.test.ts）。
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

/** 候选采集控制：避免调用真实 SVN。 */
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

const WC_ROOT = path.resolve("/repo/continuity");
const hostSemantics: PathSemantics = {
  platform: process.platform,
  cwd: process.cwd(),
};
const asKey = (value: string): PathIdentityKey => value as PathIdentityKey;

function scopeWithRoots(roots: string[]): OperationScope {
  return {
    id: "scope-continuity",
    repositoryRoot: WC_ROOT,
    source: "explorerFolder",
    roots: roots.map((absolutePath) => ({
      absolutePath,
      relativePath: path.relative(WC_ROOT, absolutePath) || ".",
      kind: "folder" as const,
    })),
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

function baseScope(): OperationScope {
  return scopeWithRoots([path.join(WC_ROOT, "appA")]);
}

function makeSession(
  overrides: Partial<WorkbenchSession> = {},
): WorkbenchSession {
  const scope = baseScope();
  return {
    moduleId: "changes",
    taskId: "changes/overview",
    svnPath: "svn",
    sessionId: "session-1",
    scopeView: {} as WorkbenchSession["scopeView"],
    repositoryUuid: "uuid-1",
    scopeHash: hashOperationScope(scope),
    aiModels: {},
    security: { hasStoredAuthentication: false },
    scope,
    ...overrides,
  } as WorkbenchSession;
}

function candidate(
  relativePath: string,
  status = "modified",
  selection = "selected",
) {
  return {
    absolutePath: path.join(WC_ROOT, relativePath),
    relativePath,
    status,
    selection,
  };
}

describe("V014-C1 协议守卫：continuityRestore 接受/拒绝", () => {
  const validRestore: ContinuityRestoreView = {
    contextVersion: 1,
    originModule: "changes",
    changesView: { sort: "status:asc", density: "compact" },
    selectedKeys: [asKey("test-wc::appA/src/a.ts")],
    activeFileKey: asKey("test-wc::appA/src/a.ts"),
    scrollAnchorKey: asKey("test-wc::appA/src/a.ts"),
    commitDraft: "feat: 草稿",
    removedEntries: [
      {
        key: asKey("test-wc::appA/src/gone.ts"),
        path: "/repo/continuity/appA/src/gone.ts",
        reason: "disappeared",
        message: "文件已不在最新快照中，已从选择中移除。",
      },
    ],
    notices: ["已按最新快照保留 1 个选择，移除 1 个失效项。"],
    restoredAt: "2026-08-20T10:00:00.000Z",
  };

  it("接受完整与最小恢复视图", () => {
    expect(isContinuityRestoreView(validRestore)).toBe(true);
    expect(
      isContinuityRestoreView({
        contextVersion: 2,
        originModule: "changes",
        changesView: {},
        selectedKeys: [],
        removedEntries: [],
        notices: [],
        restoredAt: "2026-08-20T10:00:00.000Z",
      }),
    ).toBe(true);
  });

  it("拒绝形状非法、身份非字符串、密度与移除原因非法", () => {
    expect(isContinuityRestoreView(undefined)).toBe(false);
    expect(isContinuityRestoreView(null)).toBe(false);
    expect(isContinuityRestoreView({})).toBe(false);
    // selectedKeys 含非字符串。
    expect(
      isContinuityRestoreView({ ...validRestore, selectedKeys: [42] }),
    ).toBe(false);
    // density 非法取值。
    expect(
      isContinuityRestoreView({
        ...validRestore,
        changesView: { density: "wide" },
      }),
    ).toBe(false);
    // 移除原因非法。
    expect(
      isContinuityRestoreView({
        ...validRestore,
        removedEntries: [
          { key: "k", path: "p", reason: "invented", message: "m" },
        ],
      }),
    ).toBe(false);
    // originModule 非法。
    expect(
      isContinuityRestoreView({ ...validRestore, originModule: "invented" }),
    ).toBe(false);
    // restoredAt 缺失。
    const withoutRestoredAt: Record<string, unknown> = { ...validRestore };
    delete withoutRestoredAt.restoredAt;
    expect(isContinuityRestoreView(withoutRestoredAt)).toBe(false);
  });

  it("Changes 快照守卫：旧快照（无字段）继续接受，新字段非法即拒绝", () => {
    const legacy: ChangesSnapshot = {
      kind: "changes",
      commitDraft: "",
      files: [],
      summary: {},
      refreshedAt: "2026-08-20T10:00:00.000Z",
    };
    expect(isChangesSnapshot(legacy)).toBe(true);
    expect(
      isChangesSnapshot({ ...legacy, continuityRestore: validRestore }),
    ).toBe(true);
    expect(
      isChangesSnapshot({
        ...legacy,
        continuityRestore: { ...validRestore, selectedKeys: [7] },
      }),
    ).toBe(false);
    expect(isChangesSnapshot({ ...legacy, kind: "commit" })).toBe(false);
  });
});

describe("V014-C1 接线 helper：身份键与选择交集过滤", () => {
  it("resolveKey 与文件视图 selectionKey 同源（createScopedFileKey 形式）", () => {
    const resolveKey = continuityResolveKey(WC_ROOT, hostSemantics);
    const absolute = path.join(WC_ROOT, "appA/src/a.ts");
    expect(resolveKey(absolute)).toBe(
      createScopedFileKey(WC_ROOT, absolute, hostSemantics),
    );
  });

  it("合法交集：保留已选合法项，逐项剔除并给出原因，新文件不自动加入", () => {
    const session = makeSession({
      selectedPaths: [
        path.join(WC_ROOT, "appA/src/a.ts"),
        path.join(WC_ROOT, "appA/src/b.ts"),
        path.join(WC_ROOT, "appA/src/c.ts"),
        path.join(WC_ROOT, "appA/src/ext.ts"),
      ],
      targetFile: path.join(WC_ROOT, "appA/src/a.ts"),
    });
    const context = createContinuityContext(session, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const files = [
      {
        selectionKey: continuityResolveKey(
          WC_ROOT,
          hostSemantics,
        )(path.join(WC_ROOT, "appA/src/a.ts")),
        relativePath: "appA/src/a.ts",
      },
      {
        selectionKey: continuityResolveKey(
          WC_ROOT,
          hostSemantics,
        )(path.join(WC_ROOT, "appA/src/b.ts")),
        relativePath: "appA/src/b.ts",
      },
      {
        selectionKey: continuityResolveKey(
          WC_ROOT,
          hostSemantics,
        )(path.join(WC_ROOT, "appA/src/ext.ts")),
        relativePath: "appA/src/ext.ts",
      },
      {
        selectionKey: continuityResolveKey(
          WC_ROOT,
          hostSemantics,
        )(path.join(WC_ROOT, "appA/src/new.ts")),
        relativePath: "appA/src/new.ts",
      },
    ] as never;
    const { view, stale } = buildContinuityRestore(
      {
        context,
        candidates: [
          {
            absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
            selection: "selected",
            status: "modified",
          },
          {
            absolutePath: path.join(WC_ROOT, "appA/src/b.ts"),
            selection: "blocked",
            status: "conflicted",
          },
          {
            absolutePath: path.join(WC_ROOT, "appA/src/ext.ts"),
            selection: "excluded",
            status: "external",
          },
          {
            absolutePath: path.join(WC_ROOT, "appA/src/new.ts"),
            selection: "selected",
            status: "modified",
          },
        ] as never,
        files,
        sessionId: "session-1",
        repositoryUuid: "uuid-1",
        includeExternals: false,
        currentDraftMessage: "",
      },
      hostSemantics,
    );
    expect(stale).toBe(false);
    expect(view).toBeDefined();
    // 只保留 a.ts；新文件 new.ts 不因候选存在而自动加入。
    expect(view!.selectedKeys.map(String)).toEqual([
      String(
        continuityResolveKey(
          WC_ROOT,
          hostSemantics,
        )(path.join(WC_ROOT, "appA/src/a.ts")),
      ),
    ]);
    expect(view!.removedEntries.map((entry) => entry.reason)).toEqual([
      "blocked",
      "disappeared",
      "external",
    ]);
    for (const entry of view!.removedEntries) {
      expect(entry.message.length).toBeGreaterThan(0);
    }
    expect(view!.notices.length).toBeGreaterThan(0);
  });

  it("stale：延迟旧 sessionId 的快照被忽略", () => {
    const session = makeSession({
      selectedPaths: [path.join(WC_ROOT, "appA/src/a.ts")],
    });
    const context = createContinuityContext(session, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const { view, stale } = buildContinuityRestore(
      {
        context,
        candidates: [
          {
            absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
            selection: "selected",
            status: "modified",
          },
        ] as never,
        files: [],
        sessionId: "session-0-旧快照",
        repositoryUuid: "uuid-1",
        includeExternals: false,
        currentDraftMessage: "",
      },
      hostSemantics,
    );
    expect(stale).toBe(true);
    expect(view).toBeUndefined();
  });

  it("失效：标记失效的上下文不再下发", () => {
    const session = makeSession({
      selectedPaths: [path.join(WC_ROOT, "appA/src/a.ts")],
    });
    const context = invalidateContinuity(
      createContinuityContext(session, {
        resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
      }),
      "filter-change",
    );
    const { view, stale } = buildContinuityRestore(
      {
        context,
        candidates: [
          {
            absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
            selection: "selected",
            status: "modified",
          },
        ] as never,
        files: [],
        sessionId: "session-1",
        repositoryUuid: "uuid-1",
        includeExternals: false,
        currentDraftMessage: "",
      },
      hostSemantics,
    );
    expect(stale).toBe(false);
    expect(view).toBeUndefined();
  });

  it("草稿保守：目标会话已有更新草稿时不下发旧草稿", () => {
    const session = makeSession({
      commitState: { message: "旧草稿说明" } as never,
    });
    const context = createContinuityContext(session, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const input = {
      context,
      candidates: [] as never[],
      files: [] as never[],
      sessionId: "session-1",
      repositoryUuid: "uuid-1",
      includeExternals: false,
    };
    // 目标无草稿：下发旧草稿。
    expect(
      buildContinuityRestore(
        { ...input, currentDraftMessage: "" },
        hostSemantics,
      ).view?.commitDraft,
    ).toBe("旧草稿说明");
    // 目标已有更新编辑：不覆盖。
    expect(
      buildContinuityRestore(
        { ...input, currentDraftMessage: "用户新编辑" },
        hostSemantics,
      ).view?.commitDraft,
    ).toBeUndefined();
  });

  it("跨仓库候选被 fail-closed 剔除", () => {
    const session = makeSession({
      selectedPaths: [path.join(WC_ROOT, "appA/src/a.ts")],
    });
    const context = createContinuityContext(session, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const { view } = buildContinuityRestore(
      {
        context,
        candidates: [
          {
            absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
            selection: "selected",
            status: "modified",
          },
        ] as never,
        files: [],
        sessionId: "session-1",
        // 仓库已切换：全部候选归属他仓。
        repositoryUuid: "uuid-2-他仓",
        includeExternals: false,
        currentDraftMessage: "",
      },
      hostSemantics,
    );
    expect(view?.selectedKeys).toEqual([]);
    expect(view?.removedEntries.map((entry) => entry.reason)).toEqual([
      "cross-repository",
    ]);
  });
});

describe("V014-C1 接线 helper：重建迁移", () => {
  it("同范围重建迁移成功并重锚到新会话", () => {
    const previous = makeSession({ sessionId: "session-旧" });
    previous.taskContinuity = createContinuityContext(previous, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const next = makeSession({ sessionId: "session-新" });
    const migrated = migrateContinuityForReopen(previous, next, hostSemantics);
    expect(migrated).toBeDefined();
    expect(migrated!.originSessionId).toBe("session-新");
    expect(migrated!.contextVersion).toBe(2);
  });

  it("范围扩大被拒绝（多选根超出来源）", () => {
    const previous = makeSession({ sessionId: "session-旧" });
    previous.taskContinuity = createContinuityContext(previous, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    const expanded = makeSession({ sessionId: "session-新" });
    expanded.scope = scopeWithRoots([WC_ROOT]);
    expanded.scopeHash = hashOperationScope(expanded.scope);
    expect(
      migrateContinuityForReopen(previous, expanded, hostSemantics),
    ).toBeUndefined();
  });

  it("项目切换/已失效/非 changes 目标均不携带", () => {
    const previous = makeSession({ sessionId: "session-旧" });
    previous.taskContinuity = createContinuityContext(previous, {
      resolveKey: continuityResolveKey(WC_ROOT, hostSemantics),
    });
    // 已失效。
    const invalidated = makeSession({ sessionId: "session-新" });
    const weak = invalidateContinuity(previous.taskContinuity, "filter-change");
    expect(
      migrateContinuityForReopen(
        { ...previous, taskContinuity: weak },
        invalidated,
        hostSemantics,
      ),
    ).toBeUndefined();
    // 非 changes 目标。
    const commit = makeSession({ sessionId: "session-新" });
    commit.moduleId = "commit";
    commit.taskId = "commit/compose";
    expect(
      migrateContinuityForReopen(previous, commit, hostSemantics),
    ).toBeUndefined();
    // 无旧上下文。
    expect(
      migrateContinuityForReopen(
        makeSession({ sessionId: "session-旧" }),
        makeSession({ sessionId: "session-新" }),
        hostSemantics,
      ),
    ).toBeUndefined();
  });
});

// ---------- 控制器集成 ----------

function makeContext() {
  const store: Record<string, unknown> = {};
  return {
    context: {
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
    },
  };
}

type ControllerInternals = { session?: WorkbenchSession };

function createController(options?: {
  servedModule?: "changes" | "diff";
  onOpenInOtherWindow?: (request: unknown) => void | Promise<void>;
}) {
  const { context } = makeContext();
  const ruleService = {
    onDidInvalidate: () => ({ dispose: () => undefined }),
    getEffectiveRules: async () => undefined,
  };
  const controller = new WorkbenchController(
    context as never,
    ruleService as never,
    {
      servedModule: options?.servedModule ?? "changes",
      onOpenInOtherWindow: options?.onOpenInOtherWindow as never,
    },
  );
  return controller;
}

function sessionOf(controller: WorkbenchController): WorkbenchSession {
  const session = (controller as unknown as ControllerInternals).session;
  if (!session) throw new Error("会话尚未建立");
  return session;
}

function actionMessage(
  session: WorkbenchSession,
  action: string,
  data?: Record<string, unknown>,
): unknown {
  return {
    protocolVersion: WORKBENCH_PROTOCOL_VERSION,
    type: "workbench/action",
    moduleId: session.moduleId,
    taskId: session.taskId,
    sessionId: session.sessionId,
    repositoryUuid: session.repositoryUuid,
    scopeHash: session.scopeHash,
    payload: { action, data: data ?? {} },
  };
}

function sendToController(controller: WorkbenchController, message: unknown) {
  const panel = __webviewPanels[__webviewPanels.length - 1];
  if (!panel?.__onMessage) throw new Error("Webview 消息通道尚未建立");
  (panel.__onMessage as (message: unknown) => void)(message);
}

function postedSnapshots(): Array<{
  type: string;
  moduleId: string;
  payload: { snapshot?: { kind?: string } & Record<string, unknown> };
}> {
  const panel = __webviewPanels[__webviewPanels.length - 1];
  const posted = (panel as unknown as { __posted?: unknown[] }).__posted ?? [];
  return posted as never;
}

function recordPosts() {
  const panel = __webviewPanels[__webviewPanels.length - 1];
  const posted: unknown[] = [];
  (panel as unknown as { __posted?: unknown[] }).__posted = posted;
  const original = panel.webview.postMessage;
  panel.webview.postMessage = (async (message: unknown) => {
    posted.push(message);
    return original(message);
  }) as typeof panel.webview.postMessage;
}

beforeEach(() => {
  __resetWebviewPanels();
  collectorControl.candidates = [];
});

describe("V014-C1 控制器：open-diff 写入连续上下文并按现状转发", () => {
  it("源为 changes 时快照上下文（权威选择 + 目标文件 + 返回动作）再转发 Diff 窗口", async () => {
    const forwarded: unknown[] = [];
    const controller = createController({
      onOpenInOtherWindow: (request: unknown) => {
        forwarded.push(request);
      },
    });
    collectorControl.candidates = [
      candidate("appA/src/a.ts"),
      candidate("appA/src/b.ts"),
    ];
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const session = sessionOf(controller);
    session.selectedPaths = [
      path.join(WC_ROOT, "appA/src/a.ts"),
      path.join(WC_ROOT, "appA/src/b.ts"),
    ];
    sendToController(
      controller,
      actionMessage(session, "open-diff", { relativePath: "appA/src/a.ts" }),
    );
    await vi.waitFor(() => expect(forwarded).toHaveLength(1));
    const continuity = sessionOf(controller).taskContinuity;
    expect(continuity).toBeDefined();
    expect(continuity!.originModule).toBe("changes");
    expect(continuity!.originTask).toBe("changes/overview");
    // originScopeHash 实时重算，与会话范围哈希同源。
    expect(continuity!.originScopeHash).toBe(session.scopeHash);
    expect(continuity!.originSessionId).toBe(session.sessionId);
    // activeFileKey 为本次目标文件对应 key；滚动锚一致。
    const expectedKey = createScopedFileKey(
      WC_ROOT,
      path.join(WC_ROOT, "appA/src/a.ts"),
      hostSemantics,
    );
    expect(continuity!.activeFileKey).toBe(expectedKey);
    expect(continuity!.scrollAnchorKey).toBe(expectedKey);
    // 选择来自 Host 权威（2 个），顺序保留。
    expect(continuity!.selectedKeys).toHaveLength(2);
    expect(continuity!.selectedKeys[0]).toBe(expectedKey);
    // Diff 目标与返回动作。
    expect(continuity!.diffTarget).toMatchObject({
      targetKey: expectedKey,
      returnAction: "back-to-changes",
    });
    // 按现状转发 Diff 窗口（targetFile 为绝对路径）。
    expect(forwarded[0]).toMatchObject({
      moduleId: "diff",
      targetFile: path.join(WC_ROOT, "appA/src/a.ts"),
    });
  });

  it("越界文件拒绝时不写上下文", async () => {
    const forwarded: unknown[] = [];
    const controller = createController({
      onOpenInOtherWindow: (request: unknown) => {
        forwarded.push(request);
      },
    });
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const session = sessionOf(controller);
    sendToController(
      controller,
      actionMessage(session, "open-diff", { relativePath: "../outside.ts" }),
    );
    await vi.waitFor(() => expect(forwarded).toHaveLength(0));
    // 给 Host 一次处理拒绝分支的机会，再断言未写入。
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessionOf(controller).taskContinuity).toBeUndefined();
    expect(forwarded).toHaveLength(0);
  });
});

describe("V014-C1 控制器：重建迁移 + 快照恢复下发（一次性消费）", () => {
  it("返回 Changes 时迁移上下文，快照携带合法交集恢复载荷，刷新后不再重复下发", async () => {
    const controller = createController({
      onOpenInOtherWindow: () => undefined,
    });
    collectorControl.candidates = [
      candidate("appA/src/a.ts", "modified", "selected"),
      candidate("appA/src/b.ts", "conflicted", "blocked"),
      candidate("appA/src/ext.ts", "external", "excluded"),
      candidate("appA/src/new.ts", "modified", "selected"),
    ];
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const first = sessionOf(controller);
    first.selectedPaths = [
      path.join(WC_ROOT, "appA/src/a.ts"),
      path.join(WC_ROOT, "appA/src/b.ts"),
      path.join(WC_ROOT, "appA/src/gone.ts"),
      path.join(WC_ROOT, "appA/src/ext.ts"),
    ];
    first.commitState = { message: "旧草稿说明" } as never;
    sendToController(
      controller,
      actionMessage(first, "open-diff", { relativePath: "appA/src/a.ts" }),
    );
    await vi.waitFor(() =>
      expect(sessionOf(controller).taskContinuity).toBeDefined(),
    );

    // 返回 Changes：重建会话（新 sessionId），迁移上下文。
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const second = sessionOf(controller);
    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.taskContinuity).toBeDefined();
    expect(second.taskContinuity!.originSessionId).toBe(second.sessionId);

    // 触发 ready：sendInitialize + loadInitialModule → Changes 快照。
    recordPosts();
    sendToController(controller, {
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "webview/ready",
      moduleId: "changes",
      payload: {},
    });
    let restore: ContinuityRestoreView | undefined;
    await vi.waitFor(() => {
      const snapshots = postedSnapshots().filter(
        (message) =>
          message.type === "module/snapshot" &&
          message.payload.snapshot?.kind === "changes",
      );
      expect(snapshots.length).toBeGreaterThan(0);
      restore = snapshots[0].payload.snapshot!.continuityRestore as
        ContinuityRestoreView | undefined;
      expect(restore).toBeDefined();
    });
    // 合法交集：仅 a.ts；blocked/消失/external 逐项剔除；新文件不加入。
    const expectedA = String(
      createScopedFileKey(
        WC_ROOT,
        path.join(WC_ROOT, "appA/src/a.ts"),
        hostSemantics,
      ),
    );
    expect(restore!.selectedKeys.map(String)).toEqual([expectedA]);
    expect(restore!.removedEntries.map((entry) => entry.reason)).toEqual([
      "blocked",
      "disappeared",
      "external",
    ]);
    expect(restore!.activeFileKey).toBe(expectedA);
    expect(restore!.scrollAnchorKey).toBe(expectedA);
    // 旧草稿随快照下发（目标会话此时无更新草稿）。
    expect(restore!.commitDraft).toBe("旧草稿说明");
    expect(restore!.notices.length).toBeGreaterThan(0);
    expect(typeof restore!.restoredAt).toBe("string");

    // 一次性消费：上下文已清空，刷新不再重复下发。
    expect(second.taskContinuity).toBeUndefined();
    const seen = postedSnapshots().length;
    sendToController(controller, actionMessage(second, "refresh", {}));
    await vi.waitFor(() => {
      const snapshots = postedSnapshots()
        .slice(seen)
        .filter(
          (message) =>
            message.type === "module/snapshot" &&
            message.payload.snapshot?.kind === "changes",
        );
      expect(snapshots.length).toBeGreaterThan(0);
      expect(
        (snapshots[0].payload.snapshot as ChangesSnapshot).continuityRestore,
      ).toBeUndefined();
    });
  });

  it("范围扩大重建时丢弃上下文，快照不带恢复载荷", async () => {
    const controller = createController({
      onOpenInOtherWindow: () => undefined,
    });
    collectorControl.candidates = [candidate("appA/src/a.ts")];
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const first = sessionOf(controller);
    first.selectedPaths = [path.join(WC_ROOT, "appA/src/a.ts")];
    sendToController(
      controller,
      actionMessage(first, "open-diff", { relativePath: "appA/src/a.ts" }),
    );
    await vi.waitFor(() =>
      expect(sessionOf(controller).taskContinuity).toBeDefined(),
    );

    // 扩大到仓库根重建：迁移拒绝。
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: scopeWithRoots([WC_ROOT]),
    });
    expect(sessionOf(controller).taskContinuity).toBeUndefined();

    recordPosts();
    sendToController(controller, {
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "webview/ready",
      moduleId: "changes",
      payload: {},
    });
    await vi.waitFor(() => {
      const snapshots = postedSnapshots().filter(
        (message) =>
          message.type === "module/snapshot" &&
          message.payload.snapshot?.kind === "changes",
      );
      expect(snapshots.length).toBeGreaterThan(0);
      expect(
        (snapshots[0].payload.snapshot as ChangesSnapshot).continuityRestore,
      ).toBeUndefined();
    });
  });

  it("目标会话已有更新草稿时不下发旧草稿（草稿保守）", async () => {
    const controller = createController({
      onOpenInOtherWindow: () => undefined,
    });
    collectorControl.candidates = [candidate("appA/src/a.ts")];
    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const first = sessionOf(controller);
    first.selectedPaths = [path.join(WC_ROOT, "appA/src/a.ts")];
    first.commitState = { message: "旧草稿说明" } as never;
    sendToController(
      controller,
      actionMessage(first, "open-diff", { relativePath: "appA/src/a.ts" }),
    );
    await vi.waitFor(() =>
      expect(sessionOf(controller).taskContinuity).toBeDefined(),
    );

    await controller.open({
      moduleId: "changes",
      svnPath: "svn",
      scope: baseScope(),
    });
    const second = sessionOf(controller);
    // 用户在新会话已填写更新草稿（晚于旧上下文）。
    second.commitState = { message: "用户新编辑" } as never;
    recordPosts();
    sendToController(controller, {
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "webview/ready",
      moduleId: "changes",
      payload: {},
    });
    await vi.waitFor(() => {
      const snapshots = postedSnapshots().filter(
        (message) =>
          message.type === "module/snapshot" &&
          message.payload.snapshot?.kind === "changes",
      );
      expect(snapshots.length).toBeGreaterThan(0);
      const restore = (snapshots[0].payload.snapshot as ChangesSnapshot)
        .continuityRestore;
      expect(restore).toBeDefined();
      expect(restore!.commitDraft).toBeUndefined();
    });
  });
});
