import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Uri } from "vscode";
import {
  createScopeFromExplorer,
  type OperationScope,
} from "../../src/scope/operationScope";
import {
  isPathInScope,
  validatePathsInScope,
} from "../../src/scope/pathBoundaryGuard";
import type { PathSemantics } from "../../src/scope/pathIdentity";

const posix: PathSemantics = { platform: "linux", cwd: "/" };
const win32: PathSemantics = { platform: "win32", cwd: "C:\\workspace" };

const temporaryRoots: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  ),
);

describe("右键操作范围边界", () => {
  it("区分单文件、目录本身、子项、同前缀兄弟和父目录", () => {
    const fileScope: OperationScope = {
      id: "f",
      repositoryRoot: "/repo",
      source: "explorerFile",
      roots: [
        {
          absolutePath: "/repo/src/a.ts",
          relativePath: "src/a.ts",
          kind: "file",
        },
      ],
      allowExpandScope: false,
      includeExternals: false,
      includeNestedWorkingCopies: false,
      createdAt: 0,
    };
    expect(isPathInScope(fileScope, "/repo/src/a.ts", posix)).toBe(true);
    expect(isPathInScope(fileScope, "/repo/src/a.ts.bak", posix)).toBe(false);
    const folderScope = {
      ...fileScope,
      roots: [
        {
          absolutePath: "/repo/src/a",
          relativePath: "src/a",
          kind: "folder" as const,
        },
      ],
    };
    expect(isPathInScope(folderScope, "/repo/src/a", posix)).toBe(true);
    expect(isPathInScope(folderScope, "/repo/src/a/child.ts", posix)).toBe(
      true,
    );
    expect(
      isPathInScope(folderScope, "/repo/src/a/..cache/file.ts", posix),
    ).toBe(true);
    expect(isPathInScope(folderScope, "/repo/src/ab/child.ts", posix)).toBe(
      false,
    );
    expect(isPathInScope(folderScope, "/repo/src", posix)).toBe(false);
    expect(
      validatePathsInScope(folderScope, ["/repo/src/a/x", "/outside"], posix),
    ).toEqual({
      // 返回路径按注入的 POSIX 语义规范化，不能由测试机器的宿主 path 决定。
      validItems: ["/repo/src/a/x"],
      outOfScopeItems: ["/outside"],
    });
  });

  it("win32 对称契约：大小写折叠、盘符、子项、同前缀兄弟、父目录与 ..cache", () => {
    const fileScope: OperationScope = {
      id: "f-win",
      repositoryRoot: "C:\\repo",
      source: "explorerFile",
      roots: [
        {
          absolutePath: "C:\\repo\\src\\a.ts",
          relativePath: "src/a.ts",
          kind: "file",
        },
      ],
      allowExpandScope: false,
      includeExternals: false,
      includeNestedWorkingCopies: false,
      createdAt: 0,
    };
    // 文件自身（含大小写不同写法）在范围内，同前缀兄弟不在。
    expect(isPathInScope(fileScope, "C:\\repo\\src\\a.ts", win32)).toBe(true);
    expect(isPathInScope(fileScope, "c:/repo/src/A.ts", win32)).toBe(true);
    expect(isPathInScope(fileScope, "C:\\repo\\src\\a.ts.bak", win32)).toBe(
      false,
    );
    const folderScope = {
      ...fileScope,
      roots: [
        {
          absolutePath: "C:\\repo\\src\\a",
          relativePath: "src/a",
          kind: "folder" as const,
        },
      ],
    };
    // 目录自身、子项（含大小写折叠）、..cache 子目录均在范围内。
    expect(isPathInScope(folderScope, "C:\\repo\\src\\a", win32)).toBe(true);
    expect(
      isPathInScope(folderScope, "C:\\repo\\src\\a\\child.ts", win32),
    ).toBe(true);
    expect(
      isPathInScope(folderScope, "C:\\REPO\\SRC\\A\\Child.ts", win32),
    ).toBe(true);
    expect(
      isPathInScope(folderScope, "C:\\repo\\src\\a\\..cache\\file.ts", win32),
    ).toBe(true);
    // 同前缀兄弟与父目录不得误判。
    expect(
      isPathInScope(folderScope, "C:\\repo\\src\\ab\\child.ts", win32),
    ).toBe(false);
    expect(isPathInScope(folderScope, "C:\\repo\\src", win32)).toBe(false);
    // 不同盘符不是同一路径。
    expect(isPathInScope(folderScope, "D:\\repo\\src\\a\\x.ts", win32)).toBe(
      false,
    );
    // valid/out-of-scope 返回路径按注入的 win32 语义规范化。
    expect(
      validatePathsInScope(
        folderScope,
        ["C:\\repo\\src\\a\\x", "C:\\outside"],
        win32,
      ),
    ).toEqual({
      // 返回路径按注入的 win32 语义规范化，与宿主平台无关。
      validItems: [path.win32.resolve("C:\\workspace", "C:\\repo\\src\\a\\x")],
      outOfScopeItems: [path.win32.resolve("C:\\workspace", "C:\\outside")],
    });
  });

  it("从文件和混合多选创建范围，并只合并真正被父目录覆盖的子项", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "scope-guard-"));
    temporaryRoots.push(root);
    await fs.mkdir(path.join(root, "folder"));
    await fs.writeFile(path.join(root, "file.ts"), "x");
    await fs.writeFile(path.join(root, "folder", "child.ts"), "x");
    const fileScope = await createScopeFromExplorer(
      root,
      Uri.file(path.join(root, "file.ts")) as never,
    );
    expect(fileScope.source).toBe("explorerFile");
    const mixed = await createScopeFromExplorer(
      root,
      Uri.file(path.join(root, "file.ts")) as never,
      [
        Uri.file(path.join(root, "file.ts")),
        Uri.file(path.join(root, "folder")),
        Uri.file(path.join(root, "folder", "child.ts")),
      ] as never,
    );
    expect(mixed.source).toBe("explorerMultiSelection");
    expect(mixed.roots.map((item) => item.relativePath).sort()).toEqual([
      "file.ts",
      "folder",
    ]);
  });
});
