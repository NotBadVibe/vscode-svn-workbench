import { CommitCandidate } from "../commit/commitCandidateCollector";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import { AiFileDecision, AiSelectionResult } from "./aiProvider";

export type CommitSelectionAiDecision =
  "recommended" | "needsReview" | "excluded" | "blocked" | "none";

export interface CommitSelectionExplanationItem {
  absolutePath: string;
  relativePath: string;
  decision: CommitSelectionAiDecision;
  reason: string;
  selectedByAi: boolean;
}

export interface CommitSelectionExplanation {
  items: CommitSelectionExplanationItem[];
  summary: Record<CommitSelectionAiDecision, number>;
}

export function buildCommitSelectionExplanation(
  candidates: CommitCandidate[],
  result: AiSelectionResult,
): CommitSelectionExplanation {
  const decisionByPath = new Map<
    string,
    { decision: CommitSelectionAiDecision; reason: string }
  >();
  addDecisions(decisionByPath, result.recommended, "recommended");
  addDecisions(decisionByPath, result.needsReview, "needsReview");
  addDecisions(decisionByPath, result.excluded, "excluded");
  addDecisions(decisionByPath, result.blocked, "blocked");

  const summary = createEmptySummary();
  const items = candidates.map((candidate) => {
    const decision = decisionByPath.get(
      normalizePathKey(candidate.absolutePath, nativePathSemantics),
    ) ?? {
      decision: "none" as const,
      reason: "AI 未给出建议，保留当前默认选择。",
    };
    summary[decision.decision] += 1;
    return {
      absolutePath: candidate.absolutePath,
      relativePath: candidate.relativePath,
      decision: decision.decision,
      reason: decision.reason,
      selectedByAi: decision.decision === "recommended",
    };
  });

  return {
    items,
    summary,
  };
}

function addDecisions(
  target: Map<string, { decision: CommitSelectionAiDecision; reason: string }>,
  items: AiFileDecision[],
  decision: CommitSelectionAiDecision,
): void {
  for (const item of items) {
    target.set(normalizePathKey(item.path, nativePathSemantics), {
      decision,
      reason: item.reason || "AI 未提供原因。",
    });
  }
}

function createEmptySummary(): Record<CommitSelectionAiDecision, number> {
  return {
    recommended: 0,
    needsReview: 0,
    excluded: 0,
    blocked: 0,
    none: 0,
  };
}
