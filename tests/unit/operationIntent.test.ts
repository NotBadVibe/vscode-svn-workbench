import { describe, expect, it } from "vitest";
import {
  buildOperationIntentSummary,
  isOperationIntentKind,
  isOperationIntentStale,
  OPERATION_INTENT_ACTION_LABELS,
  OPERATION_INTENT_KINDS,
  operationIntentTitle,
  validateOperationIntentForExecute,
  type OperationIntentView,
} from "../../src/operation/operationIntent";

describe("operationIntentTitle", () => {
  it("提交数量标题", () => {
    expect(operationIntentTitle("commit", 3)).toBe("提交 3 个文件");
    expect(operationIntentTitle("commit", 1)).toBe("提交 1 个文件");
  });
  it("历史恢复标题（V015-C1 新增 kind）", () => {
    expect(operationIntentTitle("history-restore", 1)).toBe(
      "历史恢复 1 个文件",
    );
    expect(isOperationIntentKind("history-restore")).toBe(true);
    expect(OPERATION_INTENT_KINDS).toContain("history-restore");
    expect(OPERATION_INTENT_ACTION_LABELS["history-restore"]).toBe("历史恢复");
  });
  it("还原等标题", () => {
    expect(operationIntentTitle("revert", 2)).toBe("还原 2 个文件");
    expect(operationIntentTitle("delete", 1)).toBe("删除 1 个文件");
    expect(operationIntentTitle("resolve", 1)).toBe("标记解决 1 个冲突");
    expect(operationIntentTitle("update", 5)).toBe("更新 5 个路径");
  });
  it("分支/标签/重定位/合并标题诚实", () => {
    expect(operationIntentTitle("branch", 1)).toBe("创建分支");
    expect(operationIntentTitle("tag", 1)).toBe("创建标签");
    expect(operationIntentTitle("relocate", 1)).toBe("重定位");
    expect(operationIntentTitle("merge", 2)).toBe("合并 2 个路径");
    expect(operationIntentTitle("merge", 1)).toBe("合并 1 个路径");
  });
});

describe("buildOperationIntentSummary", () => {
  it("带范围摘要", () => {
    expect(buildOperationIntentSummary("commit", 2, "项目 A")).toBe(
      "提交 2 个文件 · 范围：项目 A",
    );
  });
  it("无范围摘要", () => {
    expect(buildOperationIntentSummary("delete", 1)).toBe("删除 1 个文件");
  });
});

describe("isOperationIntentStale", () => {
  const base: OperationIntentView = {
    token: "t1",
    kind: "commit",
    title: "提交 1 个文件",
    summary: "提交 1 个文件",
    paths: ["a.txt"],
    scopeHash: "s1",
    candidateHash: "c1",
    repositoryUuid: "r1",
    createdAt: new Date().toISOString(),
    canExecute: true,
    issues: [],
  };
  it("scope 变化失效", () => {
    expect(
      isOperationIntentStale(base, {
        repositoryUuid: "r1",
        scopeHash: "s2",
        candidateHash: "c1",
      }),
    ).toBe(true);
  });
  it("candidate 变化失效", () => {
    expect(
      isOperationIntentStale(base, {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c2",
      }),
    ).toBe(true);
  });
  it("revision 变化失效", () => {
    const withRev: OperationIntentView = { ...base, revision: "100" };
    expect(
      isOperationIntentStale(withRev, {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
        revision: "101",
      }),
    ).toBe(true);
  });
  it("一致时不失效", () => {
    expect(
      isOperationIntentStale(base, {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
      }),
    ).toBe(false);
  });
  it("仓库变化失效", () => {
    expect(
      isOperationIntentStale(base, {
        repositoryUuid: "r2",
        scopeHash: "s1",
        candidateHash: "c1",
      }),
    ).toBe(true);
  });
});

describe("validateOperationIntentForExecute", () => {
  const intent: OperationIntentView = {
    token: "tok",
    kind: "commit",
    title: "提交 1 个文件",
    summary: "提交 1 个文件",
    paths: ["a.txt"],
    scopeHash: "s1",
    candidateHash: "c1",
    repositoryUuid: "r1",
    createdAt: new Date().toISOString(),
    canExecute: true,
    issues: [],
  };
  it("token 不匹配拒绝", () => {
    expect(
      validateOperationIntentForExecute(intent, "bad", {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
      }).ok,
    ).toBe(false);
  });
  it("stale 拒绝", () => {
    const stale: OperationIntentView = { ...intent, stale: true };
    expect(
      validateOperationIntentForExecute(stale, "tok", {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
      }).ok,
    ).toBe(false);
  });
  it("issues 存在拒绝", () => {
    const withIssues: OperationIntentView = {
      ...intent,
      issues: ["存在冲突"],
      canExecute: false,
    };
    expect(
      validateOperationIntentForExecute(withIssues, "tok", {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
      }).ok,
    ).toBe(false);
  });
  it("通过校验", () => {
    expect(
      validateOperationIntentForExecute(intent, "tok", {
        repositoryUuid: "r1",
        scopeHash: "s1",
        candidateHash: "c1",
      }).ok,
    ).toBe(true);
  });
  it("scope 变化 stale 拒绝", () => {
    expect(
      validateOperationIntentForExecute(intent, "tok", {
        repositoryUuid: "r1",
        scopeHash: "s2",
        candidateHash: "c1",
      }).ok,
    ).toBe(false);
  });
});
