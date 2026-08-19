import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type ConflictSnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.12 批次 C：冲突意图解释（Controller 级）——
 * conflict/preview-receipt 只下发回执（任务 conflict-interpret）；
 * conflict/interpret 校验任务/token/范围/冲突集后调用模型；
 * 冲突集变化后解释标 stale 只读；保存与 Resolve 契约不受影响。
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

const conflictControl = vi.hoisted(() => ({
  items: [] as Array<{
    relativePath: string;
    operation?: string;
    type?: string;
    sourceLeftRevision?: string;
    sourceRightRevision?: string;
    baseFile: string;
    mineFile: string;
    theirsFile: string;
    workingFile: string;
  }>,
}));

vi.mock("../../src/conflict/conflictCollector", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/conflict/conflictCollector")
    >();
  return {
    ...actual,
    collectConflictItems: async () => conflictControl.items,
  };
});

vi.mock("../../src/ai/conflictAiAdvisor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/ai/conflictAiAdvisor")>();
  return {
    ...actual,
    buildConflictAiRequest: async (item: {
      relativePath: string;
      sourceLeftRevision?: string;
      sourceRightRevision?: string;
    }) => ({
      relativePath: item.relativePath,
      operation: "text-conflict",
      type: "conflicted",
      sourceLeftRevision: item.sourceLeftRevision,
      sourceRightRevision: item.sourceRightRevision,
      contents: {
        base: { content: "base", truncated: false },
        mine: { content: "mine", truncated: false },
        theirs: { content: "theirs", truncated: false },
        working: { content: "working", truncated: false },
      },
    }),
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
    { servedModule: "conflicts" },
  );
  await controller.open({
    moduleId: "conflicts",
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
      moduleId: "conflicts",
      taskId: "conflicts/resolve",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
  };
  return { controller, session, send };
}

function conflictSnapshotOf(): ConflictSnapshot | undefined {
  const snapshot = [...posted]
    .reverse()
    .find(
      (message) =>
        message.type === "module/snapshot" &&
        (message as { payload: { snapshot: { kind?: string } } }).payload
          .snapshot.kind === "conflicts",
    );
  return (
    snapshot as {
      payload: { snapshot: ConflictSnapshot };
    }
  )?.payload.snapshot;
}

function receiptMessages() {
  return posted
    .filter((message) => message.type === "conflict/receipt")
    .map((message) => (message as { payload: { token: string } }).payload);
}

function errorTitles(): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) => (message as { payload: { title: string } }).payload.title,
    );
}

let tempDir = "";

function makeItem(relativePath: string, left = "10", right = "11") {
  const base = path.join(tempDir, relativePath.replace(/[/]/g, "_"));
  fs.writeFileSync(`${base}.base`, "base");
  fs.writeFileSync(`${base}.mine`, "mine");
  fs.writeFileSync(`${base}.theirs`, "theirs");
  fs.writeFileSync(`${base}.working`, "working");
  return {
    relativePath,
    operation: "text-conflict",
    type: "conflicted",
    sourceLeftRevision: left,
    sourceRightRevision: right,
    baseFile: `${base}.base`,
    mineFile: `${base}.mine`,
    theirsFile: `${base}.theirs`,
    workingFile: `${base}.working`,
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cindy-conflict-test-"));
  conflictControl.items = [makeItem("app/a.ts")];
});

afterEach(() => {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("conflict 意图解释（v0.0.12 批次 C）", () => {
  it("preview-receipt 只下发回执（任务 conflict-interpret），不调用模型", async () => {
    const { session, send } = await createSession();
    await send("conflict/preview-receipt", {
      relativePath: "app/a.ts",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(receiptMessages()).toHaveLength(1);
    expect(session.conflictState?.pendingReceipt?.task).toBe(
      "conflict-interpret",
    );
    // 未生成解释。
    expect(conflictSnapshotOf()?.interpretation).toBeUndefined();
  });

  it("interpret 携带匹配 token 时生成六段解释并绑定", async () => {
    const { session, send } = await createSession();
    await send("conflict/preview-receipt", {
      relativePath: "app/a.ts",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("conflict/interpret", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const snapshot = conflictSnapshotOf();
    expect(snapshot?.interpretation?.myIntent).toBeTruthy();
    // 未配置模型 → 本地回退：工作副本无冲突标记 → acceptWorking。
    expect(snapshot?.interpretation?.recommendedHandling.recommendation).toBe(
      "acceptWorking",
    );
    expect(snapshot?.interpretation?.binding?.scopeHash).toBe(
      session.scopeHash,
    );
    expect(session.conflictState?.pendingReceipt).toBeUndefined();
  });

  it("跨任务/过期回执一律拒绝", async () => {
    const { session, send } = await createSession();
    session.conflictState = {
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
        files: [],
        scopeHash: session.scopeHash,
        conflictHash: "c",
        revision: "7",
      },
    };
    await send("conflict/interpret", { receiptToken: "wrong-task" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorTitles()).toContain("外发回执已失效");
  });

  it("冲突集变化后解释标 stale 只读", async () => {
    const { send } = await createSession();
    await send("conflict/preview-receipt", { relativePath: "app/a.ts" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("conflict/interpret", { receiptToken: token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(conflictSnapshotOf()?.interpretation?.stale).toBeFalsy();
    // 冲突集变化（新冲突）→ 解释过期只读。
    posted.length = 0;
    conflictControl.items = [makeItem("app/a.ts"), makeItem("app/b.ts")];
    await send("refresh", {});
    await vi.waitFor(() => {
      const snapshot = conflictSnapshotOf();
      expect(snapshot?.interpretation?.stale).toBe(true);
    });
  });

  it("receipt-dismiss 放弃回执", async () => {
    const { session, send } = await createSession();
    await send("conflict/preview-receipt", { relativePath: "app/a.ts" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const token = receiptMessages()[0].token;
    posted.length = 0;
    await send("conflict/receipt-dismiss", { token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.conflictState?.pendingReceipt).toBeUndefined();
  });
});
