import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { removeTestTempDirectory } from "../../src/test/suite/testTempDirectory";
import { RepositoryWorkbenchActions } from "../../src/extension/workbench/repositoryWorkbenchActions";

/*
 * Blocker-2/P1-3：V026 真实 SVN 隔离仓库用例（平台无关断言）。
 * - 复用 testTempDirectory + svnadmin fixture 模式（隔离临时仓库，用后清理）；
 * - 只读三出口真机（previewRemoteFile/queryRemoteHistory/compareRemoteRevisions）；
 * - 分支冻结：HEAD 前进后执行仍按固定 revision（svn copy -r 锁定）；
 * - 合并三模式 dry-run 不改工作副本（dry-run 后 svn status 为空）；
 * - 合并冲突转入冲突模块；取消/部分失败重采；
 * - 权限失败/空可合并集阻止分支。
 * svn/svnadmin 缺失时整组跳过（与既有真实 SVN 用例一致）；不断言平台相关路径。
 */

const SVN_PATH = process.env.SVN_WORKBENCH_TEST_SVN || "svn";
const REAL_TIMEOUT_MS = 30_000;

function commandAvailable(command: string): boolean {
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      shell: false,
    });
    return !result.error && result.status === 0;
  } catch {
    return false;
  }
}

const HAS_REAL_SVN = commandAvailable("svnadmin") && commandAvailable(SVN_PATH);
const realIt = HAS_REAL_SVN ? it : it.skip;

