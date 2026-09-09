import { describe, expect, it } from "vitest";
import { normalizeBranchTagSourceRevision } from "../../src/repository/advancedRepositoryTools";
import {
  isRepositoryAdvancedPreviewBinding,
  readRepositoryUrlIntent,
} from "../../src/protocol/workbenchProtocol";

/*
 * V026-R44：分支与标签显式源修订版本（纯函数 + 协议守卫，平台无关）。
 */

describe("V026-R44 normalizeBranchTagSourceRevision", () => {
  it("空与 HEAD 归一为远端 HEAD 模式", () => {
    expect(normalizeBranchTagSourceRevision(undefined)).toMatchObject({
      mode: "HEAD",
      requestedRevision: "HEAD",
      revision: "HEAD",
      issues: [],
    });
    expect(normalizeBranchTagSourceRevision("")).toMatchObject({
      mode: "HEAD",
    });
    expect(normalizeBranchTagSourceRevision("head")).toMatchObject({
      mode: "HEAD",
      revision: "HEAD",
    });
    expect(normalizeBranchTagSourceRevision("HEAD")).toMatchObject({
      mode: "HEAD",
    });
  });

  it("正整数去前导零为指定模式", () => {
    expect(normalizeBranchTagSourceRevision("42")).toMatchObject({
      mode: "revision",
      requestedRevision: "42",
      revision: "42",
      issues: [],
    });
    expect(normalizeBranchTagSourceRevision("r007")).toMatchObject({
      mode: "revision",
      revision: "7",
    });
    expect(normalizeBranchTagSourceRevision("  R42  ")).toMatchObject({
      mode: "revision",
      revision: "42",
    });
  });

  it("零、负数与非数字 fail-closed 给出中文原因", () => {
    for (const bad of ["0", "-3", "r0", "abc", "42.5", "HEAD42"]) {
      const result = normalizeBranchTagSourceRevision(bad);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.join("")).toContain("源修订版本");
    }
  });
});

describe("V026-R44 协议：源修订版本意图与预览冻结绑定", () => {
  it("结构化 revision 优先、旧扁平 sourceRevision 兼容", () => {
    expect(
      readRepositoryUrlIntent(
        { source: { url: "https://svn.example/r/trunk", revision: "HEAD" } },
        "source",
        "sourceUrl",
      ),
    ).toEqual({
      rawUrl: "https://svn.example/r/trunk",
      origin: undefined,
      revision: "HEAD",
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
    // target 不携带 revision。
    expect(
      readRepositoryUrlIntent(
        { targetUrl: "https://svn.example/r/tags/v1" },
        "target",
        "targetUrl",
      ),
    ).toEqual({ rawUrl: "https://svn.example/r/tags/v1" });
  });

  it("预览冻结三字段缺省兼容、畸形拒绝", () => {
    expect(isRepositoryAdvancedPreviewBinding({})).toBe(true);
    expect(
      isRepositoryAdvancedPreviewBinding({
        sourceUrl: "https://svn.example/r/trunk",
        sourceRevision: "HEAD",
        sourceResolvedRevision: "42",
        sourceRevisionMode: "HEAD",
      }),
    ).toBe(true);
    expect(isRepositoryAdvancedPreviewBinding({ sourceRevision: 42 })).toBe(
      false,
    );
    expect(
      isRepositoryAdvancedPreviewBinding({ sourceResolvedRevision: 42 }),
    ).toBe(false);
    expect(isRepositoryAdvancedPreviewBinding({ sourceRevisionMode: 42 })).toBe(
      false,
    );
  });
});
