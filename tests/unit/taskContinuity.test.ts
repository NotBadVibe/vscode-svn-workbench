import { describe, expect, it } from "vitest";
import type { PathIdentityKey } from "../../src/scope/pathBrands";
import type { PathSemantics } from "../../src/scope/pathIdentity";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import {
  checkDirtyDraftGuard,
  createContinuityContext,
  invalidateContinuity,
  isStaleSnapshot,
  reduceOnNavigate,
  resolveActiveFileFallback,
  resolveScrollAnchor,
  restoreAgainstSnapshot,
  type ContinuitySnapshotEntry,
} from "../../src/extension/workbench/taskContinuity";

const semantics: PathSemantics = { platform: "linux", cwd: "/repo" };
const asKey = (value: string): PathIdentityKey => value as PathIdentityKey;

function makeSession(
  overrides: Partial<WorkbenchSession> = {},
): WorkbenchSession {
  return {
    moduleId: "changes",
    taskId: "changes/overview",
    svnPath: "svn",
    sessionId: "session-1",
    scopeView: {} as WorkbenchSession["scopeView"],
    repositoryUuid: "uuid-1",
    scopeHash: "scope-hash-1",
    aiModels: {},
    security: { hasStoredAuthentication: false },
    scope: {
      id: "scope-1",
      repositoryRoot: "/repo",
      source: "explorerFolder",
      roots: [
        { absolutePath: "/repo/src", relativePath: "src", kind: "folder" },
      ],
      allowExpandScope: false,
      includeExternals: false,
      includeNestedWorkingCopies: false,
      createdAt: 0,
    },
    ...overrides,
  } as WorkbenchSession;
}

function makeEntry(
  path: string,
  overrides: Partial<ContinuitySnapshotEntry> = {},
): ContinuitySnapshotEntry {
  return {
    key: asKey(path),
    path,
    repositoryUuid: "uuid-1",
    ...overrides,
  };
}