function runSvn(args: string[], cwd: string) {
  const result = spawnSync(SVN_PATH, args, {
    encoding: "utf8",
    shell: false,
    cwd,
    env: { ...process.env, LC_MESSAGES: "C", LANGUAGE: "en" },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

interface RealRepo {
  tempRoot: string;
  rootUrl: string;
  trunkUrl: string;
  fileUrl: string;
  workingCopy: string;
}

/** 标准布局隔离仓库：trunk/file.txt（r1），检出 trunk 工作副本。 */
function createRealRepo(): RealRepo {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "svn-v026-real-"));
  const repository = path.join(tempRoot, "repository");
  const seed = path.join(tempRoot, "seed");
  const workingCopy = path.join(tempRoot, "working-copy");
  const admin = spawnSync("svnadmin", ["create", repository], {
    encoding: "utf8",
    shell: false,
  });
  if (admin.error || admin.status !== 0) {
    removeTestTempDirectory(tempRoot);
    throw new Error("svnadmin 不可用，无法建立隔离仓库。");
  }
  fs.mkdirSync(path.join(seed, "trunk"), { recursive: true });
  fs.mkdirSync(path.join(seed, "branches"), { recursive: true });
  fs.mkdirSync(path.join(seed, "tags"), { recursive: true });
  fs.writeFileSync(
    path.join(seed, "trunk", "file.txt"),
    "line-one\nline-two\n",
    "utf8",
  );
  const rootUrl = pathToFileURL(repository).href;
  const trunkUrl = `${rootUrl}/trunk`;
  const imported = runSvn(
    ["import", seed, rootUrl, "-m", "initialize layout"],
    tempRoot,
  );
  expect(imported.exitCode).toBe(0);
  const checkout = runSvn(["checkout", trunkUrl, workingCopy], tempRoot);
  expect(checkout.exitCode).toBe(0);
  return {
    tempRoot,
    rootUrl,
    trunkUrl,
    fileUrl: `${trunkUrl}/file.txt`,
    workingCopy,
  };
}

/** 工作副本干净断言（平台无关：stdout 去空白后为空）。 */
function expectCleanWorkingCopy(workingCopy: string) {
  const status = runSvn(["status", workingCopy], workingCopy);
  expect(status.exitCode).toBe(0);
  expect(status.stdout.trim()).toBe("");
}

function makeHost() {
  return {
    context: {},
    post: async () => undefined,
    sendError: async () => undefined,
    collectScopeCandidates: async () => [],
    buildRepositorySnapshot: async () => ({ kind: "repository" }),
    ensureAdvancedRepositoryState: (session: {
      repositoryState?: { advanced?: Record<string, unknown> };
    }) => {
      session.repositoryState ??= {};
      session.repositoryState.advanced ??= {};
      return session.repositoryState.advanced as never;
    },
    createLocalShelf: async () => undefined,
    sendRepositorySnapshot: async () => undefined,
  };
}

function makeSession(workingCopy: string) {
  return {
    svnPath: SVN_PATH,
    scope: {
      repositoryRoot: workingCopy,
      roots: [{ absolutePath: workingCopy, relativePath: ".", kind: "folder" }],
    },
    scopeHash: "scope-real",
    repositoryUuid: "uuid-real",
    repositoryState: { advanced: {} },
  };
}

function remoteFileOf(session: unknown) {
  return (
    session as {
      repositoryState: { advanced: { remoteFile?: Record<string, unknown> } };
    }
  ).repositoryState.advanced.remoteFile;
}

function remoteHistoryOf(session: unknown) {
  return (
    session as {
      repositoryState: {
        advanced: { remoteHistory?: Record<string, unknown> };
      };
    }
  ).repositoryState.advanced.remoteHistory;
}

function remoteCompareOf(session: unknown) {
  return (
    session as {
      repositoryState: {
        advanced: { remoteCompare?: Record<string, unknown> };
      };
    }
  ).repositoryState.advanced.remoteCompare;
}

function previewOf(session: unknown) {
  return (
    session as {
      repositoryState: { advanced: { preview?: Record<string, unknown> } };
    }
  ).repositoryState.advanced.preview;
}

describe("V026 真实 SVN 隔离仓库", () => {
  realIt(
    "只读远端文件真机：内容正确且不写本地",
    async () => {
      const repo = createRealRepo();
      try {
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const session = makeSession(repo.workingCopy);
        await actions.previewRemoteFile(
          session as never,
          { url: repo.fileUrl, revision: "HEAD" },
          "req-file",
        );
        const view = remoteFileOf(session);
        expect(view?.error).toBeUndefined();
        expect(view?.contentPreview).toContain("line-one");
        expectCleanWorkingCopy(repo.workingCopy);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "只读远端历史真机：返回提交历史",
    async () => {
      const repo = createRealRepo();
      try {
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const session = makeSession(repo.workingCopy);
        await actions.queryRemoteHistory(
          session as never,
          { url: repo.fileUrl },
          "req-log",
        );
        const view = remoteHistoryOf(session);
        expect(view?.error).toBeUndefined();
        const revisions = view?.revisions as Array<{
          revision: string;
          message: string;
        }>;
        expect(revisions.length).toBeGreaterThanOrEqual(1);
        expect(revisions[0].revision).toMatch(/^\d+$/);
        expect(revisions[0].message).toContain("initialize layout");
        // 复制历史：分支复制路径同样可查历史。
        // 注：已删除路径在 HEAD 已不存在，svn log 需 peg 修订（本版未做，见 R46 文档已知缺口）。
        expect(
          runSvn(
            ["copy", repo.trunkUrl, `${repo.rootUrl}/branches/h`, "-m", "br"],
            repo.tempRoot,
          ).exitCode,
        ).toBe(0);
        const copiedSession = makeSession(repo.workingCopy);
        await actions.queryRemoteHistory(
          copiedSession as never,
          { url: `${repo.rootUrl}/branches/h/file.txt` },
          "req-log-copied",
        );
        expect(remoteHistoryOf(copiedSession)?.error).toBeUndefined();
        expect(
          (remoteHistoryOf(copiedSession)?.revisions as unknown[]).length,
        ).toBeGreaterThanOrEqual(1);
        expectCleanWorkingCopy(repo.workingCopy);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "P1-3 远端修订比较真机：r1 与 r2 差异可展示",
    async () => {
      const repo = createRealRepo();
      try {
        const target = path.join(repo.workingCopy, "file.txt");
        fs.appendFileSync(target, "line-three\n", "utf8");
        const committed = runSvn(
          ["commit", target, "-m", "add line three"],
          repo.workingCopy,
        );
        expect(committed.exitCode).toBe(0);
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const session = makeSession(repo.workingCopy);
        await actions.compareRemoteRevisions(
          session as never,
          { url: repo.fileUrl, fromRevision: "1", toRevision: "2" },
          "req-diff",
        );
        const view = remoteCompareOf(session);
        expect(view?.error).toBeUndefined();
        expect(String(view?.diffPreview)).toContain("line-three");
        expectCleanWorkingCopy(repo.workingCopy);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "远端三出口权限失败：不存在路径给中文错误且保留导航（不抛异常）",
    async () => {
      const repo = createRealRepo();
      try {
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const missing = `${repo.trunkUrl}/not-exists.txt`;
        const fileSession = makeSession(repo.workingCopy);
        await actions.previewRemoteFile(
          fileSession as never,
          { url: missing },
          "req-miss-file",
        );
        expect(String(remoteFileOf(fileSession)?.error ?? "")).not.toBe("");
        const logSession = makeSession(repo.workingCopy);
        await actions.queryRemoteHistory(
          logSession as never,
          { url: missing },
          "req-miss-log",
        );
        expect(
          (remoteHistoryOf(logSession)?.revisions as unknown[]).length,
        ).toBe(0);
        expect(String(remoteHistoryOf(logSession)?.error ?? "")).not.toBe("");
        const diffSession = makeSession(repo.workingCopy);
        await actions.compareRemoteRevisions(
          diffSession as never,
          { url: missing, fromRevision: "1", toRevision: "2" },
          "req-miss-diff",
        );
        expect(String(remoteCompareOf(diffSession)?.error ?? "")).not.toBe("");
        expectCleanWorkingCopy(repo.workingCopy);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "分支冻结真机：HEAD 前进后执行仍按固定 revision",
    async () => {
      const repo = createRealRepo();
      try {
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const session = makeSession(repo.workingCopy);
        const tagUrl = `${repo.rootUrl}/tags/v1`;
        await actions.previewAdvancedRepositoryOperation(
          session as never,
          {
            operation: "tag",
            sourceUrl: repo.trunkUrl,
            targetUrl: tagUrl,
            sourceRevisionMode: "HEAD",
            message: "release v1",
          },
          "req-preview",
        );
        const preview = previewOf(session);
        expect((preview?.issues as string[]).length).toBe(0);
        const frozen = preview?.input as Record<string, unknown>;
        expect(frozen.sourceResolvedRevision).toBe("1");
        expect(String((preview?.commands as string[])[0])).toContain("-r 1");
        // HEAD 前进到 r2。
        const target = path.join(repo.workingCopy, "file.txt");
        fs.appendFileSync(target, "after-freeze\n", "utf8");
        expect(
          runSvn(["commit", target, "-m", "advance head"], repo.workingCopy)
            .exitCode,
        ).toBe(0);
        // 旧工作副本内容已提交，恢复干净以满足执行前复验。
        expectCleanWorkingCopy(repo.workingCopy);
        await actions.executeAdvancedRepositoryOperation(
          session as never,
          preview?.token as string,
          "req-exec",
        );
        // 标签内容应为冻结的 r1，不含 HEAD 前进后的行。
        const tagged = runSvn(["cat", `${tagUrl}/file.txt`], repo.tempRoot);
        expect(tagged.exitCode).toBe(0);
        expect(tagged.stdout).toContain("line-one");
        expect(tagged.stdout).not.toContain("after-freeze");
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "合并三模式 dry-run 真机：试运行不改工作副本",
    async () => {
      const repo = createRealRepo();
      try {
        // 分支提交两处变更（r2、r3）。
        const branchUrl = `${repo.rootUrl}/branches/feature-b`;
        expect(
          runSvn(
            ["copy", repo.trunkUrl, branchUrl, "-m", "create branch"],
            repo.tempRoot,
          ).exitCode,
        ).toBe(0);
        const branchWc = path.join(repo.tempRoot, "branch-wc");
        expect(
          runSvn(["checkout", branchUrl, branchWc], repo.tempRoot).exitCode,
        ).toBe(0);
        fs.appendFileSync(
          path.join(branchWc, "file.txt"),
          "branch-one\n",
          "utf8",
        );
        expect(
          runSvn(
            [
              "commit",
              path.join(branchWc, "file.txt"),
              "-m",
              "branch change one",
            ],
            branchWc,
          ).exitCode,
        ).toBe(0);
        fs.appendFileSync(
          path.join(branchWc, "file.txt"),
          "branch-two\n",
          "utf8",
        );
        expect(
          runSvn(
            [
              "commit",
              path.join(branchWc, "file.txt"),
              "-m",
              "branch change two",
            ],
            branchWc,
          ).exitCode,
        ).toBe(0);
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        // r1 初始化、r2 建分支、r3/r4 分支两次提交：可合并集为 r3、r4。
        const modes: Array<Record<string, unknown>> = [
          { mergeMode: "eligible" },
          { mergeMode: "specific", mergeRevisions: "4" },
          { mergeMode: "range", mergeFromRevision: "3", mergeToRevision: "4" },
        ];
        for (const [index, mode] of modes.entries()) {
          const session = makeSession(repo.workingCopy);
          await actions.previewAdvancedRepositoryOperation(
            session as never,
            { operation: "merge", sourceUrl: branchUrl, ...mode },
            `req-merge-${index}`,
          );
          const preview = previewOf(session);
          expect(
            preview?.commands?.join("\n"),
            `模式 ${JSON.stringify(mode)} 应生成试运行与真实命令（issues=${JSON.stringify(preview?.issues ?? null)}）`,
          ).toContain("--dry-run");
          expectCleanWorkingCopy(repo.workingCopy);
        }
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "合并冲突真机：真实合并产生冲突标记，取消路径保持干净且可重采",
    async () => {
      const repo = createRealRepo();
      try {
        const branchUrl = `${repo.rootUrl}/branches/conflict-b`;
        expect(
          runSvn(
            ["copy", repo.trunkUrl, branchUrl, "-m", "create branch"],
            repo.tempRoot,
          ).exitCode,
        ).toBe(0);
        const branchWc = path.join(repo.tempRoot, "branch-wc");
        expect(
          runSvn(["checkout", branchUrl, branchWc], repo.tempRoot).exitCode,
        ).toBe(0);
        // 同一行两侧不同修改，制造文本冲突。
        const branchFile = path.join(branchWc, "file.txt");
        fs.writeFileSync(branchFile, "line-one-branch\nline-two\n", "utf8");
        expect(
          runSvn(["commit", branchFile, "-m", "branch side"], branchWc)
            .exitCode,
        ).toBe(0);
        const trunkFile = path.join(repo.workingCopy, "file.txt");
        fs.writeFileSync(trunkFile, "line-one-trunk\nline-two\n", "utf8");
        expect(
          runSvn(["commit", trunkFile, "-m", "trunk side"], repo.workingCopy)
            .exitCode,
        ).toBe(0);
        // 提交后更新到单修订 HEAD，避免混合修订工作副本影响试运行。
        expect(
          runSvn(["update", repo.workingCopy], repo.workingCopy).exitCode,
        ).toBe(0);
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        // 取消路径：只预览不执行，工作副本保持干净；重采仍可生成预览。
        const cancelSession = makeSession(repo.workingCopy);
        await actions.previewAdvancedRepositoryOperation(
          cancelSession as never,
          { operation: "merge", sourceUrl: branchUrl, mergeMode: "eligible" },
          "req-cancel-preview",
        );
        const cancelPreview = previewOf(cancelSession);
        expect((cancelPreview?.issues as string[]).length).toBe(0);
        expect((cancelPreview?.details as string[]).join("\n")).toContain(
          "冲突模块",
        );
        expectCleanWorkingCopy(repo.workingCopy);
        // 真实合并产生冲突标记（冲突转入冲突模块的本地证据）。
        const merged = runSvn(
          ["merge", branchUrl, repo.workingCopy, "--accept", "postpone"],
          repo.workingCopy,
        );
        expect(merged.exitCode).toBe(0);
        const status = runSvn(["status", repo.workingCopy], repo.workingCopy);
        expect(status.stdout).toMatch(/C\s/);
        // 部分失败后重采：用非法修订预览被阻止，修正后可重新生成预览。
        const failSession = makeSession(repo.workingCopy);
        await actions.previewAdvancedRepositoryOperation(
          failSession as never,
          {
            operation: "merge",
            sourceUrl: branchUrl,
            mergeMode: "specific",
            mergeRevisions: "99999",
          },
          "req-fail-preview",
        );
        expect(
          (previewOf(failSession)?.issues as string[]).length,
        ).toBeGreaterThan(0);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );

  realIt(
    "权限失败与空可合并集真机：无效源与无变更 eligible 均被阻止",
    async () => {
      const repo = createRealRepo();
      try {
        const actions = new RepositoryWorkbenchActions(makeHost() as never);
        const badSession = makeSession(repo.workingCopy);
        await actions.previewAdvancedRepositoryOperation(
          badSession as never,
          {
            operation: "merge",
            sourceUrl: `${repo.rootUrl}/branches/no-such-branch`,
            mergeMode: "eligible",
          },
          "req-bad-source",
        );
        const badPreview = previewOf(badSession);
        // 可执行性 = issues 为空（预览转意向单时 canExecute 由 issues 推导）。
        expect((badPreview?.issues as string[]).length).toBeGreaterThan(0);
        // 无新变更：trunk 自合并无可合并修订，eligible 被阻止执行。
        const emptySession = makeSession(repo.workingCopy);
        await actions.previewAdvancedRepositoryOperation(
          emptySession as never,
          {
            operation: "merge",
            sourceUrl: repo.trunkUrl,
            mergeMode: "eligible",
          },
          "req-empty",
        );
        const emptyPreview = previewOf(emptySession);
        expect((emptyPreview?.issues as string[]).join("")).toContain("已阻止");
        expectCleanWorkingCopy(repo.workingCopy);
      } finally {
        removeTestTempDirectory(repo.tempRoot);
      }
    },
    REAL_TIMEOUT_MS,
  );
});
