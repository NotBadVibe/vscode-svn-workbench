import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import { SvnStatus } from "../svn/svnTypes";
import { CommitCandidate } from "./commitCandidateCollector";
import { CommitFlowPlan } from "./commitFlow";
import { blockedCommitSelectionStatuses } from "./commitSelectionRules";

export interface CommitPlanIssue {
  path?: string;
  reason: string;
}

export interface CommitPlanPreview {
  cwd: string;
  commitPaths: string[];
  addPaths: string[];
  removePaths: string[];
  selectedPaths: string[];
  issues: CommitPlanIssue[];
  commands: string[];
  canCommit: boolean;
}

export function buildCommitPlanPreview(
  scope: OperationScope,
  candidates: CommitCandidate[],
  selectedPaths: string[],
): CommitPlanPreview {
  const candidateByPath = new Map(
    candidates.map((candidate) => [
      normalizePathKey(candidate.absolutePath, nativePathSemantics),
      candidate,
    ]),
  );
  const selected = dedupePaths(selectedPaths);
  const addPaths: string[] = [];
  const removePaths: string[] = [];
  const commitPaths: string[] = [];
  const issues: CommitPlanIssue[] = [];

  if (selected.length === 0) {
    issues.push({ reason: "请选择至少一个文件后再生成提交计划。" });
  }

  for (const selectedPath of selected) {
    const absolutePath = path.resolve(selectedPath);
    if (!isPathInScope(scope, absolutePath, nativePathSemantics)) {
      issues.push({
        path: absolutePath,
        reason: "文件不在当前提交范围内，已阻止。",
      });
      continue;
    }

    const candidate = candidateByPath.get(
      normalizePathKey(absolutePath, nativePathSemantics),
    );
    if (!candidate) {
      issues.push({
        path: absolutePath,
        reason: "文件不在当前 SVN 候选列表中，已阻止。",
      });
      continue;
    }

    const reason = getBlockedCommitReason(candidate);
    if (reason) {
      issues.push({ path: absolutePath, reason });
      continue;
    }

    commitPaths.push(absolutePath);
    if (candidate.status === "unversioned") {
      addPaths.push(absolutePath);
    } else if (candidate.status === "missing") {
      removePaths.push(absolutePath);
    }
  }

  return {
    cwd: scope.repositoryRoot,
    commitPaths,
    addPaths,
    removePaths,
    selectedPaths: selected,
    issues,
    commands: buildCommandPreview(commitPaths, addPaths, removePaths),
    canCommit: issues.length === 0 && commitPaths.length > 0,
  };
}

export function toCommitFlowPlan(
  preview: CommitPlanPreview,
  message: string,
): CommitFlowPlan {
  return {
    cwd: preview.cwd,
    commitPaths: preview.commitPaths,
    addPaths: preview.addPaths,
    removePaths: preview.removePaths,
    message,
  };
}

const blockedStatuses: readonly string[] = blockedCommitSelectionStatuses;

function getBlockedCommitReason(
  candidate: CommitCandidate,
): string | undefined {
  // 安全复验使用 (status, propStatus) 二元组，与规则评估器的安全契约一致
  // （V003-CR-01/02）：仅属性冲突（如 status=normal 且 propStatus=conflicted）
  // 同样是阻止状态，不依赖上游 selection 是否已同步。
  if (
    candidate.selection === "blocked" ||
    blockedStatuses.includes(candidate.status) ||
    (candidate.propStatus !== undefined &&
      blockedStatuses.includes(candidate.propStatus))
  ) {
    return "文件处于阻止状态，需要先处理冲突或异常。";
  }

  if (candidate.selection === "excluded") {
    return "文件已被规则排除，不能直接进入提交计划。";
  }

  if (!isCommittableStatus(candidate.status, candidate.propStatus)) {
    return `当前 SVN 状态 ${candidate.status} 不支持直接提交。`;
  }

  return undefined;
}

/**
 * 提交可行性使用 (status, propStatus) 二元组（与 commitSelectionRuleEvaluator
 * 的 propertyModified 契约一致）：仅 SVN 属性变化（status=normal 且
 * propStatus=modified）可直接提交，进入 commitPaths 但不进入
 * addPaths/removePaths；普通 normal 仍不可提交。
 */
function isCommittableStatus(
  status: SvnStatus,
  propStatus?: SvnStatus,
): boolean {
  if (status === "normal") {
    return propStatus === "modified";
  }
  return (
    status === "modified" ||
    status === "added" ||
    status === "deleted" ||
    status === "missing" ||
    status === "unversioned" ||
    status === "replaced"
  );
}

function buildCommandPreview(
  commitPaths: string[],
  addPaths: string[],
  removePaths: string[],
): string[] {
  const commands: string[] = [];
  for (const addPath of addPaths) {
    commands.push(`svn add ${quotePath(addPath)}`);
  }
  for (const removePath of removePaths) {
    commands.push(`svn remove ${quotePath(removePath)}`);
  }
  if (commitPaths.length > 0) {
    commands.push(
      `svn commit ${commitPaths.map(quotePath).join(" ")} -F <message-file> --encoding utf-8`,
    );
  }
  return commands;
}

function dedupePaths(paths: string[]): string[] {
  const byPath = new Map<string, string>();
  for (const value of paths) {
    const absolutePath = path.resolve(value);
    byPath.set(
      normalizePathKey(absolutePath, nativePathSemantics),
      absolutePath,
    );
  }
  return [...byPath.values()].sort((left, right) => left.localeCompare(right));
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
