import * as path from 'node:path';
import { CommitCandidate, CommitTemplateGroup } from '../commit/commitCandidateCollector';
import {
  parseRemoteUpdateStatusXml,
  PreCommitRemoteCheckResult,
  RemoteUpdateItem
} from '../commit/preCommitRemoteCheck';
import { OperationScope } from '../scope/operationScope';
import { runSvnCommand } from '../svn/svnCommandRunner';
import { SvnCommandResult } from '../svn/svnTypes';

export interface UpdateScopeLocalChangeSummary {
  total: number;
  selectable: number;
  needsReview: number;
  excluded: number;
  blocked: number;
  generatedExcluded: number;
  byTemplateGroup: Record<CommitTemplateGroup, number>;
  byFileType: Record<string, number>;
}

export interface UpdateScopeRemoteChangeSummary {
  checkedRevision?: string;
  total: number;
  byRepositoryStatus: Record<string, number>;
  items: RemoteUpdateItem[];
}

export type UpdateScopeRiskLevel = 'low' | 'medium' | 'high';

export interface UpdateScopeRiskSummary {
  level: UpdateScopeRiskLevel;
  overlapCount: number;
  overlapPaths: string[];
  messages: string[];
}

export interface UpdateScopePreview {
  cwd: string;
  updatePaths: string[];
  commands: string[];
  localChanges: UpdateScopeLocalChangeSummary;
  remoteChanges?: UpdateScopeRemoteChangeSummary;
  remoteCheckError?: string;
  risk: UpdateScopeRiskSummary;
}

export interface UpdateScopeResult {
  result: SvnCommandResult;
  revision?: string;
  hasConflicts: boolean;
}

export interface UpdateExecutionRefreshStatus {
  refreshedCandidateCount?: number;
  refreshError?: string;
  statusRefreshError?: string;
}

export interface UpdateExecutionFollowUp {
  shouldRefreshCandidates: boolean;
  shouldOpenConflictCenter: boolean;
  messages: string[];
}

export function buildUpdateScopePreview(scope: OperationScope, candidates: CommitCandidate[] = []): UpdateScopePreview {
  const updatePaths = scope.roots.map((root) => root.absolutePath);
  return {
    cwd: scope.repositoryRoot,
    updatePaths,
    commands: [`svn update --accept postpone ${updatePaths.map(quotePath).join(' ')}`],
    localChanges: summarizeUpdateScopeLocalChanges(scope, candidates),
    risk: summarizeUpdateScopeRisk(scope, candidates)
  };
}

export function summarizeUpdateScopeLocalChanges(
  scope: OperationScope,
  candidates: CommitCandidate[]
): UpdateScopeLocalChangeSummary {
  const summary: UpdateScopeLocalChangeSummary = {
    total: 0,
    selectable: 0,
    needsReview: 0,
    excluded: 0,
    blocked: 0,
    generatedExcluded: 0,
    byTemplateGroup: {
      frontend: 0,
      backend: 0,
      document: 0,
      config: 0,
      asset: 0,
      other: 0
    },
    byFileType: {}
  };

  for (const candidate of candidates.filter((item) => isPathInUpdateScope(scope, item.absolutePath))) {
    summary.total += 1;
    summary.byTemplateGroup[candidate.templateGroup] += 1;
    summary.byFileType[candidate.fileType] = (summary.byFileType[candidate.fileType] ?? 0) + 1;
    if (candidate.selection !== 'excluded' && candidate.selection !== 'blocked') {
      summary.selectable += 1;
    }
    if (candidate.selection === 'needsReview') {
      summary.needsReview += 1;
    }
    if (candidate.selection === 'excluded') {
      summary.excluded += 1;
    }
    if (candidate.selection === 'blocked') {
      summary.blocked += 1;
    }
    if (candidate.generatedDecision === 'exclude') {
      summary.generatedExcluded += 1;
    }
  }

  return summary;
}

export async function checkUpdateScopeRemoteChanges(
  svnPath: string,
  scope: OperationScope
): Promise<UpdateScopeRemoteChangeSummary> {
  const updatePaths = scope.roots.map((root) => root.absolutePath);
  if (updatePaths.length === 0) {
    return summarizeUpdateScopeRemoteChanges({ outOfDateItems: [] });
  }

  const result = await runSvnCommand(
    svnPath,
    ['status', '--show-updates', '--xml', ...updatePaths],
    scope.repositoryRoot
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || '更新前检查远端 SVN 变更失败。');
  }

  return summarizeUpdateScopeRemoteChanges(parseRemoteUpdateStatusXml(result.stdout, scope));
}

export function summarizeUpdateScopeRemoteChanges(
  result: PreCommitRemoteCheckResult
): UpdateScopeRemoteChangeSummary {
  const byRepositoryStatus: Record<string, number> = {};
  for (const item of result.outOfDateItems) {
    byRepositoryStatus[item.repositoryStatus] = (byRepositoryStatus[item.repositoryStatus] ?? 0) + 1;
  }

  return {
    checkedRevision: result.checkedRevision,
    total: result.outOfDateItems.length,
    byRepositoryStatus,
    items: result.outOfDateItems
  };
}

