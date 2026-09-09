import { describe, expect, it } from "vitest";
import {
  buildRepositoryChildUrl,
  composeBranchTagUrl,
  decodeSvnUrlSegmentSafe,
  deriveRepositoryRelativePath,
  encodeSvnUrlSegment,
  encodeSvnUrlSegmentOnce,
  isSvnUrlWithinRepository,
  joinSvnUrl,
  normalizeSvnUrl,
} from "../../src/svn/svnUrl";

/*
 * v0.0.7 路径详情 URL 契约：SVN URL 只能由工作副本根检出 URL 推导；
 * 覆盖检出自仓库子目录、特殊字符（空格/中文/#/%）与信息不可得缺省。
 */

describe("SVN URL 推导（v0.0.7）", () => {
  it("工作副本根检出自仓库子目录时 URL 基于检出 URL 而非 repos-root", () => {
    // WC root URL = …/Code2/trunk/app，文件 src/a.ts。
    expect(
      joinSvnUrl(
        "https://svn.example.internal/svn/Code2/trunk/app",
        "src/a.ts",
      ),
    ).toBe("https://svn.example.internal/svn/Code2/trunk/app/src/a.ts");
  });

  it("特殊字符逐段 percent-encode", () => {
    expect(encodeSvnUrlSegment("设计 文档#1.md")).toBe(
      encodeURIComponent("设计 文档#1.md"),
    );
    expect(
      joinSvnUrl("https://svn.example/internal/r", "设计 文档/v1#最终 100%.md"),
    ).toBe(
      `https://svn.example/internal/r/${encodeURIComponent("设计 文档")}/${encodeURIComponent("v1#最终 100%.md")}`,
    );
    const url = joinSvnUrl("https://svn.example/internal/r", "a b/c#d/50%.ts");
    expect(url).toContain("a%20b");
    expect(url).toContain("c%23d");
    expect(url).toContain("50%25.ts");
  });

  it("未版本化文件按同一规则推导检出后 URL", () => {
    expect(joinSvnUrl("https://svn.example/internal/r", "new file.ts")).toBe(
      "https://svn.example/internal/r/new%20file.ts",
    );
  });

  it("空相对路径与点段返回基础 URL；结尾斜杠归一", () => {
    expect(joinSvnUrl("https://svn.example/internal/r/", ".")).toBe(
      "https://svn.example/internal/r",
    );
    expect(joinSvnUrl("https://svn.example/internal/r", "")).toBe(
      "https://svn.example/internal/r",
    );
  });

  it("仓库内路径由 repos-root 与检出 URL 的差集推导", () => {
    expect(
      deriveRepositoryRelativePath(
        "https://svn.example.internal/svn/Code2",
        "https://svn.example.internal/svn/Code2/trunk/app",
        "src/a.ts",
      ),
    ).toBe("trunk/app/src/a.ts");
    // 工作副本根即仓库根。
    expect(
      deriveRepositoryRelativePath(
        "https://svn.example.internal/svn/Code2",
        "https://svn.example.internal/svn/Code2",
        "src/a.ts",
      ),
    ).toBe("src/a.ts");
  });

  it("检出 URL 不在 repository root 之下时如实缺省", () => {
    expect(
      deriveRepositoryRelativePath(
        "https://svn.example.internal/svn/Other",
        "https://svn.example.internal/svn/Code2/trunk/app",
        "src/a.ts",
      ),
    ).toBeUndefined();
    // 前缀相似但不是同一仓库路径也不得误拼。
    expect(
      deriveRepositoryRelativePath(
        "https://svn.example.internal/svn/Code",
        "https://svn.example.internal/svn/Code2/app",
        "a.ts",
      ),
    ).toBeUndefined();
  });

  it("检出 URL 中的编码段在仓库内路径中解码为可读形式", () => {
    expect(
      deriveRepositoryRelativePath(
        "https://svn.example/internal/r",
        "https://svn.example/internal/r/%E8%AE%BE%E8%AE%A1",
        "a.ts",
      ),
    ).toBe("设计/a.ts");
  });
});

