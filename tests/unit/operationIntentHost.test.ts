import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import {
  validateOperationIntentForExecute,
  type OperationIntentView,
} from "../../src/operation/operationIntent";

/**
 * v0.0.14 批次 B Host 层四分支测试（成功 / 失效 token / 候选变化 / 带 issues）
 * 参照 WorkbenchController / RepositoryWorkbenchActions 的通用校验模式：
 * 用 Host 自存预览重建 intent 校验对象，Webview 只作展示。
 * 每种操作各 4 分支，共 12 种操作（commit/resolve/update/property/cleanup/changelist/file-operation/switch/branch/tag/relocate/merge）。
 * v0.1.5 V015-C3a：history-restore 从通用表移除——生产路径 history/execute-restore
 * 从不调用 validateOperationIntentForExecute，改走 token + issues + contentHash 复验，
 * 见本文件末尾的真实 Host 三分支测试。
 */

function baseIntent(
  overrides: Partial<OperationIntentView> = {},
): OperationIntentView {
  return {
    token: "tok-1",
    kind: "commit",
    title: "提交 2 个文件",
    summary: "提交 2 个文件",
    paths: ["src/a.ts", "src/b.ts"],
    scopeHash: "scope-1",
    candidateHash: "cand-1",
    repositoryUuid: "repo-1",
    createdAt: new Date().toISOString(),
    canExecute: true,
    issues: [],
    stale: false,
    ...overrides,
  };
}

const current = {
  repositoryUuid: "repo-1",
  scopeHash: "scope-1",
  candidateHash: "cand-1",
};

describe("Host 通用意向单校验四分支（12 操作）", () => {
  const cases: Array<{
    kind: OperationIntentView["kind"];
    title: string;
    paths: string[];
  }> = [
    { kind: "commit", title: "提交 2 个文件", paths: ["src/a.ts", "src/b.ts"] },
    { kind: "resolve", title: "标记解决 1 个冲突", paths: ["src/conflict.ts"] },
    { kind: "update", title: "更新 2 个远端变更", paths: ["src/overlap.ts"] },
    {
      kind: "property",
      title: "修改属性 svn:ignore（1 个路径）",
      paths: ["./"],
    },
    { kind: "cleanup", title: "清理工作副本", paths: ["/wc"] },
    {
      kind: "changelist-apply",
      title: "应用变更集到 2 个文件",
      paths: ["src/a.ts", "src/b.ts"],
    },
    { kind: "file-operation", title: "还原 1 个文件", paths: ["src/a.ts"] },
    {
      kind: "switch",
      title: "切换工作副本到 feature",
      paths: ["https://svn.example/branches/feature"],
    },
    {
      kind: "branch",
      title: "创建分支",
      paths: ["https://svn.example/branches/next"],
    },
    {
      kind: "tag",
      title: "创建标签",
      paths: ["https://svn.example/tags/v1.0"],
    },
    {
      kind: "relocate",
      title: "重定位",
      paths: ["https://svn.example/new-root"],
    },
    { kind: "merge", title: "合并 2 个路径", paths: ["src/a.ts", "src/b.ts"] },
  ];

  for (const c of cases) {
    describe(c.kind, () => {
      it("成功：token 匹配且候选一致", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
        });
        expect(
          validateOperationIntentForExecute(intent, "tok-1", current).ok,
        ).toBe(true);
      });
      it("失效 token：token 不匹配", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
        });
        const res = validateOperationIntentForExecute(
          intent,
          "bad-token",
          current,
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("已失效");
      });
      it("候选变化：candidateHash 不一致", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
          candidateHash: "cand-1",
        });
        const res = validateOperationIntentForExecute(intent, "tok-1", {
          ...current,
          candidateHash: "cand-2",
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("只读失效");
      });
      it("带 issues：canExecute 为 false 或 issues 非空", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
          canExecute: false,
          issues: ["存在未解决校验"],
        });
        const res = validateOperationIntentForExecute(intent, "tok-1", current);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("校验问题");
      });
    });
  }

  describe("scope 变化", () => {
    it("scopeHash 不一致视为 stale", () => {
      const intent = baseIntent({ scopeHash: "scope-1" });
      const res = validateOperationIntentForExecute(intent, "tok-1", {
        ...current,
        scopeHash: "scope-2",
      });
      expect(res.ok).toBe(false);
    });
  });

  describe("stale 标记", () => {
    it("intent.stale 为 true 时直接失效", () => {
      const intent = baseIntent({ stale: true });
      const res = validateOperationIntentForExecute(intent, "tok-1", current);
      expect(res.ok).toBe(false);
    });
  });
});

