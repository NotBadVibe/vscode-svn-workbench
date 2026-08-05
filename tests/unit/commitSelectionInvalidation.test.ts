/**
 * 规则变化后的 Host 侧失效链路测试（v0.0.3 阶段 2，阶段 4 补充，规划 7.4、8）：
 * 失效事件命中当前会话仓库时，清除旧提交预览与 AI 选择结果缓存，
 * 但不触碰用户已手动确认的提交篮选择状态；不匹配的事件不影响会话。
 * 阶段 4 补充：命中时写入提交页“规则已更新”一次性反馈，
 * 并清除基于旧分类的 Changelist 拆分建议与预览。
 */
import { describe, expect, it } from "vitest";
import { applyCommitSelectionRulesInvalidation } from "../../src/extension/workbench/commitSelectionInvalidation";
import type { WorkbenchSession } from "../../src/extension/workbench/workbenchSession";
import type { OperationScope } from "../../src/scope/operationScope";

function createSession(repositoryRoot: string): WorkbenchSession {
  const scope: OperationScope = {
    id: "scope",
    repositoryRoot,
    source: "workspace",
    roots: [{ absolutePath: repositoryRoot, relativePath: "", kind: "folder" }],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
  return {
    moduleId: "commit",
    taskId: "commit/compose",
    svnPath: "svn",
    scope,
    scopeView: { repositoryName: "repo", roots: [], source: "workspace" },
    repositoryUuid: "uuid-1",
    scopeHash: "scope-hash",
    aiModels: {},
    security: { hasStoredAuthentication: false },
    commitState: {
      message: "feat: 手动编写的提交说明",
      selectedPaths: ["src/manual-pick.ts"],
      preview: {
        token: "token-1",
        stateHash: "state-hash",
        plan: {} as never,
        view: {} as never,
      },
      ai: {
        source: "configured-model",
        summary: "建议选择 1 个文件",
        warnings: [],
      },
    },
    changelistState: {
      suggestions: [
        {
          id: "split-1",
          title: "基于旧分类的拆分建议",
          summary: "summary",
          message: "feat: split",
          paths: ["src/a.ts"],
          reason: "reason",
          risks: [],
        },
      ],
      warnings: [],
      source: "configured-model",
      preview: {
        token: "cl-preview",
        candidateHash: "hash",
        remove: false,
        paths: ["src/a.ts"],
        issues: [],
      },
    },
  };
}

describe("applyCommitSelectionRulesInvalidation", () => {
  it("命中当前会话仓库：清除提交预览与 AI 结果，保留手动选择与提交说明", () => {
    const session = createSession("/repo-a");

    const applied = applyCommitSelectionRulesInvalidation(session, "/repo-a");

    expect(applied).toBe(true);
    expect(session.commitState?.preview).toBeUndefined();
    expect(session.commitState?.ai).toBeUndefined();
    expect(session.commitState?.selectedPaths).toEqual(["src/manual-pick.ts"]);
    expect(session.commitState?.message).toBe("feat: 手动编写的提交说明");
  });

  it("命中时设置提交页规则更新提示（一次性反馈）", () => {
    const session = createSession("/repo-a");

    applyCommitSelectionRulesInvalidation(session, "/repo-a");

    expect(session.commitState?.feedback).toEqual({
      tone: "warning",
      message:
        "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
    });
  });

  it("命中时清除基于旧分类的 Changelist 拆分建议与预览", () => {
    const session = createSession("/repo-a");

    applyCommitSelectionRulesInvalidation(session, "/repo-a");

    expect(session.changelistState?.suggestions).toEqual([]);
    expect(session.changelistState?.preview).toBeUndefined();
    expect(session.changelistState?.feedback).toContain("提交选择规则已更新");
  });

  it("全量失效（无仓库标识）同样命中当前会话", () => {
    const session = createSession("/repo-a");

    const applied = applyCommitSelectionRulesInvalidation(session, undefined);

    expect(applied).toBe(true);
    expect(session.commitState?.preview).toBeUndefined();
    expect(session.commitState?.ai).toBeUndefined();
    expect(session.commitState?.selectedPaths).toEqual(["src/manual-pick.ts"]);
  });

  it("其他仓库的失效事件不影响当前会话", () => {
    const session = createSession("/repo-a");

    const applied = applyCommitSelectionRulesInvalidation(session, "/repo-b");

    expect(applied).toBe(false);
    expect(session.commitState?.preview).toBeDefined();
    expect(session.commitState?.ai).toBeDefined();
    expect(session.commitState?.feedback).toBeUndefined();
    expect(session.changelistState?.suggestions).toHaveLength(1);
  });

  it("无提交状态时不抛错，仅报告命中", () => {
    const session = createSession("/repo-a");
    session.commitState = undefined;

    const applied = applyCommitSelectionRulesInvalidation(session, "/repo-a");

    expect(applied).toBe(true);
    expect(session.commitState).toBeUndefined();
  });

  it("路径形式不同但指向同一仓库时仍命中", () => {
    const session = createSession("/repo-a");

    const applied = applyCommitSelectionRulesInvalidation(
      session,
      "/repo-a/sub/..",
    );

    expect(applied).toBe(true);
    expect(session.commitState?.preview).toBeUndefined();
  });
});
