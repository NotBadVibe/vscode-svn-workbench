/**
 * v0.0.11 受限差异采集（IO 薄层）：按当前 operationScope 对已选文件逐个
 * 执行 `svn diff --internal-diff`，读取原文交给纯逻辑
 * commitDiffEvidence.ts 做脱敏、裁剪、预算与 hash 绑定，并读取工作副本
 * revision 作为时效绑定。不包含业务决策（全部在纯逻辑侧）。
 */

import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import { runSvnCommand } from "../svn/svnCommandRunner";
import {
  applyDiffBudget,
  buildCandidateId,
  buildCommitDiffFragment,
  summarizeCommitDiffCollection,
  type CommitDiffCollectionResult,
  type CommitDiffFragment,
  type DiffFileCoverage,
} from "./commitDiffEvidence";

/** 与既有提交说明请求一致的文件上限（前 N 个文件）。 */
const MAX_DIFF_PATHS = 80;
/** 单个文件 svn diff 输出上限（字节；字符预算 4 倍覆盖 UTF-8 宽字符）。 */
const MAX_DIFF_BYTES_PER_PATH = 240000;

/** v0.0.11 受限差异预算：单文件字符上限。 */
export const COMMIT_DIFF_PER_FILE_BUDGET = 6000;
/** v0.0.11 受限差异预算：全部文件字符总上限。 */
export const COMMIT_DIFF_TOTAL_BUDGET = 40000;

export interface CommitDiffCandidateRef {
  absolutePath: string;
  relativePath: string;
  status: string;
  projectRelativePath: string;
}

export interface CollectLimitedCommitDiffsOptions {
  svnPath: string;
  scope: OperationScope;
  /** 已选文件的绝对路径（去重后限制到前 MAX_DIFF_PATHS 个）。 */
  selectedPaths: string[];
  /** 已选文件的候选引用（用于 candidateId 与展示路径）。 */
  candidates: CommitDiffCandidateRef[];
  perFileBudget: number;
  totalBudget: number;
}

/**
 * 采集受限差异：返回发送片段、逐文件覆盖率、摘要与工作副本 revision。
 * 任何单个文件失败都如实进入 readFailed coverage，不静默吞掉。
 */
export async function collectLimitedCommitDiffs(
  options: CollectLimitedCommitDiffsOptions,
): Promise<CommitDiffCollectionResult> {
  const byAbsolutePath = new Map<string, CommitDiffCandidateRef>();
  for (const candidate of options.candidates) {
    byAbsolutePath.set(
      normalizePathIdentity(candidate.absolutePath, nativePathSemantics),
      candidate,
    );
  }

  const uniquePaths = uniqueNormalizedPaths(options.selectedPaths)
    .filter((filePath) =>
      isPathInScope(options.scope, filePath, nativePathSemantics),
    )
    .slice(0, MAX_DIFF_PATHS);

  const fragments: CommitDiffFragment[] = [];
  const coverage: DiffFileCoverage[] = [];

  for (const filePath of uniquePaths) {
    const candidate = byAbsolutePath.get(
      normalizePathIdentity(filePath, nativePathSemantics),
    );
    const candidateId = buildCandidateId(
      options.scope.repositoryRoot,
      filePath,
    );
    const projectRelativePath =
      candidate?.projectRelativePath || candidate?.relativePath || filePath;

    const result = await runSvnCommand(
      options.svnPath,
      ["diff", "--internal-diff", filePath],
      options.scope.repositoryRoot,
      { maxOutputBytes: MAX_DIFF_BYTES_PER_PATH },
    );

    const binary =
      result.stdout.includes("Cannot display") ||
      result.stdout.includes("binary type") ||
      result.stdout.includes("svn:mime-type");
    const readError =
      result.exitCode !== 0 && !result.truncated
        ? result.stderr || result.stdout || "svn diff 读取失败"
        : undefined;

    const built = buildCommitDiffFragment({
      candidateId,
      projectRelativePath,
      status: candidate?.status ?? "modified",
      rawContent: result.stdout,
      perFileBudget: options.perFileBudget,
      binary,
      readError,
    });
    if (built.fragment) {
      fragments.push(built.fragment);
    }
    coverage.push(built.coverage);
  }

  // 总字符预算裁剪：超出预算的文件只保留 budgetExcluded coverage，
  // 不发送差异正文（界面可见并计入覆盖率）。
  const { fragments: budgetedFragments, budgetExcluded } = applyDiffBudget(
    fragments,
    options.totalBudget,
  );
  const excludedById = new Map(
    budgetExcluded.map((item) => [item.candidateId, item]),
  );
  const finalCoverage = coverage.map((item) => {
    const excluded = excludedById.get(item.candidateId);
    return excluded ?? item;
  });

  const revision = await readWorkingCopyRevision(
    options.svnPath,
    options.scope,
  );
  return summarizeCommitDiffCollection({
    fragments: budgetedFragments,
    coverage: finalCoverage,
    revision,
  });
}

/** 读取工作副本 revision（svn info --show-item revision）；失败时缺省。 */
export async function readWorkingCopyRevision(
  svnPath: string,
  scope: OperationScope,
): Promise<string | undefined> {
  try {
    const result = await runSvnCommand(
      svnPath,
      ["info", "--show-item", "revision", scope.repositoryRoot],
      scope.repositoryRoot,
    );
    const revision = result.stdout.trim();
    return result.exitCode === 0 && revision ? revision : undefined;
  } catch {
    return undefined;
  }
}

function uniqueNormalizedPaths(filePaths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const absolutePath of filePaths) {
    const key = normalizePathIdentity(absolutePath, nativePathSemantics);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(absolutePath);
    }
  }
  return result;
}
