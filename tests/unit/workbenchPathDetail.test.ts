import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import type { OperationScope } from "../../src/scope/operationScope";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.7 路径详情 Host 边界：file/path-detail 与 file/copy-path 的
 * relativePath 输入必须复验操作范围；范围外路径拒绝，绝对路径不能
 * 成为 Webview 动作输入。
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
      resolveRepositoryRootUrl: async () =>
        "https://svn.example.internal/svn/Code2",
      resolveWorkingCopyUrl: async () =>
        "https://svn.example.internal/svn/Code2/trunk",
    };
  },
);

const WC_ROOT = path.resolve("/repo/code");

function makeScope(): OperationScope {
  const projectRoot = path.join(WC_ROOT, "app");
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
  return {
    secrets: { get: async () => undefined },
    extensionUri: { fsPath: "/ext" },
    subscriptions: [] as Array<{ dispose: () => void }>,
    workspaceState: {
      get: (_key: string, fallback?: unknown) => fallback,
      update: async () => undefined,
    },
  };
}

interface Harness {
  controller: WorkbenchController;
  session: WorkbenchSession;
  posted: HostToWebviewMessage[];
  send: (action: string, data?: Record<string, unknown>) => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  __resetWebviewPanels();
  const ruleService = {
    onDidInvalidate: () => ({ dispose: () => undefined }),
    getEffectiveRules: async () => undefined,
  };
  const controller = new WorkbenchController(
    makeContext() as never,
    ruleService as never,
    {
      servedModule: "changes",
    },
  );
  await controller.open({
    moduleId: "changes",
    svnPath: "svn",
    scope: makeScope(),
  });
  const panel = __webviewPanels[0];
  const posted: HostToWebviewMessage[] = [];
  panel.webview.postMessage = async (message: unknown) => {
    posted.push(message as HostToWebviewMessage);
  };
  const session = (controller as unknown as { session?: WorkbenchSession })
    .session;
  if (!session) throw new Error("会话尚未建立");
  const send = async (action: string, data?: Record<string, unknown>) => {
    await panel.__onMessage?.({
      protocolVersion: WORKBENCH_PROTOCOL_VERSION,
      type: "workbench/action",
      moduleId: "changes",
      taskId: "changes/overview",
      sessionId: session.sessionId,
      repositoryUuid: session.repositoryUuid,
      scopeHash: session.scopeHash,
      payload: { action, data },
    });
  };
  return { controller, session, posted, send };
}

describe("路径详情 Host 边界（v0.0.7）", () => {
  beforeEach(() => __resetWebviewPanels());

  it("范围内路径返回四段准确详情：URL 基于工作副本检出 URL", async () => {
    const { posted, send } = await createHarness();
    await send("file/path-detail", { relativePath: "app/src/a.ts" });
    const result = posted.find(
      (message) => message.type === "file/path-detail-result",
    );
    expect(result?.payload).toMatchObject({
      relativePath: "app/src/a.ts",
      detail: {
        projectRelativePath: "src/a.ts",
        workingCopyRelativePath: "app/src/a.ts",
        repositoryRelativePath: "trunk/app/src/a.ts",
        svnUrl: "https://svn.example.internal/svn/Code2/trunk/app/src/a.ts",
        absolutePath: path.join(WC_ROOT, "app/src/a.ts"),
      },
    });
  });

  it("范围外路径详情拒绝且不泄露绝对路径", async () => {
    const { posted, send } = await createHarness();
    await send("file/path-detail", { relativePath: "../outside/secret.ts" });
    const result = posted.find(
      (message) => message.type === "file/path-detail-result",
    );
    expect(result?.payload).toMatchObject({
      relativePath: "../outside/secret.ts",
      error: expect.stringContaining("不在当前操作范围"),
    });
    expect((result?.payload as { detail?: unknown }).detail).toBeUndefined();
  });

  it("范围外路径复制拒绝并给出恢复动作", async () => {
    const { posted, send } = await createHarness();
    await send("file/copy-path", { relativePath: "../outside/secret.ts" });
    const error = posted.find((message) => message.type === "operation/error");
    expect(error?.payload).toMatchObject({
      title: "无法复制完整路径",
      recoverable: true,
    });
  });

  it("缺少路径参数时安全拒绝", async () => {
    const { posted, send } = await createHarness();
    await send("file/path-detail", {});
    const result = posted.find(
      (message) => message.type === "file/path-detail-result",
    );
    expect((result?.payload as { error?: string }).error).toContain(
      "缺少文件路径",
    );
  });
});
