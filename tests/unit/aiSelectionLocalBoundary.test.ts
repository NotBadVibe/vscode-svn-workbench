/**
 * enforceAiSelectionLocalBoundary 单元测试（v0.0.3 阶段 2，规划 5.2、5.5）：
 * AI 只能在 recommended 与 needsReview 之间调整；本地阻止项、强制排除项
 * （ignored/external）与用户明确配置的排除项不得被 AI 提升为推荐，
 * 违规条目丢弃并计入警告。
 */
import { describe, expect, it } from "vitest";
import {
  enforceAiSelectionLocalBoundary,
  type AiSelectionLocalBoundaryCandidate,
} from "../../src/ai/aiResultValidator";
import { getBuiltinCommitSelectionEvaluator } from "../../src/commit/commitSelectionRuleEvaluator";
import type { CommitSelectionExplanation } from "../../src/commit/commitSelectionRules";
import type { AiSelectionResult } from "../../src/ai/aiProvider";

const candidate = (
  relativePath: string,
  evaluation: CommitSelectionExplanation,
): AiSelectionLocalBoundaryCandidate => ({
  absolutePath: `/repo/${relativePath}`,
  relativePath,
  evaluation,
});

const evaluation = (
  decision: CommitSelectionExplanation["decision"],
  overrides: Partial<CommitSelectionExplanation> = {},
): CommitSelectionExplanation => ({
  decision,
  reasonKey: "statusPolicy",
  safetyLocked: false,
  ...overrides,
});

const emptyResult = (): AiSelectionResult => ({
  recommended: [],
  excluded: [],
  needsReview: [],
  blocked: [],
});

describe("AI 本地边界：可调整空间", () => {
  it("本地 needsReview 可被 AI 提升为推荐，recommended 保持推荐，均无警告", () => {
    const candidates = [
      candidate("src/review.ts", evaluation("needsReview")),
      candidate("src/ok.ts", evaluation("recommended")),
    ];
    const result = emptyResult();
    result.recommended.push(
      { path: "/repo/src/review.ts", reason: "确认后应提交" },
      { path: "/repo/src/ok.ts", reason: "常规变更" },
    );

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.violations).toEqual([]);
    expect(boundary.result.recommended).toHaveLength(2);
  });

  it("不在候选集合中的推荐条目保持原样（由范围/候选校验负责）", () => {
    const result = emptyResult();
    result.recommended.push({ path: "/repo/other.ts", reason: "未知候选" });

    const boundary = enforceAiSelectionLocalBoundary([], result);

    expect(boundary.violations).toEqual([]);
    expect(boundary.result.recommended).toHaveLength(1);
  });

  it("AI 的 needsReview、excluded、blocked 列表不受边界限制", () => {
    const candidates = [
      candidate("src/ok.ts", evaluation("recommended")),
      candidate(
        "src/conflicted.ts",
        evaluation("blocked", {
          reasonKey: "safetyBlocked",
          safetyLocked: true,
        }),
      ),
    ];
    const result = emptyResult();
    result.needsReview.push({ path: "/repo/src/ok.ts", reason: "降级待确认" });
    result.excluded.push({ path: "/repo/src/ok.ts", reason: "排除" });
    result.blocked.push({ path: "/repo/src/conflicted.ts", reason: "冲突" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.violations).toEqual([]);
    expect(boundary.result.needsReview).toHaveLength(1);
    expect(boundary.result.excluded).toHaveLength(1);
    expect(boundary.result.blocked).toHaveLength(1);
  });
});

