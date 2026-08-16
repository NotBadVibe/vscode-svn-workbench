import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.8 批次 2 Host 提交选择 fail-closed（Controller 级）：
 * commit/update-selection 逐项候选复验，非法输入不修改既有选择；
 * buildCommitSnapshot 对旧状态过滤消失/excluded/blocked 并给出 feedback；
 * 规则/AI 应用的摘要只对最后一次手动选择（provenance）计算。
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
    fileType?: string;
    templateGroup?: string;
    generatedDecision?: string;
    reason?: string;
  }>,
  fail: false,
  /** 采集调用计数：证明勾选不重跑 SVN status（Task D）。 */
  count: 0,
}));

vi.mock("../../src/commit/commitDiffSummary", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/commit/commitDiffSummary")>();
  return {
    ...actual,
    // generate-message 的差异摘要：测试环境不执行真实 SVN。
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
      if (collectorControl.fail) throw new Error("svn 状态采集失败");
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

function errorMessages(): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) =>
        (message as { payload: { message: string } }).payload.message,
    );
}

function feedbackMessage(): string | undefined {
  const snapshot = posted.find(
    (message) =>
      message.type === "module/snapshot" &&
      (message as { payload: { snapshot: { feedback?: { message: string } } } })
        .payload.snapshot.feedback,
  );
  if (!snapshot) return undefined;
  return (
    snapshot as {
      payload: { snapshot: { feedback: { message: string } } };
    }
  ).payload.snapshot.feedback.message;
}

beforeEach(() => {
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
  collectorControl.fail = false;
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("commit/update-selection fail-closed", () => {
  it("合法选择（含去重）写入 state 并清空旧预览", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts", "app/a.ts"],
    });
    // 消息处理异步 fire-and-forget：等待至少一次回发（快照或错误）。
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual([
      "app/a.ts",
      "app/review.ts",
    ]);
    expect(session.commitState?.preview).toBeUndefined();
    expect(errorMessages()).toEqual([]);
  });

  it("合法 update-selection 复用候选缓存，不触发第二次采集（Task D）", async () => {
    const { send } = await createCommitSession();
    // 单元环境无 webview/ready：首次 update-selection 采集一次用于校验。
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(collectorControl.count).toBe(1);
    // 第二次合法更新复用缓存：不重跑 SVN status。
    posted.length = 0;
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(collectorControl.count).toBe(1);
    // refresh 重新采集。
    await send("refresh");
    await vi.waitFor(
      () => expect(collectorControl.count).toBeGreaterThanOrEqual(2),
      { timeout: 3000 },
    );
  });

  it("候选缺失路径拒绝：不修改既有选择并返回中文错误与恢复动作", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const before = session.commitState?.selectedPaths;
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/ghost.ts"],
    });
    expect(session.commitState?.selectedPaths).toEqual(before);
    expect(errorMessages().join("\n")).toContain("不在当前候选集合");
    expect(errorMessages().join("\n")).toContain("刷新状态后重新选择");
  });

  it("excluded/blocked 路径拒绝，保留合法现状", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/excluded.ts", "app/blocked.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(errorMessages().join("\n")).toContain("排除/阻止项");
  });
});

describe("buildCommitSnapshot 旧状态清理与 feedback", () => {
  it("候选状态变化后 excluded/blocked 经快照构建自动移除并给一次性 feedback", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 候选状态变化：a.ts 变 blocked、review.ts 变 excluded。
    collectorControl.candidates = collectorControl.candidates.map((item) => ({
      ...item,
      selection:
        item.relativePath === "app/a.ts"
          ? "blocked"
          : item.relativePath === "app/review.ts"
            ? "excluded"
            : item.selection,
    }));
    posted.length = 0;
    await send("refresh");
    await vi.waitFor(
      () => expect(session.commitState?.selectedPaths).toEqual([]),
      { timeout: 3000 },
    );
    expect(feedbackMessage()).toContain("移除 1 个失效选择");
    expect(feedbackMessage()).toContain("阻止项");
  });

  it("消失路径在快照构建时移除", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    collectorControl.candidates = collectorControl.candidates.filter(
      (candidate) => candidate.relativePath !== "app/a.ts",
    );
    await send("refresh");
    await vi.waitFor(
      () => expect(session.commitState?.selectedPaths).toEqual([]),
      { timeout: 3000 },
    );
    expect(feedbackMessage()).toContain("已从工作副本快照中消失");
  });
});

