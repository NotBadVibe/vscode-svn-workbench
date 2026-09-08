import { describe, expect, it } from "vitest";
import { WorkbenchController } from "../../src/extension/workbench/WorkbenchController";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";

/*
 * V023-R18 · 连续多文件审阅队列 Host 绑定（Controller 级）。
 * 领域纯函数见 tests/unit/reviewQueue.test.ts；此处覆盖 Host 侧三件事：
 * - establishDiffReviewForOpen：明确选择建队列 + 范围求交，多仓隔离，
 *   范围变化丢弃旧已看指纹，同仓同范围沿用；
 * - resolveDiffReviewForSnapshot：scope/仓库不一致丢弃，指纹变化清已看
 *   并播报，目标不在队列时回单文件模式但保留队列；
 * - markDiffFileReviewed：非队列/非当前/范围外拒绝，指纹过期拒绝并清
 *   旧指纹重发快照，一致才标记（只读进度，不产生写操作）。
 * 断言均用字符串字面量，不用宿主 path 构造期望（平台无关）。
 */

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

type ReviewHost = {
  establishDiffReviewForOpen(
    session: WorkbenchSession,
    previous: WorkbenchSession["diffReview"],
    requested: unknown,
  ): WorkbenchSession["diffReview"];
  resolveDiffReviewForSnapshot(
    session: WorkbenchSession,
    currentRelativePath: string,
    currentContentHash: string,
  ): { notice?: string; queue: Array<{ relativePath: string }> } | undefined;
  markDiffFileReviewed(
    session: WorkbenchSession,
    requestId: string | undefined,
    data: Record<string, unknown>,
  ): Promise<void>;
};

function makeSession(
  overrides: Record<string, unknown> = {},
): WorkbenchSession {
  return {
    moduleId: "diff",
    svnPath: "svn",
    scope: makeScope(),
    sessionId: "session-1",
    repositoryUuid: "repo-A",
    scopeHash: "scope-1",
    ...overrides,
  } as unknown as WorkbenchSession;
}

function createHost(): ReviewHost {
  const controller = new WorkbenchController(
    makeContext() as never,
    {
      onDidInvalidate: () => ({ dispose: () => undefined }),
      getEffectiveRules: async () => undefined,
    } as never,
  );
  return controller as unknown as ReviewHost;
}

describe("establishDiffReviewForOpen（V023-R18 Host 建队列）", () => {
  it("明确选择保序建队列，范围外与重复项丢弃", () => {
    const host = createHost();
    const session = makeSession();
    const state = host.establishDiffReviewForOpen(session, undefined, [
      "app/b.ts",
      "app/a.ts",
      "top-level.ts",
      "app/b.ts",
    ]);
    expect(state?.queue).toEqual(["app/b.ts", "app/a.ts"]);
    expect(state?.scopeHash).toBe("scope-1");
    expect(state?.repositoryUuid).toBe("repo-A");
    expect(state?.reviewedHashes).toEqual({});
  });

  it("非数组明确选择不建队列（单文件模式）", () => {
    const host = createHost();
    const session = makeSession();
    expect(host.establishDiffReviewForOpen(session, undefined, undefined)).toBe(
      undefined,
    );
    expect(host.establishDiffReviewForOpen(session, undefined, [])).toBe(
      undefined,
    );
  });

  it("多仓隔离：A 仓已看指纹不带入 B 仓", () => {
    const host = createHost();
    const session = makeSession({ repositoryUuid: "repo-B" });
    const previous: WorkbenchSession["diffReview"] = {
      queue: ["app/a.ts", "app/b.ts"],
      reviewedHashes: { "app/a.ts": "hash-a" },
      scopeHash: "scope-1",
      repositoryUuid: "repo-A",
    };
    const state = host.establishDiffReviewForOpen(session, previous, [
      "app/a.ts",
      "app/b.ts",
    ]);
    expect(state?.queue).toEqual(["app/a.ts", "app/b.ts"]);
    expect(state?.repositoryUuid).toBe("repo-B");
    expect(state?.reviewedHashes).toEqual({});
  });

  it("范围变化丢弃旧已看指纹，同仓同范围沿用 kept 项", () => {
    const host = createHost();
    const previous: WorkbenchSession["diffReview"] = {
      queue: ["app/a.ts", "app/b.ts"],
      reviewedHashes: { "app/a.ts": "hash-a", "app/b.ts": "hash-b" },
      scopeHash: "scope-1",
      repositoryUuid: "repo-A",
    };
    const changed = makeSession({ scopeHash: "scope-2" });
    const dropped = host.establishDiffReviewForOpen(changed, previous, [
      "app/a.ts",
      "app/b.ts",
    ]);
    expect(dropped?.reviewedHashes).toEqual({});

    const same = makeSession();
    const kept = host.establishDiffReviewForOpen(same, previous, [
      "app/a.ts",
      "app/b.ts",
    ]);
    expect(kept?.reviewedHashes).toEqual({
      "app/a.ts": "hash-a",
      "app/b.ts": "hash-b",
    });
  });
});