describe("AI 本地边界：不可提升", () => {
  it("本地阻止项（safetyBlocked）不得推荐，丢弃并警告", () => {
    const candidates = [
      candidate(
        "src/conflicted.ts",
        evaluation("blocked", {
          reasonKey: "safetyBlocked",
          safetyLocked: true,
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({
      path: "/repo/src/conflicted.ts",
      reason: "AI 误判",
    });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations).toHaveLength(1);
    expect(boundary.violations[0]).toContain("src/conflicted.ts");
    expect(boundary.violations[0]).toContain("阻止项");
  });

  it("external 强制排除不得推荐", () => {
    const candidates = [
      candidate(
        "libs/external",
        evaluation("excluded", {
          reasonKey: "safetyExternal",
          safetyLocked: true,
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({ path: "/repo/libs/external", reason: "AI 误判" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations[0]).toContain("external");
  });

  it("ignored 强制排除不得推荐", () => {
    const candidates = [
      candidate(
        "temp.swp",
        evaluation("excluded", {
          reasonKey: "safetyIgnored",
          safetyLocked: true,
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({ path: "/repo/temp.swp", reason: "AI 误判" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations[0]).toContain("ignored");
  });

  it("用户配置的排除路径规则不得推荐，警告包含规则 ID 与来源语义", () => {
    for (const source of ["user", "workspace", "repository"] as const) {
      const candidates = [
        candidate(
          "vendor/lib.js",
          evaluation("excluded", {
            reasonKey: "pathRule",
            matchedRuleId: "team-vendor",
            ruleSource: source,
          }),
        ),
      ];
      const result = emptyResult();
      result.recommended.push({
        path: "/repo/vendor/lib.js",
        reason: "AI 误判",
      });

      const boundary = enforceAiSelectionLocalBoundary(candidates, result);

      expect(boundary.result.recommended).toHaveLength(0);
      expect(boundary.violations[0]).toContain("team-vendor");
      expect(boundary.violations[0]).toContain("用户配置的排除规则");
    }
  });

  it("用户配置路径规则的 matchedRuleId 缺失时警告仍成立", () => {
    const candidates = [
      candidate(
        "vendor/lib.js",
        evaluation("excluded", {
          reasonKey: "pathRule",
          ruleSource: "repository",
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({ path: "/repo/vendor/lib.js", reason: "AI 误判" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations[0]).toContain("用户配置的排除规则");
  });

  it("内置排除规则同样不可提升（AI 只能在 recommended 与 needsReview 之间调整）", () => {
    const candidates = [
      candidate(
        "dist/app.js",
        evaluation("excluded", {
          reasonKey: "pathRule",
          matchedRuleId: "generated-dist",
          ruleSource: "builtin",
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({ path: "/repo/dist/app.js", reason: "AI 误判" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations[0]).toContain("内置排除规则");
  });

  it("状态策略排除不得推荐", () => {
    const candidates = [
      candidate(
        "src/normal.ts",
        evaluation("excluded", {
          reasonKey: "statusPolicy",
          statusPolicyKey: "normal",
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push({ path: "/repo/src/normal.ts", reason: "AI 误判" });

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations[0]).toContain("状态策略");
  });

  it("多条违规逐条计入警告，合规推荐保留", () => {
    const candidates = [
      candidate("src/ok.ts", evaluation("needsReview")),
      candidate(
        "src/conflicted.ts",
        evaluation("blocked", {
          reasonKey: "safetyBlocked",
          safetyLocked: true,
        }),
      ),
      candidate(
        "dist/app.js",
        evaluation("excluded", {
          reasonKey: "pathRule",
          matchedRuleId: "generated-dist",
          ruleSource: "builtin",
        }),
      ),
    ];
    const result = emptyResult();
    result.recommended.push(
      { path: "/repo/src/ok.ts", reason: "可提升" },
      { path: "/repo/src/conflicted.ts", reason: "违规" },
      { path: "/repo/dist/app.js", reason: "违规" },
    );

    const boundary = enforceAiSelectionLocalBoundary(candidates, result);

    expect(boundary.result.recommended.map((item) => item.path)).toEqual([
      "/repo/src/ok.ts",
    ]);
    expect(boundary.violations).toHaveLength(2);
  });
});

describe("V003-CR-01：AI 不得把 propStatus 冲突候选改为推荐", () => {
  it("normal + propStatus=conflicted 的本地结论为安全阻止，AI 推荐被丢弃并警告", () => {
    // 使用真实评估器产出本地结论，验证 (status, propStatus) 安全契约贯穿到 AI 边界。
    const propConflictEvaluation =
      getBuiltinCommitSelectionEvaluator().evaluate({
        relativePath: "src/prop-conflicted.ts",
        status: "normal",
        propStatus: "conflicted",
      });
    expect(propConflictEvaluation).toMatchObject({
      decision: "blocked",
      reasonKey: "safetyBlocked",
      safetyLocked: true,
    });

    const result = emptyResult();
    result.recommended.push({
      path: "/repo/src/prop-conflicted.ts",
      reason: "AI 误判",
    });

    const boundary = enforceAiSelectionLocalBoundary(
      [candidate("src/prop-conflicted.ts", propConflictEvaluation)],
      result,
    );

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations).toHaveLength(1);
    expect(boundary.violations[0]).toContain("src/prop-conflicted.ts");
    expect(boundary.violations[0]).toContain("阻止项");
  });

  it("modified + propStatus=conflicted 同样不得被 AI 推荐", () => {
    const propConflictEvaluation =
      getBuiltinCommitSelectionEvaluator().evaluate({
        relativePath: "src/modified-prop-conflicted.ts",
        status: "modified",
        propStatus: "conflicted",
      });
    expect(propConflictEvaluation.decision).toBe("blocked");

    const result = emptyResult();
    result.recommended.push({
      path: "/repo/src/modified-prop-conflicted.ts",
      reason: "AI 误判",
    });

    const boundary = enforceAiSelectionLocalBoundary(
      [candidate("src/modified-prop-conflicted.ts", propConflictEvaluation)],
      result,
    );

    expect(boundary.result.recommended).toHaveLength(0);
    expect(boundary.violations).toHaveLength(1);
    expect(boundary.violations[0]).toContain("阻止项");
  });

  it("仅属性变化（normal + modified）不在边界限制内，AI 推荐保留", () => {
    const propOnlyEvaluation = getBuiltinCommitSelectionEvaluator().evaluate({
      relativePath: "src/prop-only.ts",
      status: "normal",
      propStatus: "modified",
    });
    expect(propOnlyEvaluation).toMatchObject({
      decision: "recommended",
      statusPolicyKey: "propertyModified",
      safetyLocked: false,
    });

    const result = emptyResult();
    result.recommended.push({
      path: "/repo/src/prop-only.ts",
      reason: "属性变化应提交",
    });

    const boundary = enforceAiSelectionLocalBoundary(
      [candidate("src/prop-only.ts", propOnlyEvaluation)],
      result,
    );

    expect(boundary.violations).toEqual([]);
    expect(boundary.result.recommended).toHaveLength(1);
  });
});
