import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import { projectDraftKey } from "../../src/extension/workbench/projectDraftStore";
import { hashOperationScope } from "../../src/extension/workbench/workbenchSupport";
import { __resetWebviewPanels } from "../mocks/vscode";

/*
 * v0.0.7 §8 项目切换草稿守卫（控制器集成）：复用模块窗口加载新项目前
 * 检查未完成内容；三选一（保留草稿并切换 / 放弃并切换 / 留在当前项目）；
 * 草稿按 projectId + moduleId + scopeHash 隔离；恢复时重新采集候选并
 * 复验手动选择，采集失败安全清空旧选择；旧预览与确认令牌不恢复。
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

/** 候选采集控制：restore 复验依赖，避免调用真实 SVN。 */
const collectorControl = vi.hoisted(() => ({
  candidates: [] as Array<{
    absolutePath: string;
    relativePath: string;
    status: string;
    selection: string;
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

const WC_ROOT = path.resolve("/repo/code");

function projectScope(projectName: string, rootSub?: string): OperationScope {
  const projectRoot = path.join(WC_ROOT, projectName);
  const rootPath = rootSub ? path.join(projectRoot, rootSub) : projectRoot;
  return {
    id: `scope-${projectName}-${rootSub ?? "root"}`,
    repositoryRoot: WC_ROOT,
    source: "explorerFolder",
    roots: [
      {
        absolutePath: rootPath,
        relativePath: rootSub ? `${projectName}/${rootSub}` : projectName,
        kind: "folder",
      },
    ],
    project: {
      projectRoot,
      projectName,
      rootIsFallback: false,
      workingCopyRelativePath: projectName,
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
    store,
  };
}

type ControllerInternals = { session?: WorkbenchSession };

let warningMock: ReturnType<typeof vi.fn>;
const originalWarning = vscode.window.showWarningMessage;

function createController() {
  const { context, store } = makeContext();
  const ruleService = {
    onDidInvalidate: () => ({ dispose: () => undefined }),
    getEffectiveRules: async () => undefined,
  };
  const controller = new WorkbenchController(
    context as never,
    ruleService as never,
    {
      servedModule: "changes",
    },
  );
  return { controller, store };
}

function sessionOf(controller: WorkbenchController): WorkbenchSession {
  const session = (controller as unknown as ControllerInternals).session;
  if (!session) throw new Error("会话尚未建立");
  return session;
}

function openChanges(controller: WorkbenchController, scope: OperationScope) {
  return controller.open({ moduleId: "changes", svnPath: "svn", scope });
}

/** 直接预置一份草稿（等价于此前切换时 stash 的结果）。 */
function seedDraft(
  store: Record<string, unknown>,
  scope: OperationScope,
  draft: { message: string; selectedPaths: string[] },
): string {
  const key = projectDraftKey(
    scope.project!.projectRoot,
    "changes",
    hashOperationScope(scope),
  );
  store["svnWorkbench.projectDrafts"] = {
    [key]: { ...draft, scopeHash: hashOperationScope(scope), savedAt: 1 },
  };
  return key;
}

beforeEach(() => {
  __resetWebviewPanels();
  collectorControl.candidates = [];
  collectorControl.fail = false;
  warningMock = vi.fn(async () => undefined);
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage =
    warningMock;
});

afterEach(() => {
  (vscode.window as { showWarningMessage: unknown }).showWarningMessage =
    originalWarning;
});

describe("项目切换草稿守卫（v0.0.7 §8）", () => {
  it("无未完成内容时直接切换，不提示", async () => {
    const { controller } = createController();
    await openChanges(controller, projectScope("appA"));
    await openChanges(controller, projectScope("appB"));
    expect(warningMock).not.toHaveBeenCalled();
    expect(sessionOf(controller).scope.project?.projectName).toBe("appB");
  });

  it("同项目重复打开不触发守卫", async () => {
    const { controller } = createController();
    await openChanges(controller, projectScope("appA"));
    sessionOf(controller).commitState = { message: "feat: 进行中" };
    await openChanges(controller, projectScope("appA"));
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("选择“留在当前项目”时中止切换并保留会话", async () => {
    const { controller } = createController();
    warningMock.mockResolvedValue("留在当前项目");
    await openChanges(controller, projectScope("appA"));
    sessionOf(controller).commitState = { message: "feat: 进行中" };
    await openChanges(controller, projectScope("appB"));
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(String(warningMock.mock.calls[0][0])).toContain("提交说明草稿");
    expect(sessionOf(controller).scope.project?.projectName).toBe("appA");
    expect(sessionOf(controller).commitState?.message).toBe("feat: 进行中");
  });

  it("选择“保留草稿并切换”后草稿按项目 + 范围隔离，切回时恢复且旧预览不恢复", async () => {
    const { controller, store } = createController();
    warningMock.mockResolvedValue("保留为当前项目草稿并切换");
    await openChanges(controller, projectScope("appA"));
    const scopeHashA = sessionOf(controller).scopeHash;
    sessionOf(controller).commitState = {
      message: "feat: 进行中",
      selectedPaths: ["appA/src/a.ts"],
      preview: { token: "old-token" } as never,
    };
    await openChanges(controller, projectScope("appB"));
    expect(sessionOf(controller).scope.project?.projectName).toBe("appB");

    const key = projectDraftKey(
      path.join(WC_ROOT, "appA"),
      "changes",
      scopeHashA,
    );
    const drafts = store["svnWorkbench.projectDrafts"] as Record<
      string,
      { message: string; selectedPaths: string[] }
    >;
    expect(drafts[key]).toMatchObject({
      message: "feat: 进行中",
      selectedPaths: ["appA/src/a.ts"],
    });

    // 切回项目 A：候选复验通过，草稿恢复，旧预览/token 不恢复。
    collectorControl.candidates = [
      {
        absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
        relativePath: "appA/src/a.ts",
        status: "modified",
        selection: "selected",
      },
    ];
    await openChanges(controller, projectScope("appA"));
    expect(warningMock).toHaveBeenCalledTimes(1);
    const session = sessionOf(controller);
    expect(session.commitState?.message).toBe("feat: 进行中");
    expect(session.commitState?.selectedPaths).toEqual(["appA/src/a.ts"]);
    expect(session.commitState?.preview).toBeUndefined();
    expect(session.commitState?.feedback?.message).toContain(
      "旧预览与确认令牌不恢复",
    );
    // 草稿一次性恢复后从存储移除。
    expect(
      (store["svnWorkbench.projectDrafts"] as Record<string, unknown>)[key],
    ).toBeUndefined();
  });

  it("选择“放弃内容并切换”不保留草稿", async () => {
    const { controller, store } = createController();
    warningMock.mockResolvedValue("放弃内容并切换");
    await openChanges(controller, projectScope("appA"));
    sessionOf(controller).commitState = { message: "feat: 进行中" };
    await openChanges(controller, projectScope("appB"));
    expect(sessionOf(controller).scope.project?.projectName).toBe("appB");
    expect(store["svnWorkbench.projectDrafts"]).toBeUndefined();
  });
});

describe("项目草稿恢复的范围隔离与候选复验（v0.0.7 §8）", () => {
  it("同项目同模块但不同 scope 的草稿不恢复、不串用", async () => {
    const { controller, store } = createController();
    const scopeV1 = projectScope("appA");
    const key = seedDraft(store, scopeV1, {
      message: "feat: 范围一",
      selectedPaths: ["appA/src/a.ts"],
    });
    // 同项目同模块、不同 roots → 不同 scopeHash。
    await openChanges(controller, projectScope("appA", "src"));
    expect(sessionOf(controller).commitState).toBeUndefined();
    // 草稿保留在原范围键下，未被消费。
    const drafts = store["svnWorkbench.projectDrafts"] as Record<
      string,
      unknown
    >;
    expect(drafts[key]).toBeDefined();

    // 以原 scope 打开则正常恢复。
    collectorControl.candidates = [
      {
        absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
        relativePath: "appA/src/a.ts",
        status: "modified",
        selection: "selected",
      },
    ];
    await openChanges(controller, projectScope("appA"));
    expect(sessionOf(controller).commitState?.message).toBe("feat: 范围一");
  });

  it("候选变化后恢复：已不存在或不可选的路径剔除并反馈", async () => {
    const { controller, store } = createController();
    const scope = projectScope("appA");
    seedDraft(store, scope, {
      message: "feat: 部分有效",
      selectedPaths: [
        "appA/src/a.ts",
        "appA/src/gone.ts",
        "appA/src/blocked.ts",
      ],
    });
    collectorControl.candidates = [
      {
        absolutePath: path.join(WC_ROOT, "appA/src/a.ts"),
        relativePath: "appA/src/a.ts",
        status: "modified",
        selection: "selected",
      },
      {
        absolutePath: path.join(WC_ROOT, "appA/src/blocked.ts"),
        relativePath: "appA/src/blocked.ts",
        status: "conflicted",
        selection: "blocked",
      },
    ];
    await openChanges(controller, scope);
    const commit = sessionOf(controller).commitState;
    expect(commit?.message).toBe("feat: 部分有效");
    expect(commit?.selectedPaths).toEqual(["appA/src/a.ts"]);
    expect(commit?.feedback?.tone).toBe("warning");
    expect(commit?.feedback?.message).toContain("2 个已选路径");
  });

  it("候选采集失败：清空旧选择、保留提交说明并提示重新选择", async () => {
    const { controller, store } = createController();
    const scope = projectScope("appA");
    seedDraft(store, scope, {
      message: "feat: 保留说明",
      selectedPaths: ["appA/src/a.ts"],
    });
    collectorControl.fail = true;
    await openChanges(controller, scope);
    const commit = sessionOf(controller).commitState;
    expect(commit?.message).toBe("feat: 保留说明");
    expect(commit?.selectedPaths).toEqual([]);
    expect(commit?.feedback?.tone).toBe("warning");
    expect(commit?.feedback?.message).toContain(
      "状态采集失败，旧文件选择未恢复",
    );
  });
});
