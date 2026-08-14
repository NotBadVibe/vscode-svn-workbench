import { CommitCandidate } from "../commit/commitCandidateCollector";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import {
  CommitSelectionAiDecision,
  CommitSelectionExplanation,
} from "./commitSelectionExplanation";

export type CommitSelectionDecisionFilter = CommitSelectionAiDecision | "all";

export function getDefaultSelectedCandidatePaths(
  candidates: CommitCandidate[],
): string[] {
  return candidates
    .filter((candidate) => candidate.selection === "selected")
    .map((candidate) => candidate.absolutePath);
}

export function getAiRecommendedCandidatePaths(
  candidates: CommitCandidate[],
  explanation: CommitSelectionExplanation,
): string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.selection !== "excluded" && candidate.selection !== "blocked",
    )
    .filter(
      (candidate) =>
        getAiDecisionForCandidate(candidate, explanation) === "recommended",
    )
    .map((candidate) => candidate.absolutePath);
}

export function filterCandidatesByAiDecision(
  candidates: CommitCandidate[],
  explanation: CommitSelectionExplanation | undefined,
  decision: CommitSelectionDecisionFilter,
): CommitCandidate[] {
  if (decision === "all") {
    return candidates;
  }

  return candidates.filter(
    (candidate) =>
      getAiDecisionForCandidate(candidate, explanation) === decision,
  );
}

export function getAiDecisionForCandidate(
  candidate: CommitCandidate,
  explanation: CommitSelectionExplanation | undefined,
): CommitSelectionAiDecision {
  if (!explanation) {
    return "none";
  }

  const item = explanation.items.find(
    (entry) =>
      normalizePathKey(entry.absolutePath) ===
      normalizePathKey(candidate.absolutePath),
  );
  return item?.decision ?? "none";
}