describe("连续任务上下文纯模型（V014-A）", () => {
  it("创建：从会话派生来源、选择、活动文件、草稿与初始版本", () => {
    const session = makeSession({
      selectedPaths: ["/repo/src/a.ts", "/repo/src/b.ts"],
      targetFile: "/repo/src/a.ts",
      commitState: { message: "草稿说明" } as WorkbenchSession["commitState"],
    });
    const context = createContinuityContext(session, {
      resolveKey: asKey,
      changesView: {
        filter: "modified",
        density: "compact",
        onlySelected: true,
      },
      draftRevision: 3,
    });
    expect(context.originModule).toBe("changes");
    expect(context.originTask).toBe("changes/overview");
    expect(context.originScopeHash).toBe("scope-hash-1");
    expect(context.originSessionId).toBe("session-1");
    expect(context.selectedKeys).toEqual([
      asKey("/repo/src/a.ts"),
      asKey("/repo/src/b.ts"),
    ]);
    expect(context.pathByKey[asKey("/repo/src/a.ts")]).toBe("/repo/src/a.ts");
    expect(context.activeFileKey).toBe(asKey("/repo/src/a.ts"));
    expect(context.scrollAnchorKey).toBe(asKey("/repo/src/a.ts"));
    expect(context.changesView.onlySelected).toBe(true);
    expect(context.commitDraft).toEqual({
      message: "草稿说明",
      draftRevision: 3,
    });
    expect(context.diffTarget?.returnAction).toBe("back-to-changes");
    expect(context.contextVersion).toBe(1);
    expect(context.invalidatedReason).toBeUndefined();
  });

  it("迁移：同范围保持成功，子目录收缩成功并标记 shrunk", () => {
    const context = createContinuityContext(
      makeSession({ selectedPaths: ["/repo/src/a.ts"] }),
      { resolveKey: asKey },
    );
    const kept = reduceOnNavigate(
      context,
      {
        moduleId: "diff",
        taskId: "diff/working",
        scopeHash: "scope-hash-1",
        repositoryRoot: "/repo",
        repositoryUuid: "uuid-1",
        roots: ["/repo/src"],
      },
      semantics,
    );
    expect(kept.ok).toBe(true);
    if (kept.ok) {
      expect(kept.shrunk).toBe(false);
      expect(kept.context.originModule).toBe("diff");
      expect(kept.context.contextVersion).toBe(2);
      expect(kept.context.selectedKeys).toEqual(context.selectedKeys);
    }
    const shrunk = reduceOnNavigate(
      context,
      {
        moduleId: "commit",
        taskId: "commit/compose",
        scopeHash: "scope-hash-2",
        repositoryRoot: "/repo",
        repositoryUuid: "uuid-1",
        roots: ["/repo/src/sub"],
      },
      semantics,
    );
    expect(shrunk.ok).toBe(true);
    if (shrunk.ok) {
      expect(shrunk.shrunk).toBe(true);
      expect(shrunk.context.originScopeHash).toBe("scope-hash-2");
    }
  });

  it("迁移：范围扩大被拒绝，跨仓库被拒绝", () => {
    const context = createContinuityContext(makeSession(), {
      resolveKey: asKey,
    });
    const expanded = reduceOnNavigate(
      context,
      {
        moduleId: "commit",
        taskId: "commit/compose",
        scopeHash: "scope-hash-x",
        repositoryRoot: "/repo",
        repositoryUuid: "uuid-1",
        roots: ["/repo"],
      },
      semantics,
    );
    expect(expanded.ok).toBe(false);
    if (!expanded.ok) {
      expect(expanded.code).toBe("scope-expand-rejected");
      expect(expanded.reason).toContain("不允许扩大");
    }
    const crossRepo = reduceOnNavigate(
      context,
      {
        moduleId: "commit",
        taskId: "commit/compose",
        scopeHash: "scope-hash-x",
        repositoryRoot: "/other",
        repositoryUuid: "uuid-2",
        roots: ["/repo/src"],
      },
      semantics,
    );
    expect(crossRepo.ok).toBe(false);
    if (!crossRepo.ok) expect(crossRepo.code).toBe("cross-repository");
  });

  it("恢复：合法交集保留，逐项给出移除原因", () => {
    const context = createContinuityContext(
      makeSession({
        selectedPaths: [
          "/repo/src/a.ts",
          "/repo/src/b.ts",
          "/repo/src/c.ts",
          "/repo/src/d.ts",
        ],
      }),
      { resolveKey: asKey },
    );
    const result = restoreAgainstSnapshot(context, {
      sessionId: "session-1",
      entries: [
        makeEntry("/repo/src/a.ts"),
        makeEntry("/repo/src/b.ts", { blocked: true }),
        makeEntry("/repo/src/c.ts", { repositoryUuid: "uuid-2" }),
      ],
    });
    expect(result.stale).toBe(false);
    expect(result.keptKeys).toEqual([asKey("/repo/src/a.ts")]);
    expect(result.removedEntries.map((entry) => entry.reason)).toEqual([
      "blocked",
      "cross-repository",
      "disappeared",
    ]);
    for (const entry of result.removedEntries) {
      expect(entry.message.length).toBeGreaterThan(0);
      expect(entry.path.length).toBeGreaterThan(0);
    }
  });

  it("恢复：external 默认剔除，新出现文件绝不自动加入", () => {
    const context = createContinuityContext(
      makeSession({ selectedPaths: ["/repo/src/a.ts", "/repo/src/ext.ts"] }),
      { resolveKey: asKey },
    );
    const result = restoreAgainstSnapshot(context, {
      sessionId: "session-1",
      entries: [
        makeEntry("/repo/src/a.ts"),
        makeEntry("/repo/src/ext.ts", { external: true }),
        makeEntry("/repo/src/new.ts"),
      ],
    });
    expect(result.keptKeys).toEqual([asKey("/repo/src/a.ts")]);
    expect(result.keptKeys).not.toContain(asKey("/repo/src/new.ts"));
    expect(result.removedEntries.map((entry) => entry.reason)).toContain(
      "external",
    );
  });

  it("回退：活动文件合法时不变，消失时取最近合法邻项并标注变化", () => {
    const ordered = [
      asKey("/repo/src/a.ts"),
      asKey("/repo/src/b.ts"),
      asKey("/repo/src/c.ts"),
    ];
    const legal = new Set([asKey("/repo/src/a.ts"), asKey("/repo/src/c.ts")]);
    const kept = resolveActiveFileFallback(
      asKey("/repo/src/a.ts"),
      ordered,
      (key) => legal.has(key),
    );
    expect(kept).toEqual({
      fallbackKey: asKey("/repo/src/a.ts"),
      changed: false,
    });
    const fallback = resolveActiveFileFallback(
      asKey("/repo/src/b.ts"),
      ordered,
      (key) => legal.has(key),
    );
    expect(fallback.changed).toBe(true);
    expect(fallback.notice).toContain("原文件状态已变化");
    expect(fallback.fallbackKey).toBe(asKey("/repo/src/c.ts"));
    const none = resolveActiveFileFallback(
      asKey("/repo/src/b.ts"),
      ordered,
      () => false,
    );
    expect(none.fallbackKey).toBeUndefined();
    expect(none.notice).toContain("原文件状态已变化");
  });

  it("失效：各事件递增版本并记录原因，强失效清空选择与锚点", () => {
    const context = createContinuityContext(
      makeSession({
        selectedPaths: ["/repo/src/a.ts"],
        targetFile: "/repo/src/a.ts",
      }),
      { resolveKey: asKey },
    );
    const weak = invalidateContinuity(context, "filter-change");
    expect(weak.contextVersion).toBe(2);
    expect(weak.invalidatedReason).toContain("筛选");
    expect(weak.selectedKeys).toEqual(context.selectedKeys);
    const strong = invalidateContinuity(context, "project-switch");
    expect(strong.contextVersion).toBe(2);
    expect(strong.invalidatedReason).toContain("切换项目");
    expect(strong.selectedKeys).toEqual([]);
    expect(strong.activeFileKey).toBeUndefined();
    expect(strong.scrollAnchorKey).toBeUndefined();
    expect(invalidateContinuity(context, "window-close").selectedKeys).toEqual(
      [],
    );
    expect(
      invalidateContinuity(context, "snapshot-expired").selectedKeys,
    ).toEqual([]);
    expect(
      invalidateContinuity(context, "selection-change").invalidatedReason,
    ).toContain("选择");
  });

  it("过期：旧 sessionId 的延迟快照判定 stale 并被恢复忽略", () => {
    expect(isStaleSnapshot("session-1", "session-1")).toBe(false);
    expect(isStaleSnapshot("session-0", "session-1")).toBe(true);
    const context = createContinuityContext(
      makeSession({ selectedPaths: ["/repo/src/a.ts"] }),
      { resolveKey: asKey },
    );
    const result = restoreAgainstSnapshot(context, {
      sessionId: "session-0",
      entries: [makeEntry("/repo/src/a.ts")],
    });
    expect(result.stale).toBe(true);
    expect(result.keptKeys).toEqual([]);
    expect(result.removedEntries).toEqual([]);
  });

  it("滚动锚：锚点命中直接定位，失效时像素仅辅助钳制", () => {
    const ordered = [
      asKey("/repo/src/a.ts"),
      asKey("/repo/src/b.ts"),
      asKey("/repo/src/c.ts"),
    ];
    const hit = resolveScrollAnchor(asKey("/repo/src/b.ts"), ordered, 999);
    expect(hit).toEqual({
      targetKey: asKey("/repo/src/b.ts"),
      targetIndex: 1,
      usedPixelFallback: false,
    });
    const assisted = resolveScrollAnchor(
      asKey("/repo/src/missing.ts"),
      ordered,
      99,
    );
    expect(assisted.targetIndex).toBe(2);
    expect(assisted.usedPixelFallback).toBe(true);
    const fallback = resolveScrollAnchor(undefined, ordered);
    expect(fallback.targetIndex).toBe(0);
    expect(fallback.usedPixelFallback).toBe(false);
    expect(resolveScrollAnchor(asKey("/repo/src/a.ts"), []).targetIndex).toBe(
      -1,
    );
  });

  it("脏草稿守卫：同模块加载新目标且草稿未提交时要求确认", () => {
    expect(
      checkDirtyDraftGuard({
        sameModule: true,
        loadingNewTarget: true,
        draftMessage: "未提交的说明",
        draftRevision: 2,
        committedRevision: 1,
      }),
    ).toBe("require-confirm");
    expect(
      checkDirtyDraftGuard({
        sameModule: true,
        loadingNewTarget: true,
        draftMessage: "   ",
        draftRevision: 2,
      }),
    ).toBe("allow");
    expect(
      checkDirtyDraftGuard({
        sameModule: true,
        loadingNewTarget: true,
        draftMessage: "已提交",
        draftRevision: 2,
        committedRevision: 2,
      }),
    ).toBe("allow");
    expect(
      checkDirtyDraftGuard({
        sameModule: false,
        loadingNewTarget: true,
        draftMessage: "未提交",
        draftRevision: 2,
      }),
    ).toBe("allow");
    expect(
      checkDirtyDraftGuard({
        sameModule: true,
        loadingNewTarget: false,
        draftMessage: "未提交",
        draftRevision: 2,
      }),
    ).toBe("allow");
  });
});
