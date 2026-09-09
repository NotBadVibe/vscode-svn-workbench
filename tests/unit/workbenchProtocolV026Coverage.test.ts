import { describe, expect, it } from "vitest";
import {
  createRequestId,
  isRepositoryAdvancedPreviewBinding,
  isRepositoryBrowserView,
  isRepositoryMergePreviewView,
  isRepositoryRemoteCompareView,
  isRepositoryRemoteFileView,
  isRepositoryRemoteHistoryView,
  isRepositorySnapshot,
  isUpdateSnapshot,
  readRepositoryUrlIntent,
} from "../../src/protocol/workbenchProtocol";

/*
 * V026-R43/R44/R45/R46 协议守卫分支覆盖补齐（只加测试，不改 src）。
 * 每个新守卫按“合法接受 / 非法拒绝 / 缺省兼容”逐分支覆盖，
 * 目标 src/protocol/workbenchProtocol.ts branches ≥ 90%。
 */

function repositoryBase(advanced: unknown): Record<string, unknown> {
  return {
    kind: "repository",
    info: { name: "repo" },
    properties: { available: false, target: ".", items: [] },
    cleanup: { available: false, target: "." },
    advanced,
  };
}

function validShelfEntry(): Record<string, unknown> {
  return {
    id: "shelf-1",
    displayName: "暂存 1",
    createdAt: "2026-09-08T00:00:00.000Z",
    fileCount: 1,
    files: ["src/a.ts"],
    repositoryUuid: "repo-uuid",
    patchFileName: "shelf-1.patch",
    integrity: "ok",
  };
}

