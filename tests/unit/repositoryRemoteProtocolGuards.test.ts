import { describe, expect, it } from "vitest";
import {
  isRepositoryAdvancedPreviewBinding,
  isRepositoryBrowserView,
  isRepositoryRemoteCompareView,
  isRepositoryRemoteFileView,
  isRepositoryRemoteHistoryView,
  isRepositorySnapshot,
  readRepositoryUrlIntent,
  webviewActions,
} from "../../src/protocol/workbenchProtocol";

/*
 * V026-R43/R46：仓库浏览上下文、远端只读视图与高级预览源/目标绑定的
 * 协议守卫（Host/Webview/Mock 共用，fail-closed）。
 */

const baseRepository = {
  kind: "repository",
  info: { name: "repo" },
  properties: { available: true, target: ".", items: [] },
  cleanup: { available: true, target: "." },
  advanced: {},
};

describe("V026 repository protocol guards", () => {
  it("新远端动作已进入 WebviewAction 运行时清单", () => {
    for (const action of [
      "repository/preview-remote-file",
      "repository/query-remote-history",
      "repository/compare-remote-revisions",
      "repository/discard-advanced-preview",
    ]) {
      expect(webviewActions).toContain(action);
    }
  });

  it("浏览上下文缺省兼容、畸形拒绝", () => {
    expect(
      isRepositoryBrowserView({
        url: "https://svn.example/r/trunk",
        entries: [],
      }),
    ).toBe(true);
    expect(
      isRepositoryBrowserView({
        url: "https://svn.example/r/trunk",
        entries: [],
        revision: "42",
        repositoryRoot: "https://svn.example/r",
        projectUrl: "https://svn.example/r/trunk",
        lastGoodUrl: "https://svn.example/r/trunk",
      }),
    ).toBe(true);
    expect(
      isRepositoryBrowserView({
        url: "https://svn.example/r",
        entries: [{ name: "a" }],
      }),
    ).toBe(false);
    expect(isRepositoryBrowserView({ url: 42, entries: [] })).toBe(false);
  });

  it("远端只读视图逐项严检", () => {
    expect(
      isRepositoryRemoteFileView({
        url: "https://svn.example/r/a",
        sourceLabel: "远端只读",
      }),
    ).toBe(true);
    expect(
      isRepositoryRemoteFileView({
        url: "https://svn.example/r/a",
        sourceLabel: 1,
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteHistoryView({
        url: "https://svn.example/r/a",
        revisions: [{ revision: "42", message: "fix" }],
      }),
    ).toBe(true);
    expect(
      isRepositoryRemoteHistoryView({
        url: "https://svn.example/r/a",
        revisions: [{ revision: 42 }],
      }),
    ).toBe(false);
    expect(
      isRepositoryRemoteCompareView({
        url: "https://svn.example/r/a",
        fromRevision: "41",
        toRevision: "42",
      }),
    ).toBe(true);
    expect(
      isRepositoryRemoteCompareView({
        url: "https://svn.example/r/a",
        fromRevision: "41",
      }),
    ).toBe(false);
  });

  it("高级预览源/目标绑定缺省兼容、畸形拒绝", () => {
    expect(isRepositoryAdvancedPreviewBinding({})).toBe(true);
    expect(
      isRepositoryAdvancedPreviewBinding({
        sourceUrl: "https://svn.example/r/a",
      }),
    ).toBe(true);
    expect(isRepositoryAdvancedPreviewBinding({ sourceUrl: 42 })).toBe(false);
  });

  it("结构化 URL 意图优先、旧扁平兼容", () => {
    expect(
      readRepositoryUrlIntent(
        { source: { url: "https://svn.example/r/a", origin: "browse" } },
        "source",
        "sourceUrl",
      ),
    ).toEqual({ rawUrl: "https://svn.example/r/a", origin: "browse" });
    expect(
      readRepositoryUrlIntent(
        { sourceUrl: "https://svn.example/r/b" },
        "source",
        "sourceUrl",
      ),
    ).toEqual({ rawUrl: "https://svn.example/r/b", origin: undefined });
    expect(readRepositoryUrlIntent({}, "target", "targetUrl")).toEqual({
      rawUrl: "",
      origin: undefined,
    });
  });

  it("仓库快照携带新视图时走守卫、畸形整快照拒绝", () => {
    expect(
      isRepositorySnapshot({
        ...baseRepository,
        advanced: {
          browser: { url: "https://svn.example/r", entries: [] },
          remoteFile: {
            url: "https://svn.example/r/a",
            sourceLabel: "远端只读",
          },
          remoteHistory: { url: "https://svn.example/r/a", revisions: [] },
          remoteCompare: {
            url: "https://svn.example/r/a",
            fromRevision: "41",
            toRevision: "42",
          },
          preview: { sourceUrl: "https://svn.example/r/a" },
        },
      }),
    ).toBe(true);
    expect(
      isRepositorySnapshot({
        ...baseRepository,
        advanced: { remoteFile: { url: 42, sourceLabel: "远端只读" } },
      }),
    ).toBe(false);
    expect(
      isRepositorySnapshot({
        ...baseRepository,
        advanced: { browser: { url: 42, entries: [] } },
      }),
    ).toBe(false);
  });
});
