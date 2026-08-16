import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type CommitMessageSuggestion,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";
import { __resetWebviewPanels, __webviewPanels } from "../mocks/vscode";

/*
 * v0.0.9 §4 提交说明建议草稿保护（Controller 级）：
 * - 生成、失败、超时、取消、降级均不覆盖用户草稿，结果只进入
 *   messageSuggestion 建议区；
 * - 采用必须显式（insert-blank-fields / replace），替换前校验并备份可撤销；
 * - 范围/候选变化使建议过期：只能查看，不能采用；用户草稿保留；
 * - 无足够输入时不生成建议，草稿保持不变。
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

function errorMessages(): string[] {
  return posted
    .filter((message) => message.type === "operation/error")
    .map(
      (message) =>
        (message as { payload: { message: string } }).payload.message,
    );
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

async function generateSuggestion(
  send: (action: string, data?: Record<string, unknown>) => Promise<void>,
): Promise<CommitMessageSuggestion> {
  await send("commit/generate-message", {
    selectedPaths: ["app/a.ts"],
    message: "需求: 修复登录超时",
  });
  await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
  const suggestion = posted.find(
    (m) =>
      m.type === "module/snapshot" &&
      (
        m as {
          payload: {
            snapshot: { messageSuggestion?: CommitMessageSuggestion };
          };
        }
      ).payload.snapshot.messageSuggestion,
  ) as
    | {
        payload: {
          snapshot: { messageSuggestion: CommitMessageSuggestion };
        };
      }
    | undefined;
  if (!suggestion) throw new Error("未生成建议草稿");
  return suggestion.payload.snapshot.messageSuggestion;
}

beforeEach(() => {
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
});

afterEach(() => {
  __resetWebviewPanels();
});

describe("commit/generate-message 生成建议草稿，不覆盖用户草稿", () => {
  it("生成结果只进入 messageSuggestion，message 保持不变", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: ["app/a.ts", "app/b.ts"],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    const suggestion = session.commitState?.messageSuggestion;
    expect(suggestion).toBeDefined();
    expect((suggestion?.message ?? "").length).toBeGreaterThan(0);
    expect(suggestion?.token).toBeTruthy();
    // 本地回退为结构化占位草稿，明确标记“基于文件信息”。
    expect(suggestion?.source).toBe("local-rule-fallback");
    expect(suggestion?.metadataOnly).toBe(true);
    expect(suggestion?.binding?.scopeHash).toBe(session.scopeHash);
  });

  it("没有勾选文件时不生成建议，草稿保持不变并给出原因", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/generate-message", {
      selectedPaths: [],
      message: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(session.commitState?.messageSuggestion).toBeUndefined();
    expect(latestCommitSnapshot().feedback?.message).toContain(
      "提交说明保持不变",
    );
  });
});

describe("commit/adopt-suggestion 显式采用", () => {
  it("insert-blank-fields 只补充空白字段，不删除/改写用户已填内容", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", {
      message: "需求: 修复登录超时\n风险: 高",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "insert-blank-fields",
      currentMessage: "需求: 修复登录超时\n风险: 高",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.message).toContain("需求: 修复登录超时");
    expect(session.commitState?.message).toContain("风险: 高");
    // 建议中的空白字段（“文件：”）被补充，用户已填内容未动。
    expect(session.commitState?.message).toContain("文件：");
    // 建议草稿仍保留（可继续对比或放弃）。
    expect(session.commitState?.messageSuggestion?.token).toBe(
      suggestion.token,
    );
    expect(session.commitState?.messageSuggestionReplaceBackup).toBeUndefined();
  });

  it("replace 替换草稿并备份，反馈包含“可撤销替换”", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.message).toBe(suggestion.message.trim());
    expect(session.commitState?.messageSuggestionReplaceBackup?.previous).toBe(
      "需求: 修复登录超时",
    );
    expect(latestCommitSnapshot().feedback?.message).toContain("可撤销替换");
  });

  it("替换后重复快照仍持续提供撤销反馈（撤销入口不因一次性反馈消失）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    // 再次触发快照构建（如预览刷新）：撤销反馈仍保留。
    posted.length = 0;
    await send("commit/update-draft", {
      message: session.commitState?.message ?? "",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(latestCommitSnapshot().feedback?.message).toContain("可撤销替换");
    expect(session.commitState?.messageSuggestionReplaceBackup).toBeDefined();
  });

  it("token 不匹配：拒绝采用，草稿不变", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: "wrong-token",
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(errorMessages().join("\n")).toContain("已不存在或已被替换");
  });

  it("未知 mode：拒绝且草稿不变", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "mystery",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(errorMessages().join("\n")).toContain(
      "未知的 adopt-suggestion 模式",
    );
  });

  it("replace 被拒（与草稿相同）后补发快照，草稿不变且建议保留", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    // 构造与当前草稿完全相同的建议 → replace 校验拒绝（AI09-DRAFT-02）。
    session.commitState!.messageSuggestion = {
      ...suggestion,
      message: "需求: 修复登录超时",
    };
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));

    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(errorMessages().join("\n")).toContain(
      "建议内容与当前草稿相同，未重复替换。",
    );
    // 拒绝后补发快照：message 仍为原草稿，建议仍保留，供 Webview 回滚本地文本框。
    const snapshot = latestCommitSnapshot();
    expect(snapshot.message).toBe("需求: 修复登录超时");
    expect(snapshot.messageSuggestion?.token).toBe(suggestion.token);
  });
});

describe("commit/undo-suggestion-replace 撤销替换", () => {
  it("撤销恢复替换前草稿并清除备份", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const replaced = session.commitState?.message;
    expect(replaced).not.toBe("需求: 修复登录超时");

    posted.length = 0;
    await send("commit/undo-suggestion-replace");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(session.commitState?.messageSuggestionReplaceBackup).toBeUndefined();
    // 建议草稿仍保留，可再次对比。
    expect(session.commitState?.messageSuggestion?.token).toBe(
      suggestion.token,
    );
  });

  it("没有可撤销记录时拒绝并保留草稿", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    await send("commit/undo-suggestion-replace");
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(errorMessages().join("\n")).toContain(
      "没有可撤销的提交说明替换记录",
    );
  });

  it("替换后用户手动编辑草稿，备份失效（不再提供撤销）", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.messageSuggestionReplaceBackup).toBeDefined();

    // 用户手动编辑草稿（接管内容）。
    posted.length = 0;
    await send("commit/update-draft", { message: "用户接管后的新草稿" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.messageSuggestionReplaceBackup).toBeUndefined();
    expect(latestCommitSnapshot().feedback?.message ?? "").not.toContain(
      "可撤销替换",
    );
  });
});

describe("commit/discard-suggestion 放弃建议", () => {
  it("放弃后建议清除，草稿保持不变", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    posted.length = 0;
    await send("commit/discard-suggestion", { token: suggestion.token });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.messageSuggestion).toBeUndefined();
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
  });
});

describe("范围/候选变化使建议过期（AI09-DRAFT-01 / AI09-RECOVER-02）", () => {
  it("候选变化后建议标记 stale，采用被拒绝且草稿保留", async () => {
    const { session, send } = await createCommitSession();
    await send("commit/update-draft", { message: "需求: 修复登录超时" });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    posted.length = 0;

    const suggestion = await generateSuggestion(send);
    // 候选变化：a.ts 消失。
    collectorControl.candidates = [
      {
        absolutePath: `${WC_ROOT}/app/b.ts`,
        relativePath: "app/b.ts",
        status: "added",
        selection: "selected",
      },
    ];
    posted.length = 0;
    await send("refresh");
    // 等待 refresh 后的 commit 快照（loading 消息先到，需等快照本体）。
    await vi.waitFor(
      () =>
        expect(
          posted.filter(
            (m) =>
              m.type === "module/snapshot" &&
              (m as { payload: { snapshot: { kind?: string } } }).payload
                .snapshot.kind === "commit",
          ).length,
        ).toBeGreaterThan(0),
      { timeout: 3000 },
    );

    const snapshot = latestCommitSnapshot();
    expect(snapshot.messageSuggestion?.stale).toBe(true);
    // 过期建议在快照中只读展示，用户草稿保留。
    expect(snapshot.message).toBe("需求: 修复登录超时");

    // 采用过期建议：拒绝。
    posted.length = 0;
    await send("commit/adopt-suggestion", {
      token: suggestion.token,
      mode: "replace",
      currentMessage: "需求: 修复登录超时",
    });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    expect(session.commitState?.message).toBe("需求: 修复登录超时");
    expect(errorMessages().join("\n")).toContain("范围或候选已变化");
  });
});
