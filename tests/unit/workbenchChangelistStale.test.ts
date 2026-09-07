import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type ChangelistsSnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { hashChangelistPlan } from "../../src/changelist/changelistPlan";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * V020-R08 · 变更集方案更改后旧预览仍可确认（Host 方案指纹防线）。
 * - 预览保存范围/仓库绑定与方案指纹，快照随附下发；
 * - 执行前用最终方案（execute-apply 携带）比对保存的方案，改名/删文件/
 *   改组凭旧令牌一律拒绝（fail-closed）；
 * - 范围变化、候选变化、执行失败后旧预览不再可确认。
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
  applyExitCode: 0,
  applied: [] as Array<{ name: string | undefined; paths: string[] }>,
}));

vi.mock("../../src/changelist/svnChangelists", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/changelist/svnChangelists")
    >();
  return {
    ...actual,
    collectSvnChangelists: async () => changelistControl.groups,
    applySvnChangelist: async (
      _svnPath: string,
      _scope: unknown,
      name: string | undefined,
      paths: string[],
    ) => {
      changelistControl.applied.push({ name, paths });
      return changelistControl.applyExitCode === 0
        ? { exitCode: 0, stdout: "", stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "svn: E200000: 模拟写入失败" };
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
  return (
    snapshot as {
      payload: { snapshot: ChangelistsSnapshot };
    }
  )?.payload.snapshot;
}

function errorMessages(): Array<{ title: string; message: string }> {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) =>
        (message as { payload: { title: string; message: string } }).payload,
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
  changelistControl.groups = [];
  changelistControl.applyExitCode = 0;
  changelistControl.applied = [];
});

afterEach(() => {
  __resetWebviewPanels();
});

async function previewApply(
  send: (action: string, data?: Record<string, unknown>) => Promise<void>,
  name = "ui",
  paths = ["app/a.ts", "app/b.ts"],
) {
  posted.length = 0;
  await send("changelist/preview-apply", { name, paths, remove: false });
  await vi.waitFor(() => expect(changelistSnapshotOf()?.preview).toBeDefined());
  const snapshot = changelistSnapshotOf();
  if (!snapshot?.preview) throw new Error("预览未生成");
  return snapshot.preview;
}

describe("changelist 预览绑定方案指纹（V020-R08）", () => {
  it("预览保存范围/仓库绑定与方案指纹并随快照下发", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    expect(session.changelistState?.preview?.scopeHash).toBe(session.scopeHash);
    expect(session.changelistState?.preview?.repositoryUuid).toBe(
      session.repositoryUuid,
    );
    expect(session.changelistState?.preview?.planHash).toBe(
      hashChangelistPlan({
        name: "ui",
        remove: false,
        paths: ["app/a.ts", "app/b.ts"],
      }),
    );
    expect(preview.scopeHash).toBe(session.scopeHash);
    expect(preview.candidateHash).toBeDefined();
    expect(preview.repositoryUuid).toBe(session.repositoryUuid);
    expect(preview.planHash).toBe(
      hashChangelistPlan({
        name: "ui",
        remove: false,
        paths: ["app/a.ts", "app/b.ts"],
      }),
    );
  });

  it("最终方案一致时凭令牌执行成功并写回旧预览不可复用", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui",
      paths: ["app/a.ts", "app/b.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(changelistControl.applied).toHaveLength(1));
    expect(changelistControl.applied[0]).toEqual({
      name: "ui",
      paths: ["app/a.ts", "app/b.ts"],
    });
    expect(session.changelistState?.preview).toBeUndefined();
    expect(changelistSnapshotOf()?.preview).toBeUndefined();
    expect(changelistSnapshotOf()?.feedback).toContain("ui");
  });

  it("预览后改名凭旧令牌不得执行", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui-renamed",
      paths: ["app/a.ts", "app/b.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(errorMessages()[0].title).toBe("Changelist 方案已更改");
    expect(changelistControl.applied).toHaveLength(0);
    expect(session.changelistState?.preview).toBeUndefined();
    expect(changelistSnapshotOf()?.preview).toBeUndefined();
  });

  it("预览后删文件凭旧令牌不得执行", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui",
      paths: ["app/a.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(errorMessages()[0].title).toBe("Changelist 方案已更改");
    expect(changelistControl.applied).toHaveLength(0);
    expect(session.changelistState?.preview).toBeUndefined();
  });

  it("预览后改组（换目标组）凭旧令牌不得执行", async () => {
    const { send } = await createSession();
    const preview = await previewApply(send, "group-a", ["app/a.ts"]);
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "group-b",
      paths: ["app/a.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(errorMessages()[0].title).toBe("Changelist 方案已更改");
    expect(changelistControl.applied).toHaveLength(0);
  });

  it("工作副本候选变化后旧令牌不得执行", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    // 预览后工作副本变化：b.ts 消失。
    collectorControl.candidates = [collectorControl.candidates[0]];
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui",
      paths: ["app/a.ts", "app/b.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(changelistControl.applied).toHaveLength(0);
    expect(session.changelistState?.preview).toBeUndefined();
    expect(changelistSnapshotOf()?.preview).toBeUndefined();
  });

  it("范围变化后旧令牌不得执行", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    session.scopeHash = "changed-scope-hash";
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui",
      paths: ["app/a.ts", "app/b.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(errorMessages()[0].title).toBe("Changelist 预览已失效");
    expect(changelistControl.applied).toHaveLength(0);
    expect(session.changelistState?.preview).toBeUndefined();
  });

  it("执行失败后旧预览不再可确认", async () => {
    const { session, send } = await createSession();
    const preview = await previewApply(send);
    changelistControl.applyExitCode = 1;
    posted.length = 0;
    await send("changelist/execute-apply", {
      previewToken: preview.token,
      name: "ui",
      paths: ["app/a.ts", "app/b.ts"],
      remove: false,
    });
    await vi.waitFor(() => expect(errorMessages()).toHaveLength(1));
    expect(errorMessages()[0].title).toBe("Changelist 更新失败");
    expect(session.changelistState?.preview).toBeUndefined();
    expect(changelistSnapshotOf()?.preview).toBeUndefined();
  });
});
