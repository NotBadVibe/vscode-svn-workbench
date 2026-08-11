import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertDiffModuleRequest,
  buildDiffWindowRequest,
  buildMainWindowRequest,
  buildDiffTargetKey,
  normalizeDiffOpenMode,
  orderRevisionPair,
  shouldForwardToDiffWindow,
  workbenchRevealTarget,
} from "../../src/extension/workbench/diffWindowRouting";
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

describe("Diff 独立窗口路由", () => {
  it("注入 Diff 窗口回调时转发 diff 请求，未注入时保持面板内切换", () => {
    const callback = () => undefined;
    expect(shouldForwardToDiffWindow("diff", callback)).toBe(true);
    expect(shouldForwardToDiffWindow("diff", undefined)).toBe(false);
    expect(shouldForwardToDiffWindow("commit", callback)).toBe(false);
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

  it("独立 Diff 窗口拒绝非 diff 模块会话请求", () => {
    expect(() =>
      assertDiffModuleRequest(
        buildDiffWindowRequest({ svnPath: "svn", scope }),
      ),
    ).not.toThrow();
    expect(() =>
      assertDiffModuleRequest(
        buildMainWindowRequest({
          moduleId: "commit",
          taskId: "commit/compose",
          svnPath: "svn",
          scope,
        }),
      ),
    ).toThrowError(/独立 Diff 窗口仅处理 diff 模块会话/);
  });

  it("Diff 窗口转发其他模块请求回主工作台时保留任务与选择", () => {
    expect(
      buildMainWindowRequest({
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

  it("主工作台保持第一栏；Diff 默认同组聚焦，也可旁侧聚焦", () => {
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