describe("resolveDiffReviewForSnapshot（V023-R18 Host 快照装配）", () => {
  it("scope 变化丢弃队列并隔离（返回 undefined）", () => {
    const host = createHost();
    const session = makeSession({
      scopeHash: "scope-2",
      diffReview: {
        queue: ["app/a.ts"],
        reviewedHashes: {},
        scopeHash: "scope-1",
        repositoryUuid: "repo-A",
      },
    });
    expect(host.resolveDiffReviewForSnapshot(session, "app/a.ts", "h")).toBe(
      undefined,
    );
    expect(session.diffReview).toBe(undefined);
  });

  it("跨仓库丢弃队列并隔离", () => {
    const host = createHost();
    const session = makeSession({
      repositoryUuid: "repo-B",
      diffReview: {
        queue: ["app/a.ts"],
        reviewedHashes: { "app/a.ts": "h" },
        scopeHash: "scope-1",
        repositoryUuid: "repo-A",
      },
    });
    expect(host.resolveDiffReviewForSnapshot(session, "app/a.ts", "h")).toBe(
      undefined,
    );
    expect(session.diffReview).toBe(undefined);
  });

  it("内容指纹变化清除已看并播报待审阅", () => {
    const host = createHost();
    const session = makeSession({
      diffReview: {
        queue: ["app/a.ts", "app/b.ts"],
        reviewedHashes: { "app/a.ts": "old-hash" },
        scopeHash: "scope-1",
        repositoryUuid: "repo-A",
      },
    });
    const view = host.resolveDiffReviewForSnapshot(
      session,
      "app/a.ts",
      "new-hash",
    );
    expect(view).toBeDefined();
    expect(session.diffReview?.reviewedHashes["app/a.ts"]).toBe(undefined);
    expect(view?.notice ?? "").toContain("已重新标记为待审阅");
  });

  it("目标不在队列时回单文件模式但保留队列进度", () => {
    const host = createHost();
    const session = makeSession({
      diffReview: {
        queue: ["app/a.ts", "app/b.ts"],
        reviewedHashes: { "app/a.ts": "hash-a" },
        scopeHash: "scope-1",
        repositoryUuid: "repo-A",
      },
    });
    expect(host.resolveDiffReviewForSnapshot(session, "app/z.ts", "h")).toBe(
      undefined,
    );
    expect(session.diffReview?.queue).toEqual(["app/a.ts", "app/b.ts"]);
    expect(session.diffReview?.reviewedHashes).toEqual({
      "app/a.ts": "hash-a",
    });
  });
});

describe("markDiffFileReviewed（V023-R18 Host 标已看）", () => {
  function createMarkHost(authoritative: string | undefined) {
    const controller = new WorkbenchController(
      makeContext() as never,
      {
        onDidInvalidate: () => ({ dispose: () => undefined }),
        getEffectiveRules: async () => undefined,
      } as never,
    );
    const errors: Array<{ title: string; message: string }> = [];
    let loads = 0;
    Object.assign(controller, {
      sendError: async (
        _moduleId: string,
        title: string,
        message: string,
      ): Promise<void> => {
        errors.push({ title, message });
      },
      loadModule: async (): Promise<void> => {
        loads += 1;
      },
      computeDiffReviewHash: async (): Promise<string | undefined> =>
        authoritative,
    });
    return {
      host: controller as unknown as ReviewHost,
      errors,
      loads: () => loads,
    };
  }

  function markSession(): WorkbenchSession {
    return makeSession({
      targetFile: `${WC_ROOT}/app/a.ts`,
      diffReview: {
        queue: ["app/a.ts", "app/b.ts"],
        reviewedHashes: {},
        scopeHash: "scope-1",
        repositoryUuid: "repo-A",
      },
    });
  }

  it("非队列文件拒绝且不重发快照", async () => {
    const { host, errors, loads } = createMarkHost("hash-a");
    const session = markSession();
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "app/z.ts",
      contentHash: "hash-z",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("无法标记已看");
    expect(loads()).toBe(0);
    expect(session.diffReview?.reviewedHashes).toEqual({});
  });

  it("非当前文件拒绝（只能标记正在审阅的文件）", async () => {
    const { host, errors, loads } = createMarkHost("hash-b");
    const session = markSession();
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "app/b.ts",
      contentHash: "hash-b",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("只能标记当前正在审阅的文件");
    expect(loads()).toBe(0);
  });

  it("范围外目标拒绝", async () => {
    const { host, errors, loads } = createMarkHost("hash-top");
    const session = markSession();
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "top-level.ts",
      contentHash: "hash-top",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("范围校验失败");
    expect(loads()).toBe(0);
  });

  it("指纹过期拒绝、清除旧指纹并重发快照", async () => {
    const { host, errors, loads } = createMarkHost("hash-new");
    const session = markSession();
    session.diffReview = {
      queue: ["app/a.ts", "app/b.ts"],
      reviewedHashes: { "app/a.ts": "hash-old" },
      scopeHash: "scope-1",
      repositoryUuid: "repo-A",
    };
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "app/a.ts",
      contentHash: "hash-old",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("标记已过期");
    expect(session.diffReview?.reviewedHashes["app/a.ts"]).toBe(undefined);
    expect(loads()).toBe(1);
  });

  it("指纹一致标记成功并重发快照（只读进度）", async () => {
    const { host, errors, loads } = createMarkHost("hash-a");
    const session = markSession();
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "app/a.ts",
      contentHash: "hash-a",
    });
    expect(errors).toHaveLength(0);
    expect(session.diffReview?.reviewedHashes["app/a.ts"]).toBe("hash-a");
    expect(loads()).toBe(1);
  });

  it("非 diff 会话拒绝标已看", async () => {
    const { host, errors, loads } = createMarkHost("hash-a");
    const session = makeSession({ moduleId: "changes" });
    await host.markDiffFileReviewed(session, undefined, {
      relativePath: "app/a.ts",
      contentHash: "hash-a",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].title).toBe("无法标记已看");
    expect(loads()).toBe(0);
  });
});
