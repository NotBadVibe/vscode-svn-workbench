import { describe, expect, it, vi } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  WORKBENCH_PROTOCOL_VERSION,
  type HistorySnapshot,
  type HostToWebviewMessage,
} from "../../src/protocol/workbenchProtocol";

vi.mock("../../src/svn/svnCommandRunner", () => ({
  runSvnCommand: vi.fn(),
}));

import { runSvnCommand } from "../../src/svn/svnCommandRunner";

const mockedRunSvn = vi.mocked(runSvnCommand);

const identities = {
  sessionId: "history-query-session",
  repositoryUuid: "repo-1",
  scopeHash: "scope-1",
  taskId: "history/revisions",
};

function logXml(
  entries: Array<{ revision: string; author: string; message: string }>,
): string {
  return `<log>${entries
    .map(
      (entry) =>
        `<logentry revision="${entry.revision}"><author>${entry.author}</author>` +
        `<date>2026-07-30T08:00:00.000000Z</date><msg>${entry.message}</msg></logentry>`,
    )
    .join("")}</log>`;
}

function okResult(stdout: string) {
  return {
    command: "svn",
    args: [],
    cwd: "/repo/code",
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
    cancelled: false,
  };
}

function makeScope(): OperationScope {
  return {
    id: "history-scope",
    repositoryRoot: "/repo/code",
    source: "explorerFolder",
    roots: [
      { absolutePath: "/repo/code/app", relativePath: "app", kind: "folder" },
    ],
  } as unknown as OperationScope;
}

function createHarness(initial?: Partial<WorkbenchSession["historyState"]>) {
  const posted: HostToWebviewMessage[] = [];
  const controller = new WorkbenchController({ subscriptions: [] } as never);
  const session = {
    moduleId: "history",
    taskId: identities.taskId,
    svnPath: "svn",
    scope: makeScope(),
    sessionId: identities.sessionId,
    repositoryUuid: identities.repositoryUuid,
    scopeHash: identities.scopeHash,
    scopeView: {
      repositoryName: "repo",
      roots: [{ kind: "folder", relativePath: "app" }],
      source: "explorer",
    },
    aiModels: {},
    security: { hasStoredAuthentication: false },
    historyState: {
      compareRevisions: [],
      historyLimit: 300,
      historyQuery: { author: "alice" },
      selectedRevision: "12",
      blame: [{ line: 1, revision: "12", author: "alice", content: "x" }],
      ...initial,
    },
  } as unknown as WorkbenchSession;
  (controller as unknown as { session?: WorkbenchSession }).session = session;
  (controller as unknown as { panel?: unknown }).panel = {
    webview: {
      postMessage: async (message: unknown) => {
        posted.push(message as HostToWebviewMessage);
      },
    },
  };
  const send = (action: string, data?: Record<string, unknown>) =>
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
      payload: { action, data },
    });
  return { controller, session, posted, send };
}

function historySnapshots(posted: HostToWebviewMessage[]): HistorySnapshot[] {
  return posted
    .filter((message) => message.type === "module/snapshot")
    .map(
      (message) =>
        (message as { payload: { snapshot: HistorySnapshot } }).payload
          .snapshot,
    )
    .filter((snapshot) => snapshot.kind === "history");
}

function errorPayload(posted: HostToWebviewMessage[]) {
  const error = posted.find((message) => message.type === "operation/error");
  if (!error || error.type !== "operation/error")
    throw new Error("Host 未下发 operation/error");
  return error.payload;
}

describe("历史按条件查询（V020-R05 · Host）", () => {
  it("新查询从首批重新读取并清理旧游标，失败与非法条件保留上一成功结果", async () => {
    mockedRunSvn.mockReset();
    mockedRunSvn.mockResolvedValueOnce(
      okResult(
        logXml([
          { revision: "12", author: "bob", message: "bob 的修订" },
          { revision: "11", author: "bob", message: "更早" },
        ]),
      ) as never,
    );
    const { session, posted, send } = createHarness();
    await send("history/query", { author: "bob" });
    const snapshots = historySnapshots(posted);
    expect(snapshots).toHaveLength(1);
    expect(session.historyState?.historyLimit).toBe(100);
    expect(session.historyState?.historyQuery).toEqual({ author: "bob" });
    // 旧游标清理：上一查询的 Blame 不再有效。
    expect(session.historyState?.blame).toBeUndefined();
    expect(snapshots[0]?.feedback).toContain("bob");
    const revisionsBefore = session.historyState
      ? historySnapshots(posted)[0]?.revisions.length
      : 0;

    // 非法条件：Host 复验拒绝，不改动上一成功结果。
    posted.length = 0;
    await send("history/query", { revisionFrom: "20", revisionTo: "10" });
    expect(errorPayload(posted).title).toBe("历史条件无效");
    expect(historySnapshots(posted)).toHaveLength(0);
    expect(session.historyState?.historyQuery).toEqual({ author: "bob" });
    expect(session.historyState?.historyLimit).toBe(100);
    expect(revisionsBefore).toBe(2);
  });

  it("慢旧响应不能覆盖新查询", async () => {
    mockedRunSvn.mockReset();
    let resolveFirst!: (value: never) => void;
    let resolveSecond!: (value: never) => void;
    mockedRunSvn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve as (value: never) => void;
        }) as never,
    );
    mockedRunSvn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSecond = resolve as (value: never) => void;
        }) as never,
    );
    const { session, posted, send } = createHarness({
      historyLimit: 100,
      historyQuery: {},
      blame: undefined,
    });
    const first = send("history/query", { author: "alice" });
    const second = send("history/query", { author: "bob" });
    // 等待两次只读请求都进入 svn 调用后再按“新先到、旧后到”依次放行。
    await vi.waitFor(() => {
      expect(mockedRunSvn).toHaveBeenCalledTimes(2);
    });
    resolveSecond(
      okResult(
        logXml([{ revision: "9", author: "bob", message: "新查询结果" }]),
      ) as never,
    );
    await second;
    // 旧查询后到达：即使 SVN 返回成功也不得覆盖新查询。
    resolveFirst(
      okResult(
        logXml([{ revision: "12", author: "alice", message: "旧查询结果" }]),
      ) as never,
    );
    await first;
    expect(session.historyState?.historyQuery).toEqual({ author: "bob" });
    const snapshots = historySnapshots(posted);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.revisions.map((item) => item.author)).toEqual(["bob"]);
  });
});
