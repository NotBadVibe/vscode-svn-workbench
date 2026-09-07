import { describe, expect, it } from "vitest";
import {
  buildReleaseNotes,
  MAX_RELEASE_NOTES_PATHS_PER_REVISION,
  normalizeReleaseNotesRange,
  parseSvnListXml,
  validatePatchText,
  validateRepositoryUrl,
} from "../../src/repository/advancedRepositoryTools";

describe("advancedRepositoryTools", () => {
  it("解析并把目录排在文件前面", () => {
    const result = parseSvnListXml(
      '<lists><list><entry kind="file"><name>README.md</name><size>12</size><commit revision="4"><author>a</author></commit></entry><entry kind="dir"><name>src</name><commit revision="5"><author>b</author></commit></entry></list></lists>',
    );
    expect(result).toEqual([
      {
        name: "src",
        kind: "dir",
        revision: "5",
        author: "b",
        size: undefined,
        date: undefined,
      },
      {
        name: "README.md",
        kind: "file",
        revision: "4",
        author: "a",
        size: 12,
        date: undefined,
      },
    ]);
  });

  it("限制 URL 协议和当前仓库根地址", () => {
    expect(validateRepositoryUrl("javascript:alert(1)")).toContain(
      "只允许 http、https、svn、svn+ssh 或 file 仓库 URL。",
    );
    expect(
      validateRepositoryUrl("https://other.test/repo", "https://svn.test/repo"),
    ).toContain("目标 URL 必须位于当前 SVN 仓库根地址内。");
    expect(
      validateRepositoryUrl(
        "https://svn.test/repo/branches/a",
        "https://svn.test/repo",
      ),
    ).toEqual([]);
  });

  it("拒绝空、二进制、超限和越界补丁", () => {
    expect(validatePatchText("")).toContain("补丁文件为空。");
    expect(
      validatePatchText("Index: ../secret\n--- ../secret\n+++ ../secret\n"),
    ).toContain("补丁包含越界路径：../secret");
    expect(validatePatchText("Index: a\0b")).toContain(
      "补丁包含二进制空字节，工作台不自动应用。",
    );
    expect(validatePatchText("Index: file\n--- file\n+++ file\n", 4)).toContain(
      "补丁超过 0 MB 安全上限。",
    );
  });

  it("按修订范围生成可复制发布说明", () => {
    const result = buildReleaseNotes(
      [
        {
          revision: "12",
          author: "a",
          date: "",
          message: "fix",
          changedPaths: [{ action: "M", path: "/trunk/a" }],
        },
        {
          revision: "10",
          author: "b",
          date: "",
          message: "feat",
          changedPaths: [],
        },
      ],
      "11",
      "12",
      "https://svn.test/repo/trunk",
    );
    expect(result.count).toBe(1);
    expect(result.markdown).toContain("## r12 · a");
    expect(result.markdown).not.toContain("r10");
    expect(
      buildReleaseNotes(
        [
          {
            revision: "12",
            author: "a",
            date: "",
            message: "fix",
            changedPaths: [],
          },
          {
            revision: "10",
            author: "b",
            date: "",
            message: "feat",
            changedPaths: [],
          },
        ],
        "10",
      ).count,
    ).toBe(2);
  });

  it("V021-R14：范围输入接受 HEAD、拒绝非法并归一化反向范围", () => {
    expect(normalizeReleaseNotesRange("10", "HEAD")).toMatchObject({
      from: "10",
      headRequested: true,
      issues: [],
    });
    expect(normalizeReleaseNotesRange("10", "head").headRequested).toBe(true);
    expect(normalizeReleaseNotesRange("abc", "12").issues.join(" ")).toMatch(
      /起始修订号只能填写正整数/,
    );
    expect(normalizeReleaseNotesRange("HEAD", "12").issues.join(" ")).toMatch(
      /起始修订不支持 HEAD/,
    );
    // 反向范围按含端点语义归一化，不拒绝。
    const reversed = normalizeReleaseNotesRange("42", "40");
    expect(reversed.issues).toEqual([]);
    expect(reversed.normalized).toBe(true);
    expect(reversed.from).toBe("40");
    expect(reversed.to).toBe("42");
    // 空范围保持缺省（调用方给出确定结果）。
    expect(normalizeReleaseNotesRange("", "")).toMatchObject({
      from: undefined,
      headRequested: false,
      issues: [],
    });
  });

  it("V021-R14：单修订超 20 路径时注明省略数并提供完整版", () => {
    expect(MAX_RELEASE_NOTES_PATHS_PER_REVISION).toBe(20);
    const changedPaths = Array.from({ length: 25 }, (_, index) => ({
      action: "M",
      path: `/trunk/file-${index}.ts`,
    }));
    const result = buildReleaseNotes(
      [
        {
          revision: "42",
          author: "a",
          date: "",
          message: "big",
          changedPaths,
        },
      ],
      "42",
      "42",
    );
    expect(result.count).toBe(1);
    expect(result.omittedPathCount).toBe(5);
    expect(result.truncatedRevisions).toEqual([{ revision: "42", omitted: 5 }]);
    expect(result.markdown).toMatch(/另有 5 个路径未在摘要中显示/);
    // 完整版不截断。
    expect(result.fullMarkdown).toContain("/trunk/file-24.ts");
    expect(result.fullMarkdown).not.toMatch(/未在摘要中显示/);
    expect(result.complete).toBe(true);
  });

  it("V021-R14：空范围、反向范围与部分结果均有确定表达", () => {
    const revisions = [
      {
        revision: "12",
        author: "a",
        date: "",
        message: "fix",
        changedPaths: [{ action: "M", path: "/trunk/a" }],
      },
      {
        revision: "10",
        author: "b",
        date: "",
        message: "feat",
        changedPaths: [],
      },
    ];
    // 空范围：保持缺省语义（调用方采集后按页标注完整性）。
    const empty = buildReleaseNotes(revisions);
    expect(empty.count).toBe(2);
    expect(empty.markdown).toMatch(/全部已采集/);
    // 反向范围归一化后过滤一致。
    expect(buildReleaseNotes(revisions, "12", "10").count).toBe(2);
    // 部分结果必须显式标记，不冒充完整。
    const partial = buildReleaseNotes(revisions, "10", "12", undefined, {
      revisionsRead: 2,
      complete: false,
      partialReason: "已取消",
    });
    expect(partial.complete).toBe(false);
    expect(partial.markdown).toMatch(/部分结果/);
    expect(partial.markdown).toMatch(/已取消/);
    // HEAD 固定展示。
    const head = buildReleaseNotes(revisions, "10", "42", undefined, {
      resolvedHeadRevision: "42",
    });
    expect(head.markdown).toMatch(/HEAD 已固定为 r42/);
  });
});
