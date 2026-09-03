import { describe, expect, it } from "vitest";
import {
  validateOperationIntentForExecute,
  type OperationIntentView,
} from "../../src/operation/operationIntent";

/**
 * v0.0.14 批次 B Host 层四分支测试（成功 / 失效 token / 候选变化 / 带 issues）
 * 参照 WorkbenchController / RepositoryWorkbenchActions 的通用校验模式：
 * 用 Host 自存预览重建 intent 校验对象，Webview 只作展示。
 * 每种操作各 4 分支，共 13 种操作（commit/resolve/update/property/cleanup/changelist/file-operation/switch/branch/tag/relocate/merge/history-restore，
 * 其中 history-restore 由 Webview 意向单确认、Host 侧仍走 token + contentHash 复验）。
 */

function baseIntent(
  overrides: Partial<OperationIntentView> = {},
): OperationIntentView {
  return {
    token: "tok-1",
    kind: "commit",
    title: "提交 2 个文件",
    summary: "提交 2 个文件",
    paths: ["src/a.ts", "src/b.ts"],
    scopeHash: "scope-1",
    candidateHash: "cand-1",
    repositoryUuid: "repo-1",
    createdAt: new Date().toISOString(),
    canExecute: true,
    issues: [],
    stale: false,
    ...overrides,
  };
}

const current = {
  repositoryUuid: "repo-1",
  scopeHash: "scope-1",
  candidateHash: "cand-1",
};

describe("Host 通用意向单校验四分支（13 操作）", () => {
  const cases: Array<{
    kind: OperationIntentView["kind"];
    title: string;
    paths: string[];
  }> = [
    { kind: "commit", title: "提交 2 个文件", paths: ["src/a.ts", "src/b.ts"] },
    { kind: "resolve", title: "标记解决 1 个冲突", paths: ["src/conflict.ts"] },
    { kind: "update", title: "更新 2 个远端变更", paths: ["src/overlap.ts"] },
    {
      kind: "property",
      title: "修改属性 svn:ignore（1 个路径）",
      paths: ["./"],
    },
    { kind: "cleanup", title: "清理工作副本", paths: ["/wc"] },
    {
      kind: "changelist-apply",
      title: "应用变更集到 2 个文件",
      paths: ["src/a.ts", "src/b.ts"],
    },
    { kind: "file-operation", title: "还原 1 个文件", paths: ["src/a.ts"] },
    {
      kind: "switch",
      title: "切换工作副本到 feature",
      paths: ["https://svn.example/branches/feature"],
    },
    {
      kind: "branch",
      title: "创建分支",
      paths: ["https://svn.example/branches/next"],
    },
    {
      kind: "tag",
      title: "创建标签",
      paths: ["https://svn.example/tags/v1.0"],
    },
    {
      kind: "relocate",
      title: "重定位",
      paths: ["https://svn.example/new-root"],
    },
    { kind: "merge", title: "合并 2 个路径", paths: ["src/a.ts", "src/b.ts"] },
    {
      kind: "history-restore",
      title: "历史恢复 1 个文件",
      paths: ["src/extension.ts"],
    },
  ];

  for (const c of cases) {
    describe(c.kind, () => {
      it("成功：token 匹配且候选一致", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
        });
        expect(
          validateOperationIntentForExecute(intent, "tok-1", current).ok,
        ).toBe(true);
      });
      it("失效 token：token 不匹配", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
        });
        const res = validateOperationIntentForExecute(
          intent,
          "bad-token",
          current,
        );
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("已失效");
      });
      it("候选变化：candidateHash 不一致", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
          candidateHash: "cand-1",
        });
        const res = validateOperationIntentForExecute(intent, "tok-1", {
          ...current,
          candidateHash: "cand-2",
        });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("只读失效");
      });
      it("带 issues：canExecute 为 false 或 issues 非空", () => {
        const intent = baseIntent({
          kind: c.kind,
          title: c.title,
          paths: c.paths,
          canExecute: false,
          issues: ["存在未解决校验"],
        });
        const res = validateOperationIntentForExecute(intent, "tok-1", current);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.reason).toContain("校验问题");
      });
    });
  }

  describe("scope 变化", () => {
    it("scopeHash 不一致视为 stale", () => {
      const intent = baseIntent({ scopeHash: "scope-1" });
      const res = validateOperationIntentForExecute(intent, "tok-1", {
        ...current,
        scopeHash: "scope-2",
      });
      expect(res.ok).toBe(false);
    });
  });

  describe("stale 标记", () => {
    it("intent.stale 为 true 时直接失效", () => {
      const intent = baseIntent({ stale: true });
      const res = validateOperationIntentForExecute(intent, "tok-1", current);
      expect(res.ok).toBe(false);
    });
  });
});