describe("V026-R43/R46 isRepositoryBrowserView 逐分支", () => {
  it("缺省兼容：最小形状接受", () => {
    expect(
      isRepositoryBrowserView({
        url: "https://svn.example/r/trunk",
        entries: [],
      }),
    ).toBe(true);
  });

  it("合法接受：全字段携带", () => {
    expect(
      isRepositoryBrowserView({
        url: "https://svn.example/r/trunk",
        parentUrl: "https://svn.example/r",
        entries: [
          {
            name: "a.ts",
            kind: "file",
            size: 12,
            revision: "42",
            author: "dev",
            date: "2026-09-08T00:00:00.000Z",
          },
          { name: "sub", kind: "dir" },
        ],
        error: "部分失败",
        revision: "42",
        repositoryRoot: "https://svn.example/r",
        projectUrl: "https://svn.example/r/trunk",
        lastGoodUrl: "https://svn.example/r/trunk",
      }),
    ).toBe(true);
  });

  it("非法拒绝：顶层形状与 url/entries", () => {
    expect(isRepositoryBrowserView(null)).toBe(false);
    expect(isRepositoryBrowserView([])).toBe(false);
    expect(isRepositoryBrowserView({})).toBe(false);
    expect(isRepositoryBrowserView({ url: 42, entries: [] })).toBe(false);
    expect(isRepositoryBrowserView({ url: "u", entries: "x" })).toBe(false);
    expect(
      isRepositoryBrowserView({ url: "u", entries: [], parentUrl: 42 }),
    ).toBe(false);
  });

  it("非法拒绝：entries 逐项严检", () => {
    const base = { url: "u", entries: [] as unknown[] };
    expect(isRepositoryBrowserView({ ...base, entries: [null] })).toBe(false);
    expect(isRepositoryBrowserView({ ...base, entries: [42] })).toBe(false);
    expect(
      isRepositoryBrowserView({ ...base, entries: [{ kind: "file" }] }),
    ).toBe(false);
    expect(
      isRepositoryBrowserView({
        ...base,
        entries: [{ name: "a", kind: "link" }],
      }),
    ).toBe(false);
    expect(
      isRepositoryBrowserView({
        ...base,
        entries: [{ name: "a", kind: "file", size: "12" }],
      }),
    ).toBe(false);
    expect(
      isRepositoryBrowserView({
        ...base,
        entries: [{ name: "a", kind: "file", revision: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryBrowserView({
        ...base,
        entries: [{ name: "a", kind: "file", author: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryBrowserView({
        ...base,
        entries: [{ name: "a", kind: "file", date: 42 }],
      }),
    ).toBe(false);
  });

  it("非法拒绝：顶层可选字段逐项", () => {
    const base = { url: "u", entries: [] };
    expect(isRepositoryBrowserView({ ...base, error: 42 })).toBe(false);
    expect(isRepositoryBrowserView({ ...base, revision: 42 })).toBe(false);
    expect(isRepositoryBrowserView({ ...base, repositoryRoot: 42 })).toBe(
      false,
    );
    expect(isRepositoryBrowserView({ ...base, projectUrl: 42 })).toBe(false);
    expect(isRepositoryBrowserView({ ...base, lastGoodUrl: 42 })).toBe(false);
  });
});

describe("V026-R46 isRepositoryRemoteFileView 逐分支", () => {
  it("缺省兼容与合法接受", () => {
    expect(
      isRepositoryRemoteFileView({ url: "u", sourceLabel: "远端文件" }),
    ).toBe(true);
    expect(
      isRepositoryRemoteFileView({
        url: "https://svn.example/r/trunk/a.ts",
        sourceLabel: "远端文件",
        revision: "42",
        requestedRevision: "HEAD",
        binary: false,
        truncated: false,
        size: 10,
        contentPreview: "content",
        error: "失败原因",
      }),
    ).toBe(true);
  });

  it("非法拒绝：必填与可选逐项", () => {
    expect(isRepositoryRemoteFileView(null)).toBe(false);
    expect(isRepositoryRemoteFileView({})).toBe(false);
    expect(isRepositoryRemoteFileView({ url: "u" })).toBe(false);
    expect(isRepositoryRemoteFileView({ sourceLabel: "x" })).toBe(false);
    const base = { url: "u", sourceLabel: "x" };
    expect(isRepositoryRemoteFileView({ ...base, revision: 42 })).toBe(false);
    expect(isRepositoryRemoteFileView({ ...base, requestedRevision: 42 })).toBe(
      false,
    );
    expect(isRepositoryRemoteFileView({ ...base, binary: "yes" })).toBe(false);
    expect(isRepositoryRemoteFileView({ ...base, truncated: 1 })).toBe(false);
    expect(isRepositoryRemoteFileView({ ...base, size: "10" })).toBe(false);
    expect(isRepositoryRemoteFileView({ ...base, contentPreview: 42 })).toBe(
      false,
    );
    expect(isRepositoryRemoteFileView({ ...base, error: 42 })).toBe(false);
  });
});

describe("V026-R46 isRepositoryRemoteHistoryView 逐分支", () => {
  it("缺省兼容与合法接受", () => {
    expect(isRepositoryRemoteHistoryView({ url: "u", revisions: [] })).toBe(
      true,
    );
    expect(
      isRepositoryRemoteHistoryView({
        url: "u",
        revisions: [
          {
            revision: "42",
            author: "dev",
            date: "2026-09-08T00:00:00.000Z",
            message: "提交说明",
          },
        ],
        error: "失败原因",
      }),
    ).toBe(true);
  });

  it("非法拒绝：revisions 逐项严检", () => {
    expect(isRepositoryRemoteHistoryView(null)).toBe(false);
    expect(isRepositoryRemoteHistoryView({ revisions: [] })).toBe(false);
    expect(isRepositoryRemoteHistoryView({ url: "u" })).toBe(false);
    expect(isRepositoryRemoteHistoryView({ url: "u", revisions: "x" })).toBe(
      false,
    );
    const base = { url: "u", revisions: [] as unknown[] };
    expect(isRepositoryRemoteHistoryView({ ...base, revisions: [null] })).toBe(
      false,
    );
    expect(isRepositoryRemoteHistoryView({ ...base, revisions: [{}] })).toBe(
      false,
    );
    expect(
      isRepositoryRemoteHistoryView({
        ...base,
        revisions: [{ revision: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteHistoryView({
        ...base,
        revisions: [{ revision: "42", author: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteHistoryView({
        ...base,
        revisions: [{ revision: "42", date: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteHistoryView({
        ...base,
        revisions: [{ revision: "42", message: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteHistoryView({
        url: "u",
        revisions: [],
        error: 42,
      }),
    ).toBe(false);
  });
});

describe("V026-R46 isRepositoryRemoteCompareView 逐分支", () => {
  it("缺省兼容与合法接受", () => {
    expect(
      isRepositoryRemoteCompareView({
        url: "u",
        fromRevision: "41",
        toRevision: "42",
      }),
    ).toBe(true);
    expect(
      isRepositoryRemoteCompareView({
        url: "u",
        fromRevision: "41",
        toRevision: "42",
        diffPreview: "diff",
        truncated: true,
        error: "失败原因",
      }),
    ).toBe(true);
  });

  it("非法拒绝：必填与可选逐项", () => {
    expect(isRepositoryRemoteCompareView(null)).toBe(false);
    expect(
      isRepositoryRemoteCompareView({ fromRevision: "41", toRevision: "42" }),
    ).toBe(false);
    expect(isRepositoryRemoteCompareView({ url: "u", toRevision: "42" })).toBe(
      false,
    );
    expect(
      isRepositoryRemoteCompareView({ url: "u", fromRevision: "41" }),
    ).toBe(false);
    const base = { url: "u", fromRevision: "41", toRevision: "42" };
    expect(isRepositoryRemoteCompareView({ ...base, diffPreview: 42 })).toBe(
      false,
    );
    expect(isRepositoryRemoteCompareView({ ...base, truncated: "yes" })).toBe(
      false,
    );
    expect(isRepositoryRemoteCompareView({ ...base, error: 42 })).toBe(false);
  });
});

describe("V026-R43/R44 isRepositoryAdvancedPreviewBinding 逐分支", () => {
  it("缺省兼容与合法接受（含 merge 嵌套）", () => {
    expect(isRepositoryAdvancedPreviewBinding({})).toBe(true);
    expect(
      isRepositoryAdvancedPreviewBinding({
        sourceUrl: "https://svn.example/r/trunk",
        targetUrl: "https://svn.example/r/tags/v1",
        sourceOrigin: "browse",
        targetOrigin: "manual",
        sourceRevision: "HEAD",
        sourceResolvedRevision: "42",
        sourceRevisionMode: "HEAD",
      }),
    ).toBe(true);
    expect(
      isRepositoryAdvancedPreviewBinding({
        merge: {
          mode: "eligible",
          eligibleCount: 0,
          mergedCount: 0,
          mergeinfoSupported: false,
        },
      }),
    ).toBe(true);
  });

  it("非法拒绝：七个可选字符串逐项", () => {
    expect(isRepositoryAdvancedPreviewBinding(null)).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding([])).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding({ sourceUrl: 42 })).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding({ targetUrl: 42 })).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding({ sourceOrigin: 42 })).toBe(
      false,
    );
    expect(isRepositoryAdvancedPreviewBinding({ targetOrigin: 42 })).toBe(
      false,
    );
    expect(isRepositoryAdvancedPreviewBinding({ sourceRevision: 42 })).toBe(
      false,
    );
    expect(
      isRepositoryAdvancedPreviewBinding({ sourceResolvedRevision: 42 }),
    ).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding({ sourceRevisionMode: 42 })).toBe(
      false,
    );
    expect(
      isRepositoryAdvancedPreviewBinding({ merge: { mode: "reverse" } }),
    ).toBe(false);
  });
});

describe("V026-R45 isRepositoryMergePreviewView 全分支", () => {
  const minimal = {
    mode: "eligible",
    eligibleCount: 0,
    mergedCount: 0,
    mergeinfoSupported: false,
  };

  const full = {
    mode: "range",
    requestedRevisions: ["42", "43"],
    fromRevision: "42",
    toRevision: "43",
    resolvedRevisions: ["42"],
    eligible: ["42"],
    merged: ["41"],
    eligibleCount: 1,
    mergedCount: 1,
    eligibleTruncated: true,
    mergedTruncated: false,
    mergeinfoSupported: true,
    mergeinfoNote: "已读取合并信息",
    dryRunCommand: "svn merge --dry-run",
    dryRunFiles: ["src/a.ts"],
    dryRunConflicts: ["src/b.ts"],
    dryRunSummary: "试运行摘要",
    dryRunTruncated: false,
  };

  it("合法接受：最小与完整", () => {
    expect(isRepositoryMergePreviewView(minimal)).toBe(true);
    expect(isRepositoryMergePreviewView(full)).toBe(true);
    expect(
      isRepositoryMergePreviewView({ ...full, eligibleTruncated: undefined }),
    ).toBe(true);
  });

  it("非法拒绝：mode 与数组字段", () => {
    expect(isRepositoryMergePreviewView(null)).toBe(false);
    expect(isRepositoryMergePreviewView({ ...minimal, mode: "reverse" })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...full, requestedRevisions: "42" }),
    ).toBe(false);
    expect(
      isRepositoryMergePreviewView({ ...full, requestedRevisions: [42] }),
    ).toBe(false);
    expect(
      isRepositoryMergePreviewView({ ...full, resolvedRevisions: [42] }),
    ).toBe(false);
    expect(isRepositoryMergePreviewView({ ...full, eligible: [42] })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, merged: [42] })).toBe(false);
    expect(isRepositoryMergePreviewView({ ...full, dryRunFiles: "a.ts" })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...full, dryRunConflicts: [42] }),
    ).toBe(false);
  });

  it("非法拒绝：数值与布尔/字符串字段逐项", () => {
    expect(isRepositoryMergePreviewView({ ...full, fromRevision: 42 })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, toRevision: 42 })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, eligibleCount: "1" })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, eligibleCount: NaN })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, mergedCount: "1" })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...full, eligibleTruncated: "yes" }),
    ).toBe(false);
    expect(isRepositoryMergePreviewView({ ...full, mergedTruncated: 1 })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...full, mergeinfoSupported: "yes" }),
    ).toBe(false);
    expect(isRepositoryMergePreviewView({ ...full, mergeinfoNote: 42 })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, dryRunCommand: 42 })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...full, dryRunSummary: 42 })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...full, dryRunTruncated: "yes" }),
    ).toBe(false);
  });
});

