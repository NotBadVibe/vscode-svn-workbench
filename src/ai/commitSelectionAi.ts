import { CommitCandidate } from "../commit/commitCandidateCollector";
import { OperationScope } from "../scope/operationScope";
import { AiSelectionRequest, AiSelectionResult } from "./aiProvider";

const MAX_FILES_IN_SELECTION_REQUEST = 200;

/**
 * 构造 AI 提交选择请求：只发送当前范围候选的相对路径、SVN 状态、文件类型
 * 与本地规则结论（localDecision + safetyLocked），不发送本地绝对路径
 * （规划 5.5；path/relativePath 均为相对路径）。
 */
export function buildCommitSelectionAiRequest(
  scope: OperationScope,
  candidates: CommitCandidate[],
): AiSelectionRequest {
  const files = candidates
    .slice(0, MAX_FILES_IN_SELECTION_REQUEST)
    .map((candidate) => ({
      path: candidate.relativePath,
      relativePath: candidate.relativePath,
      status: candidate.status,
      type: candidate.fileType,
      fileType: candidate.fileType,
      templateGroup: candidate.templateGroup,
      generatedDecision: candidate.generatedDecision,
      defaultSelection: candidate.selection,
      reason: candidate.reason,
      localDecision: candidate.evaluation.decision,
      safetyLocked: candidate.evaluation.safetyLocked,
    }));

  return {
    scope: scope.roots.map((root) => root.relativePath).join(", ") || ".",
    files,
    locale: "zh-CN",
    policy: {
      rightClickScopeOnly: true,
      excludeGeneratedByDefault: true,
      userFinalDecision: true,
    },
  };
}

export function createLocalCommitSelectionResult(
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
      reason: `本地规则：${candidate.reason}`,
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

  return result;
}
