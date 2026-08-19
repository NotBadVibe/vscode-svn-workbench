/**
 * v0.0.12 批次 A：本地检查适配层 —— 复用 v0.0.1/v0.0.9 的本地变更检查
 * 与影响分析（changeIntelligence），把输出映射为变更解读的 changes/
 * findings/verification（来源 local-rule；不声称理解具体行为）。
 */

import {
  buildLocalChangeReview,
  buildLocalImpactAnalysis,
} from "../ai/changeIntelligence";
import type { CommitCandidate } from "../commit/commitCandidateCollector";
import {
  buildCandidateId,
  type CommitDiffFragment,
  type EvidenceReference,
} from "../commit/commitDiffEvidence";
import type {
  EvidenceBackedChange,
  EvidenceBackedFinding,
  UnderstandingResultParts,
  VerificationSuggestion,
} from "./changeUnderstanding";

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  note: 2,
};

/**
 * 构建本地检查结果段：
 * - changes：结构性陈述（“N 个文件被修改/新增/删除”），有差异证据时
 *   标记 confirmed 并附证据，否则 inferred（明确“基于文件信息”）；
 * - findings：复用本地变更检查的敏感/调试/生成物/测试发现（本地硬项
 *   永不因模型而降级）；
 * - verification：复用影响分析的测试建议（通用门禁）。
 */
export async function buildLocalUnderstandingParts(input: {
  candidates: CommitCandidate[];
  fragments?: CommitDiffFragment[];
  scopeText: string;
  repositoryRoot: string;
}): Promise<UnderstandingResultParts> {
  const review = await buildLocalChangeReview(input.candidates);
  const impact = buildLocalImpactAnalysis(input.candidates);
  const changes = buildStructuralChanges(
    input.candidates,
    input.fragments,
    input.repositoryRoot,
  );
  const findings = review.findings
    .map((item) => toFinding(item, input.fragments))
    .sort(
      (left, right) =>
        (SEVERITY_ORDER[left.severity] ?? 9) -
        (SEVERITY_ORDER[right.severity] ?? 9),
    );
  const verification = impact.tests.map((test): VerificationSuggestion => ({
    id: `verify-${test.title}`,
    title: test.title,
    reason: test.reason,
    command: test.command,
    gate: "general",
  }));
  const limitations = [
    ...(input.fragments === undefined
      ? [
          "本地检查基于文件信息与统计，未读取差异正文；具体行为需模型或人工核对。",
        ]
      : []),
    ...impact.observations,
    ...review.warnings,
  ];
  return { changes, findings, verification, limitations };
}

/** 结构性“改了什么”：按状态分组，有差异证据时 confirmed。 */
function buildStructuralChanges(
  candidates: CommitCandidate[],
  fragments: CommitDiffFragment[] | undefined,
  repositoryRoot: string,
): EvidenceBackedChange[] {
  const byStatus = new Map<string, CommitCandidate[]>();
  for (const candidate of candidates) {
    if (candidate.selection === "blocked") continue;
    const list = byStatus.get(candidate.status) ?? [];
    list.push(candidate);
    byStatus.set(candidate.status, list);
  }
  const statusLabel: Record<string, string> = {
    modified: "修改",
    added: "新增",
    deleted: "删除",
    missing: "缺失",
    replaced: "替换",
    unversioned: "未纳入版本控制",
  };
  const fragmentById = new Map(
    (fragments ?? []).map((fragment) => [fragment.candidateId, fragment]),
  );
  const changes: EvidenceBackedChange[] = [];
  for (const [status, list] of byStatus) {
    const paths = list.slice(0, 5).map((item) => item.relativePath);
    const suffix = list.length > 5 ? ` 等 ${list.length} 个文件` : "";
    const evidence: EvidenceReference[] = [];
    for (const candidate of list) {
      const fragment = fragmentById.get(
        buildCandidateId(repositoryRoot, candidate.absolutePath),
      );
      if (!fragment || fragment.hunks.length === 0) continue;
      evidence.push({
        candidateId: fragment.candidateId,
        hunkId: fragment.hunks[0].hunkId,
        projectRelativePath: fragment.projectRelativePath,
      });
    }
    const label = statusLabel[status] ?? status;
    const hasEvidence = evidence.length > 0;
    changes.push({
      id: `local-${status}`,
      statement: `${label}了 ${list.length} 个文件：${paths.join("、")}${suffix}。`,
      source: "local-rule",
      status: hasEvidence ? "confirmed" : "inferred",
      confidenceReason: hasEvidence
        ? "差异正文已本地核对，证据为逐文件差异块。"
        : "仅基于文件信息与统计，未读取差异正文。",
      evidence,
      invalidEvidence: [],
      limitations: hasEvidence ? [] : ["无法判断具体业务行为，仅结构归类。"],
      nextAction: hasEvidence
        ? "打开证据核对具体改动。"
        : "运行受限差异分析以绑定证据。",
    });
  }
  return changes;
}

/** 本地检查发现 → 变更解读 finding（本地来源，绝不因模型而降级）。 */
function toFinding(
  item: {
    id: string;
    severity: "critical" | "warning" | "note";
    category: string;
    relativePath?: string;
    title: string;
    evidence: string;
    recommendation: string;
  },
  fragments: CommitDiffFragment[] | undefined,
): EvidenceBackedFinding {
  const reference =
    item.relativePath && fragments
      ? findReference(fragments, item.relativePath)
      : undefined;
  return {
    id: `local-${item.id}`,
    category: "local-blocked",
    statement: item.title,
    source: "local-rule",
    severity: item.severity,
    consequence: item.evidence,
    evidence: reference ? [reference] : [],
    invalidEvidence: [],
    limitations: [],
    nextAction: item.recommendation,
  };
}

function findReference(
  fragments: CommitDiffFragment[],
  relativePath: string,
): EvidenceReference | undefined {
  const fragment = fragments.find(
    (item) =>
      item.projectRelativePath === relativePath ||
      item.projectRelativePath === relativePath.split("/").pop(),
  );
  if (!fragment || fragment.hunks.length === 0) return undefined;
  return {
    candidateId: fragment.candidateId,
    hunkId: fragment.hunks[0].hunkId,
    projectRelativePath: fragment.projectRelativePath,
  };
}