describe("V026-R43/R44 readRepositoryUrlIntent 全分支", () => {
  it("结构化优先：origin/revision 字符串分支", () => {
    expect(
      readRepositoryUrlIntent(
        {
          source: {
            url: "https://svn.example/r/trunk",
            origin: "browse",
            revision: "HEAD",
          },
        },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: "browse",
      revision: "HEAD",
    });
    expect(
      readRepositoryUrlIntent(
        { target: { url: "https://svn.example/r/tags/v1", origin: "manual" } },
        "target",
        "targetUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/tags/v1",
      origin: "manual",
      revision: undefined,
    });
  });

  it("结构化 origin/revision 非字符串回退分支", () => {
    expect(
      readRepositoryUrlIntent(
        { source: { url: "https://svn.example/r/trunk", origin: 42 } },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: undefined,
      revision: undefined,
    });
    // 结构化 revision 非字符串时 source 回退旧扁平 sourceRevision。
    expect(
      readRepositoryUrlIntent(
        {
          source: { url: "https://svn.example/r/trunk", revision: 42 },
          sourceRevision: "42",
        },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: undefined,
      revision: "42",
    });
    expect(
      readRepositoryUrlIntent(
        {
          source: { url: "https://svn.example/r/trunk", revision: 42 },
          sourceRevision: 42,
        },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: undefined,
      revision: undefined,
    });
    // target 结构化 revision 非字符串不回退 sourceRevision。
    expect(
      readRepositoryUrlIntent(
        {
          target: { url: "https://svn.example/r/tags/v1", revision: 42 },
          sourceRevision: "42",
        },
        "target",
        "targetUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/tags/v1",
      origin: undefined,
      revision: undefined,
    });
  });

  it("旧扁平兼容：target/source 分支与缺省", () => {
    expect(
      readRepositoryUrlIntent(
        { targetUrl: "https://svn.example/r/tags/v1" },
        "target",
        "targetUrl",
      ),
    ).toEqual({ rawUrl: "https://svn.example/r/tags/v1" });
    expect(readRepositoryUrlIntent({}, "target", "targetUrl")).toEqual({
      rawUrl: "",
    });
    expect(
      readRepositoryUrlIntent(
        { sourceUrl: "https://svn.example/r/trunk", sourceRevision: "42" },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: undefined,
      revision: "42",
    });
    expect(readRepositoryUrlIntent({}, "source", "sourceUrl")).toEqual({
      rawUrl: "",
      origin: undefined,
      revision: undefined,
    });
    expect(
      readRepositoryUrlIntent(
        { sourceUrl: 42, sourceRevision: 42 },
        "source",
        "sourceUrl",
      ),
    ).toEqual({ rawUrl: "", origin: undefined, revision: undefined });
    // 结构化非 record（字符串）回退旧扁平。
    expect(
      readRepositoryUrlIntent(
        {
          source: "https://svn.example/r/trunk",
          sourceUrl: "https://svn.example/r/legacy",
        },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/legacy",
      origin: undefined,
      revision: undefined,
    });
    expect(
      readRepositoryUrlIntent(
        {
          source: { origin: "browse" },
          sourceUrl: "https://svn.example/r/legacy",
        },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/legacy",
      origin: undefined,
      revision: undefined,
    });
  });
});

