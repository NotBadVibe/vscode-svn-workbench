/**
 * v0.0.12 批次 A：变更解读受限差异采集与回执构建（IO 薄层）。
 * 复用 v0.0.11 的受限差异预算、脱敏、覆盖率与 revision 读取，不重复实现。
 */

import {
  buildAnalysisReceipt,
  buildCandidateId,
  UNDERSTAND_CHANGES_TASK,
  type AnalysisReceipt,
  type DiffCoverageSummary,
} from "../commit/commitDiffEvidence";
import {
  collectLimitedCommitDiffs,
  COMMIT_DIFF_PER_FILE_BUDGET,
  COMMIT_DIFF_TOTAL_BUDGET,
  type CommitDiffCandidateRef,
} from "../commit/commitDiffCollector";
import type { OperationScope } from "../scope/operationScope";
import type { StoredAiConfiguration } from "../ai/aiModelConfiguration";
import type { CommitDiffFileCoverageView } from "../protocol/workbenchProtocol";

export interface UnderstandingCollection {
  coverage: DiffCoverageSummary;
  coverageFiles: CommitDiffFileCoverageView[];
  fragments: import("../commit/commitDiffEvidence").CommitDiffFragment[];
  revision?: string;
  excludedCount: number;
}

/** 采集受限差异（复用 v0.0.11 预算与脱敏），返回覆盖率与片段。 */
export async function collectUnderstandingDiffs(input: {
  svnPath: string;
  scope: OperationScope;
  selectedPaths: string[];
  candidates: CommitDiffCandidateRef[];
}): Promise<UnderstandingCollection> {
  const collected = await collectLimitedCommitDiffs({
    svnPath: input.svnPath,
    scope: input.scope,
    selectedPaths: input.selectedPaths,
    candidates: input.candidates,
    perFileBudget: COMMIT_DIFF_PER_FILE_BUDGET,
    totalBudget: COMMIT_DIFF_TOTAL_BUDGET,
  });
  return {
    coverage: collected.summary,
    coverageFiles: collected.coverage.map((item) => ({
      candidateId: item.candidateId,
      projectRelativePath: item.projectRelativePath as never,
      status: item.status,
      state: item.state,
      diffHash: item.diffHash,
      charCount: item.charCount,
      hunkCount: item.hunkCount,
      reason: item.reason,
    })),
    fragments: collected.fragments,
    revision: collected.revision,
    excludedCount: collected.excludedCount,
  };
}

/** 构建变更解读回执（任务固定 understand-changes，跨任务拒绝由 Host 执行）。 */
export function buildUnderstandingReceipt(input: {
  projectId: string;
  model: string;
  files: number;
  historyIncluded: boolean;
}): AnalysisReceipt {
  return buildAnalysisReceipt({
    task: UNDERSTAND_CHANGES_TASK,
    projectId: input.projectId,
    model: input.model,
    files: input.files,
    totalBudget: COMMIT_DIFF_TOTAL_BUDGET,
    perFileBudget: COMMIT_DIFF_PER_FILE_BUDGET,
    historyIncluded: input.historyIncluded,
    dataTypes: [
      "项目内相对路径、SVN 状态、脱敏差异片段",
      ...(input.historyIncluded ? ["脱敏历史摘要（限条数）"] : []),
    ],
  });
}

/** 构建变更解读回执（含任务绑定辅助；model 缺省表示本地）。 */
export function buildUnderstandingReceiptForSession(input: {
  scope: OperationScope;
  files: number;
  model: string | undefined;
  storedAi: StoredAiConfiguration;
}): AnalysisReceipt {
  const projectId = buildCandidateId(
    input.scope.repositoryRoot,
    input.scope.project?.projectRoot ?? input.scope.repositoryRoot,
  );
  return buildUnderstandingReceipt({
    projectId,
    model: input.model || "本地规则（未配置外部模型）",
    files: input.files,
    historyIncluded: input.storedAi.includeCommitHistory,
  });
}
