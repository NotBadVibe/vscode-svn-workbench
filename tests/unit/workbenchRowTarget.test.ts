import { describe, expect, it } from "vitest";
import {
  buildCrossModuleWindowRequest,
  parseRowTargetRelativePath,
} from "../../src/extension/workbench/workbenchRouting";
import { validatePathsInScope } from "../../src/scope/pathBoundaryGuard";
import type { OperationScope } from "../../src/scope/operationScope";
import type { PathSemantics } from "../../src/scope/pathIdentity";

/*
 * V020-R10 · 行右键任务定位所点文件（P1）。
 * 行菜单只携带目标字符串；范围复验由 Host 在原 scope 内完成。
 * 本单测断言平台无关：POSIX 与 win32 语义均显式注入，不依赖宿主 path。
 */

const posix: PathSemantics = { platform: "linux", cwd: "/" };
const win32: PathSemantics = { platform: "win32", cwd: "C:\\repo" };

function folderScope(
  repositoryRoot: string,
  absolutePath: string,
  relativePath: string,
): OperationScope {
  return {
    id: "scope",
    repositoryRoot,
    source: "explorerFolder",
    roots: [{ absolutePath, relativePath, kind: "folder" }],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

describe("V020-R10 行目标携带与复验", () => {
  it("只提取 relativePath/targetPath 字符串，空值与非字符串一律缺省", () => {
    expect(
      parseRowTargetRelativePath({
        moduleId: "history",
        relativePath: "src/second.ts",
      }),
    ).toBe("src/second.ts");
    expect(parseRowTargetRelativePath({ targetPath: "src/b.ts" })).toBe(
      "src/b.ts",
    );
    expect(parseRowTargetRelativePath({ moduleId: "history" })).toBeUndefined();
    expect(parseRowTargetRelativePath({ relativePath: "   " })).toBeUndefined();
    expect(parseRowTargetRelativePath({ relativePath: 42 })).toBeUndefined();
  });

  it("跨模块转发保留行目标文件（缺省时不新增字段语义）", () => {
    const scope = folderScope("/repo", "/repo/src", "src");
    expect(
      buildCrossModuleWindowRequest({
        moduleId: "history",
        taskId: "history/revisions",
        svnPath: "svn",
        scope,
        targetFile: "/repo/src/second.ts",
      }).targetFile,
    ).toBe("/repo/src/second.ts");
    expect(
      buildCrossModuleWindowRequest({
        moduleId: "history",
        taskId: "history/revisions",
        svnPath: "svn",
        scope,
      }).targetFile,
    ).toBeUndefined();
  });

  it("POSIX：目录内第二文件通过，同前缀兄弟与范围外路径拒绝", () => {
    const scope = folderScope("/repo", "/repo/src", "src");
    expect(
      validatePathsInScope(scope, ["/repo/src/second.ts"], posix)
        .outOfScopeItems,
    ).toHaveLength(0);
    // 同前缀兄弟目录不得蒙混过关。
    expect(
      validatePathsInScope(scope, ["/repo/src2/second.ts"], posix)
        .outOfScopeItems,
    ).toHaveLength(1);
    // 范围外伪造路径 fail-closed。
    expect(
      validatePathsInScope(scope, ["/etc/passwd"], posix).outOfScopeItems,
    ).toHaveLength(1);
    expect(
      validatePathsInScope(scope, ["/repo/other/a.ts"], posix).outOfScopeItems,
    ).toHaveLength(1);
  });

  it("win32：盘符大小写折叠后仍在范围内，跨盘符拒绝", () => {
    const scope = folderScope("C:\\repo", "C:\\repo\\src", "src");
    expect(
      validatePathsInScope(scope, ["c:\\REPO\\src\\Second.ts"], win32)
        .outOfScopeItems,
    ).toHaveLength(0);
    expect(
      validatePathsInScope(scope, ["D:\\repo\\src\\a.ts"], win32)
        .outOfScopeItems,
    ).toHaveLength(1);
    expect(
      validatePathsInScope(scope, ["C:\\repo\\src2\\a.ts"], win32)
        .outOfScopeItems,
    ).toHaveLength(1);
  });
});
