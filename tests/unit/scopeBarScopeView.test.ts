import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import { toScopeView } from "../../src/extension/workbench/workbenchPresentation";

/*
 * v0.1.5 V015-D1：ScopeBar 数据流核对——协议展示字段只携带仓库名基线与
 * 相对路径，不暴露本地绝对路径（repositoryRoot / roots[].absolutePath /
 * projectRoot 不得进入 WorkbenchScopeView）。
 */

const repositoryRoot = path.resolve("/Users/tester/svn-workbench-demo");

function makeScope(): OperationScope {
  return {
    id: "scope-bar-d1",
    repositoryRoot,
    source: "explorerFolder",
    roots: [
      {
        absolutePath: path.join(repositoryRoot, "src/features"),
        relativePath: "src/features",
        kind: "folder",
      },
    ],
    project: {
      projectRoot: path.join(repositoryRoot, "packages/app"),
      projectName: "demo-app",
      rootIsFallback: false,
      workingCopyRelativePath: "packages/app",
    },
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

describe("ScopeBar 协议数据流（v0.1.5 V015-D1）", () => {
  it("展示视图不包含任何本地绝对路径", () => {
    const view = toScopeView(makeScope());
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(repositoryRoot);
    expect(serialized).not.toContain(makeScope().roots[0].absolutePath);
    expect(serialized).not.toContain(
      makeScope().project?.projectRoot ?? "never-present",
    );
    // 仓库名仅为基线名，不含目录分隔符。
    expect(view.repositoryName).toBe(path.basename(repositoryRoot));
    expect(view.repositoryName).not.toMatch(/[/\\]/);
  });

  it("范围根仅为相对路径（无前导斜杠、无盘符、无反斜杠）", () => {
    const view = toScopeView(makeScope());
    expect(view.roots).toHaveLength(1);
    for (const root of view.roots) {
      expect(root.relativePath).not.toMatch(/^[A-Za-z]:/);
      expect(root.relativePath.startsWith("/")).toBe(false);
      expect(root.relativePath).not.toContain("\\");
    }
    expect(view.projectWorkingCopyRelativePath).toBe("packages/app");
  });
});