export function summarizeUpdateScopeRisk(
  scope: OperationScope,
  candidates: CommitCandidate[],
  remoteChanges?: UpdateScopeRemoteChangeSummary,
  remoteCheckError?: string
): UpdateScopeRiskSummary {
  const localCandidates = candidates.filter((item) => isPathInUpdateScope(scope, item.absolutePath));
  const localByRelativePath = new Set(localCandidates.map((candidate) => normalizeRelative(candidate.relativePath)));
  const overlapPaths = (remoteChanges?.items ?? [])
    .filter((item) => localByRelativePath.has(normalizeRelative(item.relativePath)))
    .map((item) => item.relativePath);
  const blockedCount = localCandidates.filter((candidate) => candidate.selection === 'blocked').length;
  const needsReviewCount = localCandidates.filter((candidate) => candidate.selection === 'needsReview').length;
  const remoteCount = remoteChanges?.total ?? 0;
  const messages: string[] = [];

  if (overlapPaths.length > 0) {
    messages.push(`远端与本地未提交存在 ${overlapPaths.length} 个同路径重叠，建议先查看差异或提交本地改动。`);
  }
  if (blockedCount > 0) {
    messages.push(`当前范围存在 ${blockedCount} 个阻止项，更新后建议先处理冲突或异常状态。`);
  }
  if (remoteCheckError) {
    messages.push(`远端更新检查失败：${remoteCheckError}`);
  }
  if (overlapPaths.length === 0 && blockedCount === 0 && remoteCount > 0 && localCandidates.length > 0) {
    messages.push(`远端有 ${remoteCount} 个变更，本地有 ${localCandidates.length} 个未提交候选，建议更新前确认范围。`);
  }
  if (needsReviewCount > 0 && overlapPaths.length === 0 && blockedCount === 0) {
    messages.push(`当前范围有 ${needsReviewCount} 个待确认项，更新前建议确认是否需要先提交或排除。`);
  }
  if (messages.length === 0) {
    messages.push('当前没有发现明显更新风险。');
  }

  return {
    level: overlapPaths.length > 0 || blockedCount > 0
      ? 'high'
      : remoteCheckError || (remoteCount > 0 && localCandidates.length > 0) || needsReviewCount > 0
        ? 'medium'
        : 'low',
    overlapCount: overlapPaths.length,
    overlapPaths,
    messages
  };
}

export function buildUpdateScopeRiskConfirmationMessage(preview: UpdateScopePreview): string {
  const levelLabel = preview.risk.level === 'high'
    ? '高'
    : preview.risk.level === 'medium'
      ? '中'
      : '低';
  const remoteCount = preview.remoteChanges?.total ?? 0;
  const localCount = preview.localChanges.total;
  const advice = preview.risk.messages.map((message) => `- ${message}`).join('\n');
  const overlap = preview.risk.overlapPaths.slice(0, 5).map((filePath) => `- ${filePath}`).join('\n');
  const overlapMore = preview.risk.overlapPaths.length > 5
    ? `\n- 另有 ${preview.risk.overlapPaths.length - 5} 个重叠路径未显示`
    : '';

  return [
    '确认更新当前范围？',
    `更新风险：${levelLabel}`,
    `本地未提交：${localCount}`,
    `远端变更：${remoteCount}`,
    `同路径重叠：${preview.risk.overlapCount}`,
    preview.remoteCheckError ? `远端检查失败：${preview.remoteCheckError}` : undefined,
    advice ? `建议：\n${advice}` : undefined,
    overlap ? `重叠路径：\n${overlap}${overlapMore}` : undefined,
    '如果产生冲突，将保留为待处理状态。'
  ].filter(Boolean).join('\n');
}

export function buildUpdateExecutionFollowUp(
  updateResult: UpdateScopeResult,
  refreshStatus: UpdateExecutionRefreshStatus = {}
): UpdateExecutionFollowUp {
  const updateSucceeded = updateResult.result.exitCode === 0;
  const messages: string[] = [];

  if (!updateSucceeded) {
    return {
      shouldRefreshCandidates: false,
      shouldOpenConflictCenter: false,
      messages
    };
  }

  if (typeof refreshStatus.refreshedCandidateCount === 'number') {
    messages.push(`提交候选已刷新：${refreshStatus.refreshedCandidateCount} 个`);
  } else if (refreshStatus.refreshError) {
    messages.push(`提交候选刷新失败：${refreshStatus.refreshError}`);
  } else {
    messages.push('更新完成后建议刷新提交候选列表。');
  }

  if (refreshStatus.statusRefreshError) {
    messages.push(`SVN 资源管理器状态刷新失败：${refreshStatus.statusRefreshError}`);
  }

  if (updateResult.hasConflicts) {
    messages.push('检测到冲突，建议进入冲突中心处理后再提交。');
  }

  return {
    shouldRefreshCandidates: true,
    shouldOpenConflictCenter: updateResult.hasConflicts,
    messages
  };
}

export async function runUpdateScope(svnPath: string, scope: OperationScope, options: { signal?: AbortSignal } = {}): Promise<UpdateScopeResult> {
  const preview = buildUpdateScopePreview(scope);
  const result = await runSvnCommand(
    svnPath,
    ['update', '--accept', 'postpone', ...preview.updatePaths],
    scope.repositoryRoot,
    options
  );

  return {
    result,
    revision: parseUpdatedRevision(result.stdout),
    hasConflicts: hasUpdateConflicts(result.stdout)
  };
}

export function parseUpdatedRevision(output: string): string | undefined {
  return /(?:Updated to|At) revision\s+(\d+)/i.exec(output)?.[1];
}

export function hasUpdateConflicts(output: string): boolean {
  return output
    .split(/\r?\n/)
    .some((line) => /^C\s+/.test(line.trimStart()) || /conflict/i.test(line));
}

function quotePath(filePath: string): string {
  return `"${filePath.replace(/"/g, '\\"')}"`;
}

function isPathInUpdateScope(scope: OperationScope, filePath: string): boolean {
  const target = normalizePath(path.resolve(filePath));
  return scope.roots.some((root) => {
    const base = normalizePath(path.resolve(root.absolutePath));
    return target === base || target.startsWith(`${base}/`);
  });
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function normalizeRelative(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLocaleLowerCase();
}
