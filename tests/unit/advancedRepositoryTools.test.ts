import { describe, expect, it } from "vitest";
import {
  buildReleaseNotes,
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
});
