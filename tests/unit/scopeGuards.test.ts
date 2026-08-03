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
    expect(isPathInScope(fileScope, "/repo/src/a.ts")).toBe(true);
    expect(isPathInScope(fileScope, "/repo/src/a.ts.bak")).toBe(false);
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
    expect(isPathInScope(folderScope, "/repo/src/a")).toBe(true);
    expect(isPathInScope(folderScope, "/repo/src/a/child.ts")).toBe(true);
    expect(isPathInScope(folderScope, "/repo/src/ab/child.ts")).toBe(false);
    expect(isPathInScope(folderScope, "/repo/src")).toBe(false);
    expect(
      validatePathsInScope(folderScope, ["/repo/src/a/x", "/outside"]),
    ).toEqual({
      validItems: [path.resolve("/repo/src/a/x")],
      outOfScopeItems: [path.resolve("/outside")],
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
