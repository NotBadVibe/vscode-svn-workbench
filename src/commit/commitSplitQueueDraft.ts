import * as path from 'node:path';
import { OperationScope, OperationScopeRoot } from '../scope/operationScope';
import {
  CommitSplitQueueItem,
  CommitSplitQueueItemStatus,
  CommitSplitQueuePlanFilter,
  CommitSplitQueueViewFilter
} from './commitSplitQueue';

export const COMMIT_SPLIT_QUEUE_DRAFT_VERSION = 1;

export interface CommitSplitQueueDraftPayload {
  queue?: CommitSplitQueueItem[];
  splitQueueFilter?: CommitSplitQueueViewFilter;
  splitQueuePlanFilter?: CommitSplitQueuePlanFilter;
  hideCompletedSplitQueue?: boolean;
}

export interface CommitSplitQueueDraft {
  version: number;
  scopeKey: string;
  repositoryRoot: string;
  roots: OperationScopeRoot[];
  queue: CommitSplitQueueItem[];
  splitQueueFilter: CommitSplitQueueViewFilter;
  splitQueuePlanFilter: CommitSplitQueuePlanFilter;
  hideCompletedSplitQueue: boolean;
  savedAt: number;
}

export function getCommitSplitQueueDraftStorageKey(scope: OperationScope): string {
  return `svnWorkbench.commitSplitQueueDraft.${Buffer.from(buildCommitSplitQueueDraftScopeKey(scope)).toString('base64url')}`;
}

export function buildCommitSplitQueueDraftScopeKey(scope: OperationScope): string {
  const roots = scope.roots
    .map((root) => `${normalizeKeyPathSegment(root.relativePath)}:${root.kind}`)
    .sort()
    .join('|');
  return `${normalizeKeyPath(scope.repositoryRoot)}::${roots}`;
}

export function createCommitSplitQueueDraft(
  scope: OperationScope,
  payload: CommitSplitQueueDraftPayload | undefined,
  now = Date.now()
): CommitSplitQueueDraft | undefined {
  const queue = sanitizeCommitSplitQueueDraftItems(payload?.queue ?? []);
  if (queue.length === 0) {
    return undefined;
  }

  return {
    version: COMMIT_SPLIT_QUEUE_DRAFT_VERSION,
    scopeKey: buildCommitSplitQueueDraftScopeKey(scope),
    repositoryRoot: path.resolve(scope.repositoryRoot),
    roots: scope.roots.map((root) => ({ ...root })),
    queue,
    splitQueueFilter: sanitizeCommitSplitQueueViewFilter(payload?.splitQueueFilter),
    splitQueuePlanFilter: sanitizeCommitSplitQueuePlanFilter(payload?.splitQueuePlanFilter),
    hideCompletedSplitQueue: Boolean(payload?.hideCompletedSplitQueue),
    savedAt: now
  };
}

export function restoreCommitSplitQueueDraft(
  draft: CommitSplitQueueDraft | undefined,
  scope: OperationScope
): CommitSplitQueueDraft | undefined {
  if (!draft || draft.version !== COMMIT_SPLIT_QUEUE_DRAFT_VERSION) {
    return undefined;
  }

  if (draft.scopeKey !== buildCommitSplitQueueDraftScopeKey(scope)) {
    return undefined;
  }

  const queue = sanitizeCommitSplitQueueDraftItems(draft.queue);
  if (queue.length === 0) {
    return undefined;
  }

  return {
    ...draft,
    queue,
    splitQueueFilter: sanitizeCommitSplitQueueViewFilter(draft.splitQueueFilter),
    splitQueuePlanFilter: sanitizeCommitSplitQueuePlanFilter(draft.splitQueuePlanFilter),
    hideCompletedSplitQueue: Boolean(draft.hideCompletedSplitQueue)
  };
}

export function sanitizeCommitSplitQueueDraftItems(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return queue
    .filter((item) => item.status !== 'completed')
    .filter((item) => Array.isArray(item.suggestion?.paths) && item.suggestion.paths.length > 0)
    .map((item) => ({
      ...item,
      status: sanitizeRestoredStatus(item.status),
      planStatus: 'notPreviewed' as const,
      lastPreviewIssueCount: undefined,
      lastPreviewIssues: undefined,
      revision: undefined,
      completedAt: undefined,
      lastSubmissionError: item.status === 'submitting'
        ? '提交页关闭前仍在提交中，请重新预览后确认状态。'
        : item.lastSubmissionError
    }));
}

export function sanitizeCommitSplitQueueViewFilter(value: unknown): CommitSplitQueueViewFilter {
  return ['all', 'pending', 'applied', 'submitting', 'completed', 'failed'].includes(String(value))
    ? String(value) as CommitSplitQueueViewFilter
    : 'all';
}

export function sanitizeCommitSplitQueuePlanFilter(value: unknown): CommitSplitQueuePlanFilter {
  return ['all', 'notPreviewed', 'ready', 'blocked'].includes(String(value))
    ? String(value) as CommitSplitQueuePlanFilter
    : 'all';
}

function sanitizeRestoredStatus(status: CommitSplitQueueItemStatus): CommitSplitQueueItemStatus {
  if (status === 'failed') {
    return 'failed';
  }

  if (status === 'submitting') {
    return 'failed';
  }

  return 'pending';
}

function normalizeKeyPath(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function normalizeKeyPathSegment(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}
