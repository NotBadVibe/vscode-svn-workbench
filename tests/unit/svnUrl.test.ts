import { describe, expect, it } from "vitest";
import {
  deriveRepositoryRelativePath,
  encodeSvnUrlSegment,
  joinSvnUrl,
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