describe("V026-R43/R46 isRepositorySnapshot 联动分支", () => {
  const browser = { url: "u", entries: [] };
  const remoteFile = { url: "u", sourceLabel: "x" };
  const remoteHistory = { url: "u", revisions: [] };
  const remoteCompare = { url: "u", fromRevision: "41", toRevision: "42" };

  it("合法接受：远端只读视图与 preview 缺省兼容", () => {
    expect(isRepositorySnapshot(repositoryBase({}))).toBe(true);
    expect(
      isRepositorySnapshot(
        repositoryBase({
          browser,
          remoteFile,
          remoteHistory,
          remoteCompare,
          preview: {},
        }),
      ),
    ).toBe(true);
  });

  it("非法拒绝：远端只读视图与 preview 逐项", () => {
    expect(isRepositorySnapshot(repositoryBase({ browser: { url: 42 } }))).toBe(
      false,
    );
    expect(
      isRepositorySnapshot(repositoryBase({ remoteFile: { url: "u" } })),
    ).toBe(false);
    expect(
      isRepositorySnapshot(repositoryBase({ remoteHistory: { url: "u" } })),
    ).toBe(false);
    expect(
      isRepositorySnapshot(
        repositoryBase({
          remoteCompare: { url: "u", fromRevision: "41" },
        }),
      ),
    ).toBe(false);
    expect(
      isRepositorySnapshot(repositoryBase({ preview: { sourceUrl: 42 } })),
    ).toBe(false);
  });

  it("非法拒绝：shelves 与 shelvesError/shelfFeedback", () => {
    expect(isRepositorySnapshot(repositoryBase({ shelves: "x" }))).toBe(false);
    expect(
      isRepositorySnapshot(repositoryBase({ shelves: [{ id: 42 }] })),
    ).toBe(false);
    expect(
      isRepositorySnapshot(repositoryBase({ shelves: [validShelfEntry()] })),
    ).toBe(true);
    expect(isRepositorySnapshot(repositoryBase({ shelvesError: 42 }))).toBe(
      false,
    );
    expect(isRepositorySnapshot(repositoryBase({ shelfFeedback: 42 }))).toBe(
      false,
    );
  });
});

