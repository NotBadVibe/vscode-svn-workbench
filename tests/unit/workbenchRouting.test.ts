import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertServedModuleRequest,
  buildCrossModuleWindowRequest,
  buildDiffWindowRequest,
  buildDiffTargetKey,
  normalizeDiffOpenMode,
  orderRevisionPair,
  shouldOpenInOtherWindow,
  workbenchRevealTarget,
} from "../../src/extension/workbench/workbenchRouting";
import type { OperationScope } from "../../src/scope/operationScope";

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

describe("统一模块窗口路由", () => {
  it("目标模块不属于当前服务模块且注入回调时转发，未注入时保持面板内切换", () => {
    const callback = () => undefined;
    // diff 服务窗口收到 diff 请求留在当前窗口
    expect(shouldOpenInOtherWindow("diff", "diff", callback)).toBe(false);
    // 其他模块窗口收到 diff 请求转发到独立 Diff 窗口
    expect(shouldOpenInOtherWindow("diff", "changes", callback)).toBe(true);
    expect(shouldOpenInOtherWindow("diff", "changes", undefined)).toBe(false);
    // 同模块任务导航留在当前窗口
    expect(shouldOpenInOtherWindow("commit", "commit", callback)).toBe(false);
    // 跨模块（如 Changes → Commit）转发
    expect(shouldOpenInOtherWindow("commit", "changes", callback)).toBe(true);
  });

  it("构造的 Diff 窗口会话请求固定为 diff 模块与默认任务", () => {
    expect(
      buildDiffWindowRequest({
        svnPath: "svn",
        scope,
        targetFile: path.join(repositoryRoot, "src/a.ts"),
      }),
    ).toEqual({
      moduleId: "diff",
      taskId: "diff/working",
      svnPath: "svn",
      scope,
      targetFile: path.join(repositoryRoot, "src/a.ts"),
      revisionCompare: undefined,
    });

    expect(
      buildDiffWindowRequest({
        svnPath: "svn",
        scope,
        revisionCompare: { revisions: ["3", "9"] },
      }).revisionCompare,
    ).toEqual({ revisions: ["3", "9"] });
  });

  it("控制器防御：非本模块会话请求在未接线时拒绝", () => {
    expect(() =>
      assertServedModuleRequest(
        buildDiffWindowRequest({ svnPath: "svn", scope }),
        "diff",
      ),
    ).not.toThrow();
    expect(() =>
      assertServedModuleRequest(
        buildCrossModuleWindowRequest({
          moduleId: "commit",
          taskId: "commit/compose",
          svnPath: "svn",
          scope,
        }),
        "diff",
      ),
    ).toThrowError(/diff 模块窗口仅处理 diff 模块会话/);
  });

  it("跨模块窗口请求保留源窗口的模块、任务与选择", () => {
    expect(
      buildCrossModuleWindowRequest({
        moduleId: "commit",
        taskId: "commit/compose",
        svnPath: "svn",
        scope,
        selectedPaths: ["src/a.ts"],
      }),
    ).toEqual({
      moduleId: "commit",
      taskId: "commit/compose",
      svnPath: "svn",
      scope,
      selectedPaths: ["src/a.ts"],
    });
  });

  it("非 Diff 模块保持第一栏；Diff 默认同组聚焦，也可旁侧聚焦", () => {
    expect(workbenchRevealTarget(false)).toEqual({
      viewColumn: "one",
      preserveFocus: false,
    });
    expect(workbenchRevealTarget(true)).toEqual({
      viewColumn: "active",
      preserveFocus: false,
    });
    expect(workbenchRevealTarget(true, "beside")).toEqual({
      viewColumn: "beside",
      preserveFocus: false,
    });
    expect(normalizeDiffOpenMode("beside")).toBe("beside");
    expect(normalizeDiffOpenMode("invalid")).toBe("sameGroup");
  });

  it("同一 Diff 目标生成稳定摘要，文件或修订变化会失效", () => {
    const first = buildDiffTargetKey({
      moduleId: "diff",
      svnPath: "svn",
      scope,
      targetFile: path.join(repositoryRoot, "src/a.ts"),
    });
    expect(
      buildDiffTargetKey({
        moduleId: "diff",
        svnPath: "svn",
        scope,
        targetFile: path.join(repositoryRoot, "src/a.ts"),
      }),
    ).toBe(first);
    expect(
      buildDiffTargetKey({
        moduleId: "diff",
        svnPath: "svn",
        scope,
        targetFile: path.join(repositoryRoot, "src/b.ts"),
      }),
    ).not.toBe(first);
  });

  it("修订比较统一按升序排列", () => {
    expect(orderRevisionPair(["9", "3"])).toEqual(["3", "9"]);
    expect(orderRevisionPair(["3", "9"])).toEqual(["3", "9"]);
  });
});
