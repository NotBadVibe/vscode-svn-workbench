import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import { RepositoryWorkbenchActions } from "../../src/extension/workbench/repositoryWorkbenchActions";

const root = path.resolve("/repo");
const wcInfoXml =
  '<info><entry kind="dir" path="." revision="40"><url>https://svn.example/r/trunk</url><repository><root>https://svn.example/r</root></repository></entry></info>';
const sourceUrl = "https://svn.example/r/branches/feature-a";

function makeHost() {
  return {
    context: {},
    post: vi.fn(async () => undefined),
    sendError: vi.fn(async () => undefined),
    collectScopeCandidates: vi.fn(async () => []),
    buildRepositorySnapshot: vi.fn(async () => ({ kind: "repository" })),
    ensureAdvancedRepositoryState: (session: {
      repositoryState?: { advanced?: Record<string, unknown> };
    }) => {
      session.repositoryState ??= {};
      session.repositoryState.advanced ??= {};
      return session.repositoryState.advanced as never;
    },
    createLocalShelf: vi.fn(),
    sendRepositorySnapshot: vi.fn(async () => undefined),
  };
}

function makeSession() {
  return {
    svnPath: "svn",
    scope: {
      repositoryRoot: root,
      roots: [
        {
          absolutePath: path.join(root, "a"),
          relativePath: "a",
          kind: "folder",
        },
      ],
    },
    scopeHash: "scope-1",
    repositoryUuid: "repo-1",
    repositoryState: { advanced: {} },
  };
}

/**
 * P1-1：eligible/merged 并非严格互补，执行前复验必须同比两集合。
 * 桩按 --show-revs=eligible|merged 分别返回可配置集合。
 */
function stubMergePreview(eligible: string, merged: string) {
  runSvnCommand.mockImplementation(async (_svn: string, args: string[]) => {
    if (args[0] === "mergeinfo" && args[1] === "--show-revs=eligible") {
      return { exitCode: 0, stdout: eligible, stderr: "" };
    }
    if (args[0] === "mergeinfo" && args[1] === "--show-revs=merged") {
      return { exitCode: 0, stdout: merged, stderr: "" };
    }
    if (args[0] === "merge" && args.includes("--dry-run")) {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "merge") {
      return { exitCode: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "info") {
      return { exitCode: 0, stdout: wcInfoXml, stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
}

async function previewEligible(actions: never, session: never) {
  await (
    actions as RepositoryWorkbenchActions
  ).previewAdvancedRepositoryOperation(
    session as never,
    { operation: "merge", sourceUrl, mergeMode: "eligible" },
    "req-1",
  );
  const preview = (
    session as unknown as {
      repositoryState: { advanced: { preview: Record<string, unknown> } };
    }
  ).repositoryState.advanced.preview;
  expect(preview.issues).toEqual([]);
  return preview;
}

describe("P1-1 eligible 复验同比 merged 集合", () => {
  beforeEach(() => {
    runSvnCommand.mockReset();
  });

  it("预览快照同时记录 eligible 与 merged", async () => {
    stubMergePreview("r5\nr6\n", "r3\nr4\n");
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    const preview = await previewEligible(actions as never, session as never);
    expect(preview.input).toMatchObject({
      mergeMode: "eligible",
      mergeEligibleAtPreview: "5,6",
      mergeMergedAtPreview: "3,4",
    });
  });

  it("eligible 不变但 merged 变化仍视为旧预览失效", async () => {
    stubMergePreview("r5\nr6\n", "r3\nr4\n");
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    const preview = await previewEligible(actions as never, session as never);
    const token = preview.token as string;
    // record-only 等可单独改变 merged：eligible 仍为 5,6，merged 新增 r7。
    stubMergePreview("r5\nr6\n", "r3\nr4\nr7\n");
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      token,
      "req-2",
    );
    expect(host.sendError).toHaveBeenCalledWith(
      "repository",
      "合并条件已变化",
      expect.stringContaining("已合并"),
      true,
      "req-2",
    );
    // 旧预览已作废，不得执行真实合并。
    expect(
      runSvnCommand.mock.calls.some(
        (call) =>
          (call[1] as string[])[0] === "merge" &&
          !(call[1] as string[]).includes("--dry-run"),
      ),
    ).toBe(false);
  });

  it("两集合均不变时复验通过并执行完整合并", async () => {
    stubMergePreview("r5\nr6\n", "r3\nr4\n");
    const host = makeHost();
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession();
    const preview = await previewEligible(actions as never, session as never);
    const token = preview.token as string;
    runSvnCommand.mockClear();
    stubMergePreview("r5\nr6\n", "r3\nr4\n");
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      token,
      "req-9",
    );
    expect(host.sendError).not.toHaveBeenCalled();
    const mergeCall = runSvnCommand.mock.calls.find(
      (call) =>
        (call[1] as string[])[0] === "merge" &&
        !(call[1] as string[]).includes("--dry-run"),
    );
    expect(mergeCall).toBeDefined();
    // eligible 完整合并不带 -c/-r。
    expect(mergeCall![1] as string[]).not.toContain("-c");
    expect((mergeCall![1] as string[]).some((arg) => arg === "-r")).toBe(false);
  });
});
