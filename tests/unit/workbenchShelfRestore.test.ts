import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import { RepositoryWorkbenchActions } from "../../src/extension/workbench/repositoryWorkbenchActions";
import { hashCandidateState } from "../../src/extension/workbench/workbenchSupport";

const VALID_PATCH = [
  "--- a/notes.txt",
  "+++ b/notes.txt",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  "",
].join("\n");

const SCOPE_ROOT = path.resolve(path.join(os.tmpdir(), "shelf-restore-scope"));

function makeHost(storageRoot: string) {
  return {
    context: { globalStorageUri: { fsPath: storageRoot } },
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
    createLocalShelf: vi.fn(async () => "created"),
    sendRepositorySnapshot: vi.fn(async () => undefined),
  };
}

function makeSession(repositoryUuid: string, candidates: unknown[] = []) {
  const candidateHash = hashCandidateState(candidates as never, "", []);
  return {
    svnPath: "svn",
    scope: {
      repositoryRoot: SCOPE_ROOT,
      roots: [],
    },
    scopeHash: "scope-1",
    repositoryUuid,
    repositoryState: {
      advanced: {
        preview: {
          token: "token-ok",
          candidateHash,
          scopeHash: "scope-1",
          repositoryUuid,
          operation: "restore-shelf",
          title: "恢复本地搁置",
          commands: ["svn patch <shelf>"],
          details: ["搁置：回归测试"],
          issues: [],
          destructive: true,
          input: { shelfId: "shelf-1", patchPath: undefined },
        },
      },
    },
  };
}

/** 在隔离临时目录中准备一个可恢复的搁置条目（真文件 + 真索引）。 */
function prepareShelf(storageRoot: string) {
  const shelfDir = path.join(storageRoot, "shelves", "repo-1");
  fs.mkdirSync(shelfDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(shelfDir, "shelf-1.patch"), VALID_PATCH, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.writeFileSync(
    path.join(shelfDir, "index.json"),
    JSON.stringify({
      version: 1,
      entries: [
        {
          id: "shelf-1",
          displayName: "回归测试",
          createdAt: "2026-09-08T00:00:00.000Z",
          fileCount: 1,
          files: ["notes.txt"],
          baselineRevision: "7",
          repositoryUuid: "repo-1",
          patchFileName: "shelf-1.patch",
          integrity: "ok",
        },
      ],
    }),
    { encoding: "utf8" },
  );
  return shelfDir;
}

let storageRoot = "";

beforeEach(() => {
  runSvnCommand.mockReset();
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shelf-restore-"));
});

afterEach(() => {
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("workbenchShelfRestore V024-R38 Host 级恢复链", () => {
  it("预览 token 不一致时拒绝执行且不碰工作副本", async () => {
    const host = makeHost(storageRoot);
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession("repo-1");
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      "token-stale",
    );
    expect(host.sendError).toHaveBeenCalledOnce();
    expect(host.sendError.mock.calls[0][1]).toBe("高级操作预览已失效");
    expect(runSvnCommand).not.toHaveBeenCalled();
    expect(
      (
        session.repositoryState.advanced as {
          preview?: unknown;
        }
      ).preview,
    ).toBeDefined();
  });

  it("候选变化时拒绝执行并作废旧预览", async () => {
    const host = makeHost(storageRoot);
    host.collectScopeCandidates.mockResolvedValue([
      {
        absolutePath: path.join(SCOPE_ROOT, "notes.txt"),
        relativePath: "notes.txt",
        status: "modified",
        selection: "selected",
      },
    ]);
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession("repo-1");
    await actions.executeAdvancedRepositoryOperation(
      session as never,
      "token-ok",
    );
    expect(host.sendError).toHaveBeenCalledOnce();
    expect(host.sendError.mock.calls[0][1]).toBe("高级操作预览已失效");
    expect(
      (
        session.repositoryState.advanced as {
          preview?: unknown;
        }
      ).preview,
    ).toBeUndefined();
    expect(runSvnCommand).not.toHaveBeenCalled();
    expect(host.sendRepositorySnapshot).toHaveBeenCalled();
  });

  it("取消恢复时不改工作副本并给出中文说明", async () => {
    prepareShelf(storageRoot);
    runSvnCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: true,
    });
    const host = makeHost(storageRoot);
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession("repo-1");
    const controller = new AbortController();
    await expect(
      actions.restoreShelfEntry(
        session as never,
        "shelf-1",
        undefined,
        controller.signal,
      ),
    ).rejects.toThrow("恢复搁置已取消，工作副本未改动。");
    const svnArgs = runSvnCommand.mock.calls.flatMap((call) =>
      (call[1] as string[]).flat(),
    );
    expect(svnArgs).toContain("patch");
    expect(svnArgs).not.toContain("commit");
  });

  it("成功恢复只写工作副本：不自动提交且搁置保留", async () => {
    const shelfDir = prepareShelf(storageRoot);
    runSvnCommand.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      cancelled: false,
    });
    const host = makeHost(storageRoot);
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = makeSession("repo-1");
    const controller = new AbortController();
    const message = await actions.restoreShelfEntry(
      session as never,
      "shelf-1",
      undefined,
      controller.signal,
    );
    expect(message).toContain("尚未提交");
    expect(message).toContain("已保留");
    const svnArgs = runSvnCommand.mock.calls.flatMap((call) =>
      (call[1] as string[]).flat(),
    );
    expect(svnArgs).toContain("patch");
    expect(svnArgs).not.toContain("commit");
    expect(svnArgs).not.toContain("revert");
    // 搁置在成功后保留：补丁文件与索引条目均仍在。
    expect(fs.existsSync(path.join(shelfDir, "shelf-1.patch"))).toBe(true);
    const listed = await actions.listShelfEntries(session as never);
    expect(listed.entries.map((entry) => entry.id)).toContain("shelf-1");
  });
});

describe("workbenchShelfRestore P3-1：repositoryUuid 白名单", () => {
  it("畸形 repositoryUuid fail-closed 拒绝", () => {
    const host = makeHost(storageRoot);
    const actions = new RepositoryWorkbenchActions(host as never);
    for (const bad of ["", "../evil", "repo/1", "..", "a\nb", "uuid-2-他仓"]) {
      expect(() =>
        actions.getShelfDirectory({ repositoryUuid: bad } as never),
      ).toThrow("仓库标识非法，已拒绝访问本地搁置。");
    }
  });

  it("合法 UUID（含 SVN 十六进制与 unavailable 回退形态）可定位目录", () => {
    const host = makeHost(storageRoot);
    const actions = new RepositoryWorkbenchActions(host as never);
    const resolved = actions.getShelfDirectory({
      repositoryUuid: "repo-1",
    } as never);
    expect(resolved.endsWith(path.join("shelves", "repo-1"))).toBe(true);
    const fallback = actions.getShelfDirectory({
      repositoryUuid: "unavailable-0123456789abcdef",
    } as never);
    expect(
      fallback.endsWith(path.join("shelves", "unavailable-0123456789abcdef")),
    ).toBe(true);
  });
});
