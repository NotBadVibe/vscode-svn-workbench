import * as path from 'node:path';
import { OperationScope } from '../scope/operationScope';
import { isPathInScope } from '../scope/pathBoundaryGuard';
import { SvnStatus } from '../svn/svnTypes';
import { CommitCandidate } from './commitCandidateCollector';
import { CommitFlowPlan } from './commitFlow';

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
  selectedPaths: string[]
): CommitPlanPreview {
  const candidateByPath = new Map(candidates.map((candidate) => [normalizePathKey(candidate.absolutePath), candidate]));
  const selected = dedupePaths(selectedPaths);
  const addPaths: string[] = [];
  const removePaths: string[] = [];
  const commitPaths: string[] = [];
  const issues: CommitPlanIssue[] = [];

  if (selected.length === 0) {
    issues.push({ reason: '请选择至少一个文件后再生成提交计划。' });
  }

  for (const selectedPath of selected) {
    const absolutePath = path.resolve(selectedPath);
    if (!isPathInScope(scope, absolutePath)) {
      issues.push({ path: absolutePath, reason: '文件不在当前提交范围内，已阻止。' });
      continue;
    }

    const candidate = candidateByPath.get(normalizePathKey(absolutePath));
    if (!candidate) {
      issues.push({ path: absolutePath, reason: '文件不在当前 SVN 候选列表中，已阻止。' });
      continue;
    }

    const reason = getBlockedCommitReason(candidate);
    if (reason) {
      issues.push({ path: absolutePath, reason });
      continue;
    }

    commitPaths.push(absolutePath);
    if (candidate.status === 'unversioned') {
      addPaths.push(absolutePath);
    } else if (candidate.status === 'missing') {
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
    canCommit: issues.length === 0 && commitPaths.length > 0
  };
}

export function toCommitFlowPlan(preview: CommitPlanPreview, message: string): CommitFlowPlan {
  return {
    cwd: preview.cwd,
    commitPaths: preview.commitPaths,
    addPaths: preview.addPaths,
    removePaths: preview.removePaths,
    message
  };
}

function getBlockedCommitReason(candidate: CommitCandidate): string | undefined {
  if (candidate.selection === 'blocked') {
    return '文件处于阻止状态，需要先处理冲突或异常。';
  }

  if (candidate.selection === 'excluded') {
    return '文件已被规则排除，不能直接进入提交计划。';
  }

  if (!isCommittableStatus(candidate.status)) {
    return `当前 SVN 状态 ${candidate.status} 不支持直接提交。`;
  }

  return undefined;
}

function isCommittableStatus(status: SvnStatus): boolean {
  return (
    status === 'modified' ||
    status === 'added' ||
    status === 'deleted' ||
    status === 'missing' ||
    status === 'unversioned' ||
    status === 'replaced'
  );
}

function buildCommandPreview(commitPaths: string[], addPaths: string[], removePaths: string[]): string[] {
  const commands: string[] = [];
  for (const addPath of addPaths) {
    commands.push(`svn add ${quotePath(addPath)}`);
  }
  for (const removePath of removePaths) {
    commands.push(`svn remove ${quotePath(removePath)}`);
  }
  if (commitPaths.length > 0) {
    commands.push(`svn commit ${commitPaths.map(quotePath).join(' ')} -F <message-file> --encoding utf-8`);
  }
  return commands;
}

function dedupePaths(paths: string[]): string[] {
  const byPath = new Map<string, string>();
  for (const value of paths) {
    const absolutePath = path.resolve(value);
    byPath.set(normalizePathKey(absolutePath), absolutePath);
  }
  return [...byPath.values()].sort((left, right) => left.localeCompare(right));
}

function normalizePathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}