describe("commit/preview 与 generate-message 整批校验（Finding 1）", () => {
  it("伪造 valid+ghost：整批拒绝，不改 state、不生成预览，返回错误与恢复动作", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/preview", {
      selectedPaths: ["app/a.ts", "app/ghost.ts"],
      message: "feat: 测试",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 不改 state、不生成 preview。
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.preview).toBeUndefined();
    expect(errorMessages().join("\n")).toContain("不在当前候选集合");
    expect(errorMessages().join("\n")).toContain("刷新状态后重新选择");
  });

  it("伪造 excluded / blocked：整批拒绝且保留合法现状", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/preview", {
      selectedPaths: ["app/a.ts", "app/excluded.ts"],
      message: "feat: 测试",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(errorMessages().join("\n")).toContain("排除/阻止项");
    posted.length = 0;
    await send("commit/preview", {
      selectedPaths: ["app/a.ts", "app/blocked.ts"],
      message: "feat: 测试",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
  });

  it("合法重复规范化唯一后生成预览，且预览不因重复计数", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/preview", {
      selectedPaths: ["app/a.ts", "app/a.ts", "app/review.ts"],
      message: "feat: 测试",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual([
      "app/a.ts",
      "app/review.ts",
    ]);
    expect(errorMessages()).toEqual([]);
  });

  it("generate-message 携带 invalid 选择：不调用 AI、不改状态", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    const messageBefore = session.commitState?.message;
    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts", "app/ghost.ts"],
      message: "草稿",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 状态不变、无 AI 结果。
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.message).toBe(messageBefore);
    expect(session.commitState?.ai).toBeUndefined();
    expect(errorMessages().join("\n")).toContain("不在当前候选集合");
  });
});

describe("快照身份一致性（Finding 2）", () => {
  it("工作副本外候选 fail-closed 排除：files/summary/选择三处一致", async () => {
    const { session, send } = await createCommitSession();
    // 注入一个 WC 外候选（absolutePath 不在 repositoryRoot 下）。
    collectorControl.candidates = [
      ...collectorControl.candidates,
      {
        absolutePath: "/elsewhere/ghost.ts",
        relativePath: "../ghost.ts",
        status: "modified",
        selection: "selected",
      },
    ];
    await send("refresh");
    // 快照异步构建后发布：轮询等待 commit 快照出现。
    let snapshot: HostToWebviewMessage | undefined;
    await vi.waitFor(
      () => {
        snapshot = posted.find(
          (message) =>
            message.type === "module/snapshot" &&
            (message as { payload: { snapshot: { kind?: string } } }).payload
              .snapshot.kind === "commit",
        );
        expect(snapshot).toBeDefined();
      },
      { timeout: 3000 },
    );
    const commitSnapshot = snapshot as unknown as {
      payload: {
        snapshot: {
          files: Array<{ relativePath: string }>;
          summary: { total: number; selected: number };
          selectedPaths: string[];
        };
      };
    };
    const files = commitSnapshot.payload.snapshot.files;
    expect(files.some((file) => file.relativePath === "../ghost.ts")).toBe(
      false,
    );
    expect(commitSnapshot.payload.snapshot.summary.total).toBe(files.length);
    expect(
      commitSnapshot.payload.snapshot.selectedPaths.includes("../ghost.ts"),
    ).toBe(false);
    expect(
      session.commitState?.candidates?.some(
        (item) => item.relativePath === "../ghost.ts",
      ),
    ).toBe(false);
    // WC 外候选不能经 update-selection 进入。
    posted.length = 0;
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "../ghost.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(errorMessages().join("\n")).toContain("不在当前候选集合");
  });
});

