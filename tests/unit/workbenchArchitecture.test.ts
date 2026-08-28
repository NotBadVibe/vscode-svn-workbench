import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommitCandidate } from "../../src/commit/commitCandidateCollector";
import type { OperationScope } from "../../src/scope/operationScope";
import {
  asFileOperation,
  repositoryParentUrl,
  validateFileOperation,
} from "../../src/extension/workbench/workbenchFileOperations";
import {
  asRevisionArray,
  getModuleTitle,
  inferLanguage,
  quoteCommandPreviewArgument,
  toScopeView,
} from "../../src/extension/workbench/workbenchPresentation";
import {
  hashCandidateState,
  hashOperationScope,
  parseBlameOutput,
} from "../../src/extension/workbench/workbenchSupport";

const repositoryRoot = path.resolve("/repo");
const scope: OperationScope = {
  id: "scope",
  repositoryRoot,
  source: "editorFile",
  roots: [
    {
      absolutePath: path.join(repositoryRoot, "src"),
      relativePath: "src",
      kind: "folder",
    },
  ],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

const candidate = (
  relativePath: string,
  overrides: Partial<CommitCandidate> = {},
): CommitCandidate => ({
  absolutePath: path.join(repositoryRoot, relativePath),
  relativePath,
  status: "unversioned",
  fileType: "ts",
  templateGroup: "frontend",
  generatedDecision: "keep",
  selection: "selected",
  reason: "test",
  evaluation: {
    decision: "needsReview",
    reasonKey: "statusPolicy",
    statusPolicyKey: "unversioned",
    safetyLocked: false,
  },
  ...overrides,
});

describe("工作台职责拆分后的纯逻辑", () => {
  it("把范围、标题、语言和修订输入规范化为可展示数据", () => {
    expect(toScopeView(scope)).toEqual({
      repositoryName: "repo",
      roots: [{ kind: "folder", relativePath: "src" }],
      source: "editor",
    });
    // v0.0.17 批次 A：repository 默认任务不再是更新（update 已独立成模块）。
    expect(getModuleTitle("repository", "commit/compose")).toBe(
      "SVN · 浏览 SVN 仓库",
    );
    expect(getModuleTitle("update", "update/preview")).toBe(
      "SVN · 更新当前范围",
    );
    expect(inferLanguage("Component.svelte")).toBe("svelte");
    expect(inferLanguage("README")).toBe("text");
    expect(asRevisionArray(["1", "x", 2, "003"])).toEqual(["1", "003"]);
  });

  it("完整编码命令预览参数中的反斜杠与双引号", () => {
    expect(quoteCommandPreviewArgument('dir\\segment"quoted.ts')).toBe(
      '"dir\\\\segment\\"quoted.ts"',
    );
  });

  it("范围视图携带 v0.0.7 项目上下文：项目名为主显示，工作副本为次级", () => {
    const projectScope: OperationScope = {
      ...scope,
      project: {
        projectRoot: path.join(repositoryRoot, "app"),
        projectName: "app",
        rootIsFallback: false,
        workingCopyRelativePath: "app",
      },
    };
    expect(toScopeView(projectScope)).toEqual({
      repositoryName: "repo",
      projectName: "app",
      projectRootIsFallback: false,
      projectWorkingCopyRelativePath: "app",
      roots: [{ kind: "folder", relativePath: "src" }],
      source: "editor",
    });
    // 未解析项目上下文的旧调用方不产生项目字段。
    expect(toScopeView(scope).projectName).toBeUndefined();
  });

  it("项目边界变化使范围哈希失效，旧预览与确认令牌不得复用", () => {
    const baseHash = hashOperationScope(scope);
    const withProject = hashOperationScope({
      ...scope,
      project: {
        projectRoot: path.join(repositoryRoot, "app"),
        projectName: "app",
        rootIsFallback: false,
        workingCopyRelativePath: "app",
      },
    });
    expect(withProject).not.toBe(baseHash);
    const otherProject = hashOperationScope({
      ...scope,
      project: {
        projectRoot: path.join(repositoryRoot, "other"),
        projectName: "other",
        rootIsFallback: false,
        workingCopyRelativePath: "other",
      },
    });
    expect(otherProject).not.toBe(withProject);
  });

  it("跨项目项目集合本身变化使范围哈希失效（与 roots 无关）", () => {
    const project = {
      projectRoot: path.join(repositoryRoot, "app"),
      projectName: "app",
      rootIsFallback: false,
      workingCopyRelativePath: "app",
    };
    const web = {
      projectRoot: path.join(repositoryRoot, "web"),
      projectName: "web",
      rootIsFallback: false,
      workingCopyRelativePath: "web",
    };
    const single = hashOperationScope({
      ...scope,
      project,
      projects: [project],
    });
    const cross = hashOperationScope({
      ...scope,
      project,
      projects: [project, web],
    });
    expect(cross).not.toBe(single);
    // 项目集合顺序不影响哈希（排序后纳入）。
    const crossReordered = hashOperationScope({
      ...scope,
      project,
      projects: [web, project],
    });
    expect(crossReordered).toBe(cross);
  });

  it("以范围和 SVN 状态为依据验证文件操作", () => {
    const unversioned = candidate("src/new.ts");
    expect(asFileOperation("add")).toBe("add");
    expect(asFileOperation("commit")).toBeUndefined();
    expect(
      validateFileOperation([unversioned], "add", ["src/new.ts"], scope),
    ).toEqual([]);
    expect(
      validateFileOperation(
        [candidate("src/changed.ts", { status: "modified" })],
        "add",
        ["src/changed.ts"],
        scope,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("modified 状态不支持 add"),
      ]),
    );
    expect(
      validateFileOperation(
        [unversioned],
        "ignore",
        ["src/new.ts"],
        scope,
        "repository",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("请从仓库根目录右键进入"),
      ]),
    );
  });

  it("为预览令牌提供稳定的状态指纹和安全的 URL 父级", () => {
    const firstScopeHash = hashOperationScope(scope);
    expect(
      hashOperationScope({ ...scope, roots: [...scope.roots].reverse() }),
    ).toBe(firstScopeHash);
    const firstCandidateHash = hashCandidateState(
      [candidate("src/b.ts"), candidate("src/a.ts")],
      "message",
      ["src/b.ts", "src/a.ts"],
    );
    expect(
      hashCandidateState(
        [candidate("src/a.ts"), candidate("src/b.ts")],
        "message",
        ["src/a.ts", "src/b.ts"],
      ),
    ).toBe(firstCandidateHash);
    expect(
      repositoryParentUrl(
        "https://svn.example.test/repo/trunk/src/",
        "https://svn.example.test/repo",
      ),
    ).toBe("https://svn.example.test/repo/trunk");
    expect(
      repositoryParentUrl(
        "https://svn.example.test/repo",
        "https://svn.example.test/repo",
      ),
    ).toBeUndefined();
    expect(parseBlameOutput("  8 alice const value = 1;\n- - local")).toEqual([
      {
        line: 1,
        revision: "8",
        author: "alice",
        content: "const value = 1;",
      },
      { line: 2, revision: "-", author: "-", content: "local" },
    ]);
  });
});
