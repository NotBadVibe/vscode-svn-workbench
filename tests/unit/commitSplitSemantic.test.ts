import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommitSplitAiRequest,
  createLocalCommitSplitResult,
  normalizeCommitSplitResult,
  validateCommitSplitResult,
} from "../../src/ai/commitSplitAi";
import type { CommitCandidate } from "../../src/commit/commitCandidateCollector";
import type { OperationScope } from "../../src/scope/operationScope";

const root = path.resolve("/repo");
const absolute = (relativePath: string) => path.resolve(root, relativePath);
const scope: OperationScope = {
  id: "scope",
  repositoryRoot: root,
  source: "workspace",
  roots: [{ absolutePath: root, relativePath: ".", kind: "folder" }],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};
const candidate = (relativePath: string): CommitCandidate =>
  ({
    absolutePath: absolute(relativePath),
    relativePath,
    status: "modified",
    propStatus: "none",
    fileType: "TypeScript",
    templateGroup: "frontend",
    generatedDecision: "keep",
    selection: "selected",
    reason: "test",
    evaluation: {
      decision: "recommended",
      reasonKey: "statusPolicy",
      statusPolicyKey: "modified",
      safetyLocked: false,
    },
  }) as never;

describe("commitSplitAi 语义拆分（v0.0.12 批次 B）", () => {
  it("元数据分组明确降级：无差异时 purpose 声明未读取正文，dependencies 提示人工核对", () => {
    const request = buildCommitSplitAiRequest(
      scope,
      [candidate("src/a.ts"), candidate("src/b.ts")],
      [absolute("src/a.ts"), absolute("src/b.ts")],
      { userConfirmations: ["确认 a.ts 只影响配置。"] },
    );
    const result = createLocalCommitSplitResult(request);
    expect(result.splits.length).toBeGreaterThan(0);
    expect(result.splits[0].purpose).toContain("按目录/文件类型分组");
    expect(result.splits[0].dependencies?.join("、")).toContain("已确认事实");
    expect(result.splits[0].message).toContain("确认 a.ts 只影响配置。");
  });

  it("语义模式（携带差异）purpose 声明基于受限差异与已确认事实", () => {
    const request = buildCommitSplitAiRequest(
      scope,
      [candidate("src/a.ts")],
      [absolute("src/a.ts")],
      {
        diffs: [
          {
            candidateId: "cand-a",
            projectRelativePath: "src/a.ts",
            content: "@@ -1,1 +1,1 @@\n+新增",
            hunks: [{ hunkId: "h-1", header: "@@ -1,1 +1,1 @@" }],
            truncated: false,
            binary: false,
          },
        ],
      },
    );
    const result = createLocalCommitSplitResult(request);
    expect(result.splits[0].purpose).toContain("受限差异");
  });

  it("normalizeCommitSplitResult 透传 purpose/dependencies", () => {
    const normalized = normalizeCommitSplitResult({
      splits: [
        {
          id: "s1",
          title: "拆分 1",
          summary: "1 个文件",
          message: "feat: x",
          paths: ["a"],
          reason: "r",
          risks: [],
          purpose: "purpose-1",
          dependencies: ["dep-1"],
        },
      ],
      warnings: [],
    });
    expect(normalized.splits[0].purpose).toBe("purpose-1");
    expect(normalized.splits[0].dependencies).toEqual(["dep-1"]);
  });

  it("validateCommitSplitResult 拒绝范围外文件，且同一文件不跨拆分重复", () => {
    const result = validateCommitSplitResult(
      scope,
      {
        splits: [
          {
            id: "s1",
            title: "拆分 1",
            summary: "",
            message: "",
            paths: ["src/a.ts", "outside.ts"],
            reason: "",
            risks: [],
          },
          {
            id: "s2",
            title: "拆分 2",
            summary: "",
            message: "",
            paths: ["src/a.ts", "src/b.ts"],
            reason: "",
            risks: [],
          },
        ],
        warnings: [],
      },
      [absolute("src/a.ts"), absolute("src/b.ts")],
    );
    // s1：a 保留、outside 被拒；s2：a 已被 s1 使用 → 丢弃，b 保留。
    expect(result.splits[0].paths).toEqual([absolute("src/a.ts")]);
    expect(result.splits[1].paths).toEqual([absolute("src/b.ts")]);
  });
});