describe("history/execute-restore 真实 Host 三分支（token + issues + contentHash）", () => {
  // v0.1.5 V015-C3a：直驱 WorkbenchController 的 history/execute-restore 真实分支
  //（token 失配拒绝 / issues 非空拒绝 / contentHash 变化拒绝）。不断言任何平台
  // 路径——沙盒文件经 os.tmpdir() 创建；成功分支（svn cat + 写文件）不在本棒范围。
  const identities = {
    sessionId: "history-restore-session",
    repositoryUuid: "repo-1",
    scopeHash: "scope-1",
    taskId: "history/log",
  };
  type RestorePreview = NonNullable<
    NonNullable<WorkbenchSession["historyState"]>["restorePreview"]
  >;
  let sandboxDir = "";
  let targetFile = "";

  afterEach(() => {
    if (sandboxDir) rmSync(sandboxDir, { recursive: true, force: true });
    sandboxDir = "";
    targetFile = "";
  });

  function setupTargetFile(): void {
    sandboxDir = mkdtempSync(join(tmpdir(), "svn-restore-"));
    targetFile = join(sandboxDir, "extension.ts");
    writeFileSync(targetFile, "current working content\n", "utf8");
  }

  function createRestoreHarness(preview: RestorePreview): {
    session: WorkbenchSession;
    posted: HostToWebviewMessage[];
    send: (previewToken: string | undefined) => Promise<void>;
  } {
    const posted: HostToWebviewMessage[] = [];
    const controller = new WorkbenchController({ subscriptions: [] } as never);
    const scope: OperationScope = {
      id: "restore-scope",
      repositoryRoot: sandboxDir,
      source: "explorerFile",
      roots: [
        {
          absolutePath: targetFile,
          relativePath: "extension.ts",
          kind: "file",
        },
      ],
    };
    const session = {
      moduleId: "history",
      taskId: identities.taskId,
      svnPath: "svn",
      scope,
      sessionId: identities.sessionId,
      repositoryUuid: identities.repositoryUuid,
      scopeHash: identities.scopeHash,
      scopeView: {
        repositoryName: "repo",
        roots: [{ kind: "file", relativePath: "extension.ts" }],
        source: "explorer",
      },
      aiModels: {},
      security: { hasStoredAuthentication: false },
      historyState: { compareRevisions: [], restorePreview: preview },
    } as unknown as WorkbenchSession;
    (controller as unknown as { session?: WorkbenchSession }).session = session;
    (controller as unknown as { panel?: unknown }).panel = {
      webview: {
        postMessage: async (message: unknown) => {
          posted.push(message as HostToWebviewMessage);
        },
      },
    };
    const send = (previewToken: string | undefined): Promise<void> =>
      (
        controller as unknown as {
          handleAction: (message: unknown) => Promise<void>;
        }
      ).handleAction({
        protocolVersion: WORKBENCH_PROTOCOL_VERSION,
        type: "workbench/action",
        moduleId: "history",
        taskId: identities.taskId,
        sessionId: identities.sessionId,
        repositoryUuid: identities.repositoryUuid,
        scopeHash: identities.scopeHash,
        payload: {
          action: "history/execute-restore",
          data: { previewToken },
        },
      });
    return { session, posted, send };
  }

  function latestError(posted: HostToWebviewMessage[]): {
    title: string;
    message: string;
  } {
    const error = posted.find((message) => message.type === "operation/error");
    if (!error || error.type !== "operation/error")
      throw new Error("Host 未下发 operation/error");
    return error.payload;
  }

  function validPreview(
    overrides: Partial<RestorePreview> = {},
  ): RestorePreview {
    return {
      token: "tok-restore",
      contentHash: "stale-content-hash",
      revision: "12",
      relativePath: "extension.ts",
      issues: [],
      ...overrides,
    };
  }

  it("token 失配拒绝：恢复预览已失效", async () => {
    setupTargetFile();
    const { posted, send } = createRestoreHarness(validPreview());
    await send("bad-token");
    const error = latestError(posted);
    expect(error.title).toBe("恢复预览已失效");
    expect(error.message).toContain("请重新生成文件恢复预览");
  });

  it("issues 非空拒绝：恢复预览已失效", async () => {
    setupTargetFile();
    const { posted, send } = createRestoreHarness(
      validPreview({ issues: ["目标修订内容不满足安全恢复条件。"] }),
    );
    await send("tok-restore");
    const error = latestError(posted);
    expect(error.title).toBe("恢复预览已失效");
    expect(error.message).toContain("请重新生成文件恢复预览");
  });

  it("contentHash 变化拒绝：工作副本文件已变化并作废预览", async () => {
    setupTargetFile();
    const { session, posted, send } = createRestoreHarness(validPreview());
    await send("tok-restore");
    const error = latestError(posted);
    expect(error.title).toBe("工作副本文件已变化");
    expect(error.message).toContain("当前文件与预览时不同");
    expect(session.historyState?.restorePreview).toBeUndefined();
  });

  it("V015-C3b 应修 7：预览目标路径与当前文件不一致拒绝并作废预览", async () => {
    setupTargetFile();
    const { session, posted, send } = createRestoreHarness(
      validPreview({ relativePath: "other.ts" }),
    );
    await send("tok-restore");
    const error = latestError(posted);
    expect(error.title).toBe("恢复目标已变化");
    expect(error.message).toContain("恢复目标不一致");
    expect(session.historyState?.restorePreview).toBeUndefined();
  });
});