describe("provenance 回放保护（Lead 代码审查 finding）", () => {
  it("apply-local-rules 后合法 preview 回放选择不虚构手动来源", async () => {
    const { session, send } = await createCommitSession();
    // 手动选择后应用规则：manual 清空。
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/apply-local-rules");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
    // 合法 preview 带回相同 selectedPaths（规则推荐集）：只是回放，不得
    // 重新创建 manualSelectedPaths。
    posted.length = 0;
    await send("commit/preview", {
      selectedPaths: session.commitState?.selectedPaths ?? [],
      message: "feat: 测试",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.preview).toBeDefined();
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
  });

  it("合法 generate-message 回放选择同样不虚构手动来源", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;
    await send("commit/apply-local-rules");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
    // 合法 generate-message（走 local-rule-fallback，无外部 AI 依赖）。
    // v0.0.9 §4：生成结果只进入建议草稿，绝不覆盖用户已填草稿。
    const messageBefore = session.commitState?.message ?? "";
    posted.length = 0;
    await send("commit/generate-message", {
      selectedPaths: session.commitState?.selectedPaths ?? [],
      message: messageBefore,
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe(messageBefore);
    expect(
      (session.commitState?.messageSuggestion?.message ?? "").length,
    ).toBeGreaterThan(0);
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
  });

  it("preview 省略 selectedPaths 时对 stale state 整批拒绝（状态不变）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", { selectedPaths: ["app/a.ts"] });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 候选变化：a.ts 消失，state 残留 stale 选择。
    collectorControl.candidates = collectorControl.candidates.filter(
      (item) => item.relativePath !== "app/a.ts",
    );
    // 直接注入旧 state 的 stale 选择（模拟快照后消失的场景）。
    session.commitState!.selectedPaths = ["app/a.ts", "app/stale.ts"];
    posted.length = 0;
    // 省略 selectedPaths：必须对当前 state 用本次权威候选校验，不得静默取交集。
    await send("commit/preview", { message: "feat: 测试" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual([
      "app/a.ts",
      "app/stale.ts",
    ]);
    expect(session.commitState?.preview).toBeUndefined();
    expect(errorMessages().join("\n")).toContain("不在当前候选集合");
  });
});

describe("规则/AI 应用的手动选择 provenance", () => {
  it("apply-local-rules 摘要只对最后一次手动选择计算，随后清空手动跟踪", async () => {
    const { session, send } = await createCommitSession();
    // 手动选择 a.ts + review.ts。
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toEqual([
      "app/a.ts",
      "app/review.ts",
    ]);
    // 规则推荐只有 a.ts：摘要应描述 review.ts 被移除。
    posted.length = 0;
    await send("commit/apply-local-rules");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]);
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
    expect(feedbackMessage()).toContain("保留 1 个手动选择");
    expect(feedbackMessage()).toContain("移除 1 个");
  });

  it("刷新使手动选择失效后 manualSelectedPaths 收敛，规则摘要不再报告其为手动（Task C）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-selection", {
      selectedPaths: ["app/a.ts", "app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toEqual([
      "app/a.ts",
      "app/review.ts",
    ]);
    // 刷新后 review 变为 blocked：selectedPaths 与 manualSelectedPaths 都收敛。
    collectorControl.candidates = collectorControl.candidates.map((item) => ({
      ...item,
      selection:
        item.relativePath === "app/review.ts" ? "blocked" : item.selection,
    }));
    posted.length = 0;
    await send("refresh");
    await vi.waitFor(
      () => expect(session.commitState?.selectedPaths).toEqual(["app/a.ts"]),
      { timeout: 3000 },
    );
    expect(session.commitState?.manualSelectedPaths).toEqual(["app/a.ts"]);
    // 应用本地规则：摘要不得再把已失效的 review 称为“移除手动选择”。
    posted.length = 0;
    await send("commit/apply-local-rules");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(feedbackMessage()).toContain("保留 1 个手动选择");
    expect(feedbackMessage()).not.toContain("移除 1 个手动选择");
  });

  it("规则应用后再次手动选择会重建 provenance", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/apply-local-rules");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toBeUndefined();
    posted.length = 0;
    await send("commit/update-selection", {
      selectedPaths: ["app/review.ts"],
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.manualSelectedPaths).toEqual(["app/review.ts"]);
  });
});