/* V026-R43：逐段规范编码（中文/空格/# 正确编码，已编码不重复编码）。 */
describe("SVN URL 规范化（V026-R43）", () => {
  it("中文/空格/# 按段编码", () => {
    expect(
      normalizeSvnUrl("https://svn.example/internal/r/设计 文档/v1#最终.ts"),
    ).toBe(
      `https://svn.example/internal/r/${encodeURIComponent("设计 文档")}/${encodeURIComponent("v1#最终.ts")}`,
    );
  });

  it("已编码输入不重复编码", () => {
    const once = normalizeSvnUrl("https://svn.example/internal/r/a%20b/c%23d");
    expect(once).toBe("https://svn.example/internal/r/a%20b/c%23d");
    expect(normalizeSvnUrl(once)).toBe(once);
    expect(encodeSvnUrlSegmentOnce("%20")).toBe("%2520".slice(0, 0) + "%20");
    expect(decodeSvnUrlSegmentSafe("%E8%AE%BE%E8%AE%A1")).toBe("设计");
    expect(decodeSvnUrlSegmentSafe("100%")).toBe("100%");
  });

  it("子条目名统一解后重编（浏览进入下级/复制 URL 一致）", () => {
    expect(
      buildRepositoryChildUrl(
        "https://svn.example/internal/r/trunk/",
        "设计 文档",
      ),
    ).toBe(
      `https://svn.example/internal/r/trunk/${encodeURIComponent("设计 文档")}`,
    );
    expect(
      buildRepositoryChildUrl("https://svn.example/internal/r/trunk", "a%20b"),
    ).toBe("https://svn.example/internal/r/trunk/a%20b");
  });

  it("branches/tags 路径与名称组合逐段编码", () => {
    expect(
      composeBranchTagUrl(
        "https://svn.example/internal/r",
        "branches",
        "功能 分支/v1#终版",
      ),
    ).toBe(
      `https://svn.example/internal/r/branches/${encodeURIComponent("功能 分支")}/${encodeURIComponent("v1#终版")}`,
    );
    expect(
      composeBranchTagUrl("https://svn.example/internal/r", "tags", "v1.0.0"),
    ).toBe("https://svn.example/internal/r/tags/v1.0.0");
    expect(
      composeBranchTagUrl("https://svn.example/internal/r", "trunk", ""),
    ).toBe("https://svn.example/internal/r/trunk");
    expect(composeBranchTagUrl("not-a-url", "tags", "v1")).toBeUndefined();
    expect(
      composeBranchTagUrl("https://svn.example/internal/r", "tags", "  "),
    ).toBeUndefined();
  });

  it("仓库归属比较前统一规范化（编码差异不误判）", () => {
    expect(
      isSvnUrlWithinRepository(
        "https://svn.example/internal/r/trunk/a%20b",
        "https://svn.example/internal/r",
      ),
    ).toBe(true);
    expect(
      isSvnUrlWithinRepository(
        "https://svn.example/internal/r/trunk/a b",
        "https://svn.example/internal/r",
      ),
    ).toBe(true);
    expect(
      isSvnUrlWithinRepository(
        "https://other.example/r/trunk",
        "https://svn.example/internal/r",
      ),
    ).toBe(false);
    // 同前缀兄弟仓库不得误判为同一仓库。
    expect(
      isSvnUrlWithinRepository(
        "https://svn.example/internal/r2/trunk",
        "https://svn.example/internal/r",
      ),
    ).toBe(false);
  });

  it("Windows file URL 盘符冒号不编码（与 pathToFileURL 同形）", () => {
    // Windows file 仓库根：盘符段 `C:` 是路径语法的一部分，不得编成 `C%3A`；
    // 否则与 svn info 返回的仓库根前缀比对失败，Windows 合并 dry-run 被误判跨仓库阻止。
    expect(normalizeSvnUrl("file:///C:/Users/test/repository")).toBe(
      "file:///C:/Users/test/repository",
    );
    expect(
      normalizeSvnUrl("file:///C:/Users/test/repository/branches/feature-b"),
    ).toBe("file:///C:/Users/test/repository/branches/feature-b");
    // 已被误编码的输入同样归一回规范形（解后重编不残留 %3A）。
    expect(normalizeSvnUrl("file:///C%3A/Users/test/repository")).toBe(
      "file:///C:/Users/test/repository",
    );
    expect(
      isSvnUrlWithinRepository(
        "file:///C:/Users/test/repository/branches/feature-b",
        "file:///C:/Users/test/repository",
      ),
    ).toBe(true);
    // POSIX file URL 不受影响。
    expect(normalizeSvnUrl("file:///tmp/svn-real-abc/repository")).toBe(
      "file:///tmp/svn-real-abc/repository",
    );
  });
});
