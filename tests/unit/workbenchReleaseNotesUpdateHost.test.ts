import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  buildReleaseNotes,
  normalizeReleaseNotesRange,
} from "../../src/repository/advancedRepositoryTools";
import { RepositoryWorkbenchActions } from "../../src/extension/workbench/repositoryWorkbenchActions";
import { UpdateWorkbenchActions } from "../../src/extension/workbench/updateWorkbenchActions";
import {
  isReleaseNotesView,
  isUpdatePreviewView,
  isUpdateSnapshot,
} from "../../src/protocol/workbenchProtocol";
import type { SvnRevision } from "../../src/history/svnHistoryParser";

const root = path.resolve("/repo");

function scopeFor(relativePath = "a") {
  return {
    repositoryRoot: root,
    roots: [
      {
        absolutePath: path.join(root, relativePath),
        relativePath,
        kind: "folder",
      },
    ],
  };
}

function revision(
  revisionId: string,
  changedPaths: Array<{ action: string; path: string }>,
): SvnRevision {
  return {
    revision: revisionId,
    author: "alice",
    date: "2026-09-01",
    message: `提交 ${revisionId}`,
    changedPaths: changedPaths.map((item) => ({
      action: item.action,
      path: item.path,
    })),
  } as SvnRevision;
}

beforeEach(() => {
  runSvnCommand.mockReset();
});

describe("V021 终审 P3-1：R14 空范围诚实标注", () => {
  it("未填范围不拒绝，空采集如实标注无修订而非冒充完整区间", () => {
    const normalized = normalizeReleaseNotesRange(undefined, undefined);
    expect(normalized.issues).toEqual([]);
    expect(normalized.from).toBeUndefined();
    expect(normalized.to).toBeUndefined();
    const notes = buildReleaseNotes([], undefined, undefined, undefined, {
      revisionsRead: 0,
      complete: false,
      partialReason: "仅读取到最近 0 条（部分结果：可能还有更早修订）",
    });
    expect(notes.count).toBe(0);
    expect(notes.complete).toBe(false);
    expect(notes.markdown).toContain("部分结果");
    expect(notes.markdown).toContain("所选范围没有已采集修订");
    expect(isReleaseNotesView(notes)).toBe(true);
  });

  it("非法范围 Host 直接拒绝并保留旧结果", async () => {
    const sendError = vi.fn(async () => undefined);
    const post = vi.fn(async () => undefined);
    const host = {
      context: {},
      post,
      sendError,
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
    const actions = new RepositoryWorkbenchActions(host as never);
    const previous = {
      markdown: "旧发布说明",
      fullMarkdown: "旧发布说明完整版",
      count: 1,
      revisionsRead: 1,
      complete: true,
      omittedPathCount: 0,
      truncatedRevisions: [],
    };
    const session = {
      svnPath: "svn",
      scope: scopeFor(),
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
      repositoryState: { advanced: { releaseNotes: previous } },
    };
    await actions.generateReleaseNotes(session as never, "abc", undefined);
    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError.mock.calls[0][1]).toBe("修订范围无效");
    expect(
      (session.repositoryState.advanced as { releaseNotes: unknown })
        .releaseNotes,
    ).toBe(previous);
    expect(runSvnCommand).not.toHaveBeenCalled();
  });
});

