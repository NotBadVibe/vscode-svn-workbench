import { AiCommitSplitSuggestion } from "../ai/aiProvider";
import { OperationScope } from "../scope/operationScope";
import { CommitCandidate } from "./commitCandidateCollector";
import { buildCommitPlanPreview, CommitPlanPreview } from "./commitPlanBuilder";

export interface CommitSplitPlanPreview {
  splitId: string;
  title: string;
  summary: string;
  message: string;
  risks: string[];
  preview: CommitPlanPreview;
}

export function buildCommitSplitPlanPreview(
  scope: OperationScope,
  candidates: CommitCandidate[],
  split: AiCommitSplitSuggestion,
): CommitSplitPlanPreview {
  const preview = buildCommitPlanPreview(scope, candidates, split.paths);
  return {
    splitId: split.id,
    title: split.title,
    summary: split.summary,
    message: split.message,
    risks: [
      ...split.risks,
      ...preview.issues.map((issue) =>
        issue.path ? `${issue.path}: ${issue.reason}` : issue.reason,
      ),
    ],
    preview,
  };
}
