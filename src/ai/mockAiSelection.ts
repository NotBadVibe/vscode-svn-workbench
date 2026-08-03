import * as path from "node:path";
import { CommitCandidate } from "../commit/commitCandidateCollector";
import { OperationScope } from "../scope/operationScope";
import { AiSelectionResult } from "./aiProvider";

export function createMockAiSelection(
  scope: OperationScope,
  candidates: CommitCandidate[],
): AiSelectionResult {
  const result: AiSelectionResult = {
    recommended: [],
    excluded: [],
    needsReview: [],
    blocked: [],
  };

  for (const candidate of candidates) {
    const decision = {
      path: candidate.absolutePath,
      reason: `AI mock: ${candidate.reason}`,
    };

    switch (candidate.selection) {
      case "selected":
        result.recommended.push(decision);
        break;
      case "needsReview":
        result.needsReview.push(decision);
        break;
      case "excluded":
        result.excluded.push(decision);
        break;
      case "blocked":
        result.blocked.push(decision);
        break;
    }
  }

  result.recommended.push({
    path: path.resolve(scope.repositoryRoot, "..", "ai-out-of-scope.txt"),
    reason: "AI mock: deliberately out of scope and must be rejected",
  });

  return result;
}

export function countAiSelection(result: AiSelectionResult): number {
  return (
    result.recommended.length +
    result.excluded.length +
    result.needsReview.length +
    result.blocked.length
  );
}