describe("V021 终审 P3-1：R14 单修订超 20 路径截断与完整版导出", () => {
  it("摘要截断前 20 条并注明省略数，fullMarkdown 保留全部路径", () => {
    const changedPaths = Array.from({ length: 25 }, (_, index) => ({
      action: "M",
      path: `/trunk/src/file-${String(index + 1).padStart(2, "0")}.ts`,
    }));
    const notes = buildReleaseNotes(
      [revision("42", changedPaths)],
      "42",
      "42",
      "https://svn.example.test/repos/workbench",
    );
    expect(notes.count).toBe(1);
    expect(notes.omittedPathCount).toBe(5);
    expect(notes.truncatedRevisions).toEqual([{ revision: "42", omitted: 5 }]);
    expect(notes.markdown).toContain("另有 5 个路径未在摘要中显示");
    expect(notes.markdown).not.toContain("file-21.ts");
    for (const item of changedPaths) {
      expect(notes.fullMarkdown).toContain(item.path);
    }
    // 导出走完整版：exportReleaseNotes 取 fullMarkdown ?? markdown。
    const exported = notes.fullMarkdown ?? notes.markdown;
    expect(exported).toContain("file-25.ts");
    expect(isReleaseNotesView(notes)).toBe(true);
  });

  it("无可导出内容时 Host 明确报错而不写文件", async () => {
    const sendError = vi.fn(async () => undefined);
    const host = {
      context: {},
      post: vi.fn(async () => undefined),
      sendError,
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
    const actions = new RepositoryWorkbenchActions(host as never);
    const session = {
      svnPath: "svn",
      scope: scopeFor(),
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
      repositoryState: { advanced: {} },
    };
    await actions.exportReleaseNotes(session as never);
    expect(sendError).toHaveBeenCalledOnce();
    expect(sendError.mock.calls[0][1]).toBe("没有可导出的发布说明");
  });
});

describe("V021 终审 P3-1：R14 HEAD 解析失败与取消保留旧结果", () => {
  it("HEAD 无法解析时保留上次发布说明并说明原因", async () => {
    runSvnCommand.mockImplementation(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "网络不可达",
    }));
    const sendRepositorySnapshot = vi.fn(async () => undefined);
    const host = {
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
      sendRepositorySnapshot,
    };
    const actions = new RepositoryWorkbenchActions(host as never);
    const previous = {
      markdown: "旧发布说明",
      fullMarkdown: "旧发布说明完整版",
      count: 2,
      revisionsRead: 2,
      complete: true,
      omittedPathCount: 0,
      truncatedRevisions: [],
    };
    const session = {
      svnPath: "svn",
      scope: scopeFor(),
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
      repositoryState: {
        advanced: { releaseNotes: previous, feedback: undefined as unknown },
      },
    };
    await actions.generateReleaseNotes(session as never, "40", "HEAD");
    expect(
      (session.repositoryState.advanced as { releaseNotes: unknown })
        .releaseNotes,
    ).toBe(previous);
    expect(
      (session.repositoryState.advanced as { feedback: string }).feedback,
    ).toContain("已保留上次发布说明");
    expect(sendRepositorySnapshot).toHaveBeenCalledOnce();
  });
});

describe("V021 终审 P3-1：R15 远端读取失败 remoteIncomplete 快照分支", () => {
  it("远端检查失败时预览标 incomplete，不把空清单当作无变化", async () => {
    runSvnCommand.mockImplementation(async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "远端不可达",
    }));
    const posted: unknown[] = [];
    const host = {
      post: vi.fn(async (message: unknown) => {
        posted.push(message);
      }),
      sendError: vi.fn(async () => undefined),
      collectScopeCandidates: vi.fn(async () => [
        {
          absolutePath: path.join(root, "a", "local.ts"),
          relativePath: "a/local.ts",
          status: "modified",
          selection: "selected",
        },
      ]),
      appendActivityRecord: vi.fn(),
    };
    const actions = new UpdateWorkbenchActions(host as never);
    const session = {
      svnPath: "svn",
      scope: scopeFor(),
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
      updateState: undefined as unknown,
    };
    await actions.createUpdatePreview(session as never);
    const preview = (
      session as {
        updateState?: {
          preview?: Record<string, unknown>;
        };
      }
    ).updateState?.preview;
    expect(preview).toBeDefined();
    expect(preview?.remoteIncomplete).toBe(true);
    expect(preview?.remotePaths).toEqual([]);
    expect(preview?.remoteItems).toEqual([]);
    expect(preview?.error).toContain("远端不可达");
    expect(preview?.canExecute).toBe(false);
    const messages = (preview?.messages as string[]).join("\n");
    expect(messages).toContain("远端更新检查失败");
    expect(messages).not.toContain("无远端");
    expect(isUpdatePreviewView(preview)).toBe(true);
    const snapshotMessage = posted.find(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        (item as { type?: string }).type === "module/snapshot",
    ) as { payload?: { snapshot?: unknown } };
    expect(isUpdateSnapshot(snapshotMessage?.payload?.snapshot)).toBe(true);
  });
});
