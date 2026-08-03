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
  ...overrides,
});

describe("工作台职责拆分后的纯逻辑", () => {
  it("把范围、标题、语言和修订输入规范化为可展示数据", () => {
    expect(toScopeView(scope)).toEqual({
      repositoryName: "repo",
      roots: [{ kind: "folder", relativePath: "src" }],
      source: "editor",
    });
    expect(getModuleTitle("repository", "commit/compose")).toBe(
      "SVN · 更新当前范围",
    );
    expect(inferLanguage("Component.svelte")).toBe("svelte");
    expect(inferLanguage("README")).toBe("text");
    expect(asRevisionArray(["1", "x", 2, "003"])).toEqual(["1", "003"]);
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