describe("isUpdateSnapshot result 分支", () => {
  const base = {
    kind: "update",
    info: { name: "repo" },
    conflicts: { count: 0, paths: [] as string[] },
  };

  it("合法接受：无 result 与完整 result", () => {
    expect(isUpdateSnapshot(base)).toBe(true);
    expect(
      isUpdateSnapshot({
        ...base,
        result: {
          ok: true,
          hasConflicts: false,
          message: "已更新",
          revision: "42",
        },
      }),
    ).toBe(true);
  });

  it("非法拒绝：result 逐项", () => {
    expect(isUpdateSnapshot({ ...base, result: "x" })).toBe(false);
    expect(
      isUpdateSnapshot({
        ...base,
        result: { ok: "yes", hasConflicts: false, message: "x" },
      }),
    ).toBe(false);
    expect(
      isUpdateSnapshot({
        ...base,
        result: { ok: true, hasConflicts: "no", message: "x" },
      }),
    ).toBe(false);
    expect(
      isUpdateSnapshot({
        ...base,
        result: { ok: true, hasConflicts: false, message: 42 },
      }),
    ).toBe(false);
    expect(
      isUpdateSnapshot({
        ...base,
        result: {
          ok: true,
          hasConflicts: false,
          message: "x",
          revision: 42,
        },
      }),
    ).toBe(false);
  });
});

describe("createRequestId 缺省前缀分支", () => {
  it("缺省与显式前缀均生成不同 id", () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a.startsWith("request-")).toBe(true);
    expect(a === b).toBe(false);
    const c = createRequestId("custom");
    expect(c.startsWith("custom-")).toBe(true);
  });
});
