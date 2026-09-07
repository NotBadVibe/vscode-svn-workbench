import { describe, expect, it } from "vitest";
import {
  isReleaseNotesView,
  isRepositorySnapshot,
  isUpdatePreviewView,
  isUpdateSnapshot,
} from "../../src/protocol/workbenchProtocol";

function validReleaseNotes(overrides: Record<string, unknown> = {}) {
  return {
    markdown: "# SVN 发布说明",
    fullMarkdown: "# SVN 发布说明（完整）",
    count: 3,
    fromRevision: "40",
    toRevision: "42",
    revisionsRead: 3,
    complete: true,
    omittedPathCount: 0,
    truncatedRevisions: [],
    resolvedHeadRevision: "42",
    requestedFrom: "40",
    requestedTo: "HEAD",
    ...overrides,
  };
}

function validUpdatePreview(overrides: Record<string, unknown> = {}) {
  return {
    token: "preview-token",
    canExecute: true,
    localCount: 4,
    remoteCount: 2,
    checkedRevision: "42",
    risk: "medium",
    overlapPaths: ["src/extension.ts"],
    remotePaths: ["src/extension.ts", "src/remote-only.ts"],
    remoteItems: [
      { relativePath: "src/extension.ts", repositoryStatus: "modified" },
      { relativePath: "src/remote-only.ts", repositoryStatus: "added" },
    ],
    remoteByStatus: { modified: 1, added: 1 },
    remoteIncomplete: false,
    previewedAt: "2026-09-07T00:00:00.000Z",
    messages: ["远端与本地存在 1 个同路径重叠，请确认后再更新。"],
    commands: ['svn update --accept postpone "."'],
    ...overrides,
  };
}

describe("V021 终审 P2-1：isReleaseNotesView（R14 范围采集完整性）", () => {
  it("合法接受：最小形状与全字段携带", () => {
    expect(isReleaseNotesView({ markdown: "x", count: 0 })).toBe(true);
    expect(isReleaseNotesView(validReleaseNotes())).toBe(true);
    expect(
      isReleaseNotesView(
        validReleaseNotes({
          complete: false,
          partialReason: "分页失败",
          cancelled: true,
          failedUpperBound: "r100",
          rangeNote: "反向范围已归一化",
        }),
      ),
    ).toBe(true);
  });

  it("畸形拒绝：markdown/count 缺失或类型错误", () => {
    expect(isReleaseNotesView(null)).toBe(false);
    expect(isReleaseNotesView([])).toBe(false);
    expect(isReleaseNotesView({ count: 3 })).toBe(false);
    expect(isReleaseNotesView({ markdown: "# x" })).toBe(false);
    expect(isReleaseNotesView({ markdown: 42, count: 3 })).toBe(false);
    expect(isReleaseNotesView({ markdown: "x", count: "3" })).toBe(false);
  });

  it("畸形拒绝：完整性字段携带严检", () => {
    expect(
      isReleaseNotesView(validReleaseNotes({ omittedPathCount: "很多" })),
    ).toBe(false);
    expect(isReleaseNotesView(validReleaseNotes({ revisionsRead: "3" }))).toBe(
      false,
    );
    expect(isReleaseNotesView(validReleaseNotes({ complete: "yes" }))).toBe(
      false,
    );
    expect(
      isReleaseNotesView(
        validReleaseNotes({ truncatedRevisions: [{ revision: "42" }] }),
      ),
    ).toBe(false);
    expect(
      isReleaseNotesView(
        validReleaseNotes({
          truncatedRevisions: [{ revision: "42", omitted: "5" }],
        }),
      ),
    ).toBe(false);
    expect(isReleaseNotesView(validReleaseNotes({ fullMarkdown: 42 }))).toBe(
      false,
    );
  });
});

describe("V021 终审 P2-1：isUpdatePreviewView（R15 远端明细）", () => {
  it("合法接受：最小形状与远端全清单携带", () => {
    expect(
      isUpdatePreviewView({
        token: "t",
        canExecute: true,
        localCount: 0,
        risk: "low",
        overlapPaths: [],
      }),
    ).toBe(true);
    expect(isUpdatePreviewView(validUpdatePreview())).toBe(true);
    expect(
      isUpdatePreviewView(
        validUpdatePreview({
          remoteIncomplete: true,
          remotePaths: [],
          remoteItems: [],
          error: "读取远端失败",
        }),
      ),
    ).toBe(true);
  });

  it("畸形拒绝：remotePaths=42 等远端明细类型错误", () => {
    expect(isUpdatePreviewView(null)).toBe(false);
    expect(isUpdatePreviewView(validUpdatePreview({ remotePaths: 42 }))).toBe(
      false,
    );
    expect(
      isUpdatePreviewView(validUpdatePreview({ remotePaths: "a.ts" })),
    ).toBe(false);
    expect(
      isUpdatePreviewView(
        validUpdatePreview({
          remoteItems: [{ relativePath: "a.ts" }],
        }),
      ),
    ).toBe(false);
    expect(
      isUpdatePreviewView(
        validUpdatePreview({ remoteByStatus: { modified: "1" } }),
      ),
    ).toBe(false);
    expect(
      isUpdatePreviewView(validUpdatePreview({ remoteIncomplete: "yes" })),
    ).toBe(false);
    expect(isUpdatePreviewView(validUpdatePreview({ risk: "unknown" }))).toBe(
      false,
    );
    expect(isUpdatePreviewView(validUpdatePreview({ token: "" }))).toBe(false);
  });
});

describe("V021 终审 P2-1：快照联动（缺省兼容、携带严检、fail-closed）", () => {
  function repositoryBase(advanced: unknown) {
    return {
      kind: "repository",
      info: { name: "repo" },
      properties: { available: false, target: ".", items: [] },
      cleanup: { available: false, target: "." },
      advanced,
    };
  }

  function updateBase(preview: unknown) {
    return {
      kind: "update",
      info: { name: "repo" },
      preview,
      conflicts: { count: 0, paths: [] },
    };
  }

  it("缺省兼容：无 releaseNotes/preview 的旧快照继续接受", () => {
    expect(isRepositorySnapshot(repositoryBase({}))).toBe(true);
    expect(isRepositorySnapshot(repositoryBase({ feedback: "ok" }))).toBe(true);
    const withoutPreview: Record<string, unknown> = updateBase(undefined);
    delete withoutPreview.preview;
    expect(isUpdateSnapshot(withoutPreview)).toBe(true);
  });

  it("携带合法时接受，畸形时整快照拒绝", () => {
    expect(
      isRepositorySnapshot(
        repositoryBase({ releaseNotes: validReleaseNotes() }),
      ),
    ).toBe(true);
    expect(
      isRepositorySnapshot(
        repositoryBase({
          releaseNotes: validReleaseNotes({ omittedPathCount: "很多" }),
        }),
      ),
    ).toBe(false);
    expect(isUpdateSnapshot(updateBase(validUpdatePreview()))).toBe(true);
    expect(
      isUpdateSnapshot(updateBase(validUpdatePreview({ remotePaths: 42 }))),
    ).toBe(false);
  });
});
