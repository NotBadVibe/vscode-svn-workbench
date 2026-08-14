import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import { withProjectFileView } from "../../src/extension/workbench/workbenchFileOperations";
import { toScopeView } from "../../src/extension/workbench/workbenchPresentation";

/*
 * v0.0.7 路径显示契约（§7.1）：文件主路径默认项目内路径；跨项目 scope
 * 显示项目徽标；单项目列表不逐行重复项目名；显示路径不是写操作身份。
 */

const wcRoot = path.resolve("/repo/code");

function makeScope(overrides: Partial<OperationScope> = {}): OperationScope {
  return {
    id: "scope",
    repositoryRoot: wcRoot,
    source: "explorerFolder",
    roots: [
      {
        absolutePath: path.join(wcRoot, "app"),
        relativePath: "app",
        kind: "folder",
      },
    ],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
    ...overrides,
  };
}

const appProject = {
  projectRoot: path.join(wcRoot, "app"),
  projectName: "app",
  rootIsFallback: false,
  workingCopyRelativePath: "app",
};
const webProject = {
  projectRoot: path.join(wcRoot, "web"),
  projectName: "web",
  rootIsFallback: false,
  workingCopyRelativePath: "web",
};

describe("文件视图的项目路径显示", () => {
  it("默认显示项目内路径，不设置项目徽标", () => {
    const view = withProjectFileView(
      { relativePath: "app/src/index.ts", status: "modified" },
      path.join(wcRoot, "app/src/index.ts"),
      makeScope({ project: appProject }),
    );
    expect(view.projectRelativePath).toBe("src/index.ts");
    expect(view.projectName).toBeUndefined();
    // 写操作身份仍是工作副本内路径。
    expect(view.relativePath).toBe("app/src/index.ts");
  });

  it("项目外文件不提供项目内路径", () => {
    const view = withProjectFileView(
      { relativePath: "other/x.ts", status: "modified" },
      path.join(wcRoot, "other/x.ts"),
      makeScope({ project: appProject }),
    );
    expect(view.projectRelativePath).toBeUndefined();
  });

  it("跨项目 scope 按所属项目显示徽标与各自项目内路径", () => {
    const scope = makeScope({
      project: appProject,
      projects: [appProject, webProject],
    });
    const inApp = withProjectFileView(
      { relativePath: "app/a.ts", status: "modified" },
      path.join(wcRoot, "app/a.ts"),
      scope,
    );
    const inWeb = withProjectFileView(
      { relativePath: "web/b.ts", status: "added" },
      path.join(wcRoot, "web/b.ts"),
      scope,
    );
    expect(inApp.projectName).toBe("app");
    expect(inApp.projectRelativePath).toBe("a.ts");
    expect(inWeb.projectName).toBe("web");
    expect(inWeb.projectRelativePath).toBe("b.ts");
  });

  it("无项目上下文时保持原视图", () => {
    const original = { relativePath: "a.ts", status: "modified" as const };
    const view = withProjectFileView(
      original,
      path.join(wcRoot, "a.ts"),
      makeScope(),
    );
    expect(view).toEqual(original);
  });
});

describe("范围视图不向 Webview 暴露绝对路径", () => {
  it("ScopeView 不包含工作副本根或仓库 URL（路径详情按需由 Host 返回）", () => {
    const view = toScopeView(makeScope());
    expect(view).not.toHaveProperty("workingCopyRoot");
    expect(view).not.toHaveProperty("repositoryRootUrl");
  });
});
