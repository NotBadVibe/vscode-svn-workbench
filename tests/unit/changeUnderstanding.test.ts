import { describe, expect, it } from "vitest";
import {
  buildDraftProposalFromConfirmations,
  buildUserConfirmedFact,
  isUnderstandingSnapshotStale,
  markConfirmationsNeedsReview,
  mergeUnderstandingResults,
  type EvidenceBackedChange,
  type EvidenceBackedFinding,
  type UserConfirmedFact,
} from "../../src/understanding/changeUnderstanding";

/*
 * v0.0.12 批次 A：变更解读领域逻辑 —— 本地/模型/用户合并、来源逐条标记、
 * 本地硬阻止不被模型降级、确认会话内与待复核、快照时效。
 */

const emptyLocal = {
  changes: [],
  findings: [],
  verification: [],
  limitations: [],
};

const localChange: EvidenceBackedChange = {
  id: "local-1",
  statement: "修改了 1 个文件：a.ts。",
  source: "local-rule",
  status: "inferred",
  confidenceReason: "仅基于文件信息。",
  evidence: [],
  invalidEvidence: [],
  limitations: ["无法判断具体业务行为。"],
  nextAction: "运行受限差异分析。",
};

const modelChange: EvidenceBackedChange = {
  id: "model-1",
  statement: "a.ts：调整了登录超时阈值。",
  source: "configured-model",
  status: "confirmed",
  confidenceReason: "证据为差异块。",
  evidence: [
    {
      candidateId: "cand-a",
      hunkId: "hunk-1",
      projectRelativePath: "a.ts",
    },
  ],
  invalidEvidence: [],
  limitations: [],
  nextAction: "打开证据核对。",
};

const blockedFinding: EvidenceBackedFinding = {
  id: "local-blocked-1",
  category: "local-blocked",
  statement: "检测到敏感信息。",
  source: "local-rule",
  severity: "critical",
  consequence: "可能泄露凭据。",
  evidence: [],
  invalidEvidence: [],
  limitations: [],
  nextAction: "补充 ignore 规则。",
};

describe("mergeUnderstandingResults（本地/模型合并与来源）", () => {
  it("仅本地：来源 local-rule，模型段为空", () => {
    const merged = mergeUnderstandingResults({
      local: { ...emptyLocal, changes: [localChange] },
      userConfirmations: [],
    });
    expect(merged.source).toBe("local-rule");
    expect(merged.parts.changes).toHaveLength(1);
    expect(merged.warnings).toEqual([]);
  });

  it("本地 + 模型：混合来源，changes 本地在前、同陈述去重", () => {
    const merged = mergeUnderstandingResults({
      local: { ...emptyLocal, changes: [localChange] },
      model: {
        parts: { ...emptyLocal, changes: [modelChange] },
        source: "configured-model",
      },
      userConfirmations: [],
    });
    expect(merged.source).toBe("mixed");
    expect(merged.parts.changes.map((item) => item.id)).toEqual([
      "local-1",
      "model-1",
    ]);
  });

  it("本地硬阻止项始终在最前，模型无法把它降级", () => {
    const merged = mergeUnderstandingResults({
      local: {
        changes: [],
        findings: [blockedFinding],
        verification: [],
        limitations: [],
      },
      model: {
        parts: {
          changes: [],
          findings: [
            {
              id: "model-f1",
              category: "model",
              statement: "模型认为敏感信息可忽略。",
              source: "configured-model",
              severity: "note",
              consequence: "",
              evidence: [],
              invalidEvidence: [],
              limitations: [],
              nextAction: "",
            },
          ],
          verification: [],
          limitations: [],
        },
        source: "configured-model",
      },
      userConfirmations: [],
    });
    expect(merged.parts.findings[0].id).toBe("local-blocked-1");
    expect(merged.parts.findings[0].source).toBe("local-rule");
    expect(merged.parts.findings[1].source).toBe("configured-model");
  });

  it("模型本地回退：来源 local-rule-fallback 并给出警告", () => {
    const merged = mergeUnderstandingResults({
      local: emptyLocal,
      model: { parts: emptyLocal, source: "local-rule-fallback" },
      userConfirmations: [],
    });
    expect(merged.source).toBe("local-rule-fallback");
    expect(merged.warnings.some((w) => w.includes("本地回退"))).toBe(true);
  });
});

describe("用户确认（会话内 + 待复核）", () => {
  it("buildUserConfirmedFact 绑定当前候选 hash", () => {
    const fact = buildUserConfirmedFact({
      statement: "确认 a.ts 只影响配置。",
      candidateHash: "hash-1",
      now: "2026-08-18T00:00:00.000Z",
    });
    expect(fact.statement).toBe("确认 a.ts 只影响配置。");
    expect(fact.candidateHash).toBe("hash-1");
    expect(fact.needsReview).toBe(false);
  });

  it("候选变化后确认标记待复核，绝不静默沿用", () => {
    const facts: UserConfirmedFact[] = [
      {
        id: "u1",
        statement: "确认 a.ts。",
        confirmedAt: "2026-08-18T00:00:00.000Z",
        candidateHash: "hash-1",
        needsReview: false,
      },
    ];
    const marked = markConfirmationsNeedsReview(facts, "hash-2");
    expect(marked[0].needsReview).toBe(true);
    // 原数组不被修改（纯函数）。
    expect(facts[0].needsReview).toBe(false);
  });

  it("buildDraftProposalFromConfirmations：待复核确认不进入草稿", () => {
    const facts: UserConfirmedFact[] = [
      {
        id: "u1",
        statement: "已核对事实 A。",
        confirmedAt: "2026-08-18T00:00:00.000Z",
        candidateHash: "h",
        needsReview: false,
      },
      {
        id: "u2",
        statement: "待复核事实 B。",
        confirmedAt: "2026-08-18T00:00:00.000Z",
        candidateHash: "old",
        needsReview: true,
      },
    ];
    const proposal = buildDraftProposalFromConfirmations(facts, "app");
    expect(proposal?.confirmedFacts).toEqual(["已核对事实 A。"]);
    expect(proposal?.message).toContain("已核对事实 A。");
    expect(proposal?.message).not.toContain("待复核事实 B。");
  });
});

describe("isUnderstandingSnapshotStale（快照时效）", () => {
  const binding = {
    repositoryUuid: "uuid",
    scopeHash: "s1",
    candidateHash: "c1",
    revision: "7",
    generatedAt: "2026-08-18T00:00:00.000Z",
  };
  it("scope/候选/revision 任一变化即过期", () => {
    expect(
      isUnderstandingSnapshotStale({
        binding,
        currentScopeHash: "s2",
        currentCandidateHash: "c1",
        currentRevision: "7",
      }),
    ).toBe(true);
    expect(
      isUnderstandingSnapshotStale({
        binding,
        currentScopeHash: "s1",
        currentCandidateHash: "c2",
        currentRevision: "7",
      }),
    ).toBe(true);
    expect(
      isUnderstandingSnapshotStale({
        binding,
        currentScopeHash: "s1",
        currentCandidateHash: "c1",
        currentRevision: "8",
      }),
    ).toBe(true);
  });
  it("全部一致不过期；无 binding 不过期", () => {
    expect(
      isUnderstandingSnapshotStale({
        binding,
        currentScopeHash: "s1",
        currentCandidateHash: "c1",
        currentRevision: "7",
      }),
    ).toBe(false);
    expect(
      isUnderstandingSnapshotStale({
        binding: undefined,
        currentScopeHash: "s1",
        currentCandidateHash: "c1",
        currentRevision: "7",
      }),
    ).toBe(false);
  });
});
