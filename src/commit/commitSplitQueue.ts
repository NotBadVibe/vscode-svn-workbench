import { AiCommitSplitSuggestion } from '../ai/aiProvider';
import { CommitSplitPlanPreview } from './commitSplitPlanPreview';

export type CommitSplitQueuePlanStatus = 'notPreviewed' | 'ready' | 'blocked';
export type CommitSplitQueueItemStatus = 'pending' | 'applied' | 'submitting' | 'completed' | 'failed';
export type CommitSplitQueueViewFilter = 'all' | CommitSplitQueueItemStatus;
export type CommitSplitQueuePlanFilter = 'all' | CommitSplitQueuePlanStatus;
export type CommitSplitQueueApplyBlockReason = 'notPreviewed' | 'blocked' | 'submitting' | 'completed';
export type CommitSplitQueueRetryBlockReason = CommitSplitQueueApplyBlockReason | 'notFailed';

export interface CommitSplitQueueItem {
  id: string;
  title: string;
  suggestion: AiCommitSplitSuggestion;
  status: CommitSplitQueueItemStatus;
  planStatus: CommitSplitQueuePlanStatus;
  lastPreviewIssueCount?: number;
  lastPreviewIssues?: CommitSplitQueuePreviewIssue[];
  revision?: string;
  lastSubmissionError?: string;
  completedAt?: number;
  addedAt: number;
}

export interface CommitSplitQueuePreviewIssue {
  path?: string;
  reason: string;
}

export interface CommitSplitQueuePreviewIssueSummaryItem extends CommitSplitQueuePreviewIssue {
  queueItemId: string;
  queueItemTitle: string;
}

export type CommitSplitQueuePreviewIssueCategory =
  | 'scope'
  | 'candidate'
  | 'excluded'
  | 'blocked'
  | 'svnStatus'
  | 'emptySelection'
  | 'unknown';
export type CommitSplitQueuePreviewIssueCategoryFilter = 'all' | CommitSplitQueuePreviewIssueCategory;

export interface CommitSplitQueuePreviewIssueGroup {
  category: CommitSplitQueuePreviewIssueCategory;
  label: string;
  count: number;
  itemCount: number;
  issues: CommitSplitQueuePreviewIssueSummaryItem[];
}

export type CommitSplitQueuePreviewIssueQuickActionKind =
  | 'refreshAndRepreview'
  | 'openConflictCenter'
  | 'regenerateSplit'
  | 'manualReview';

export interface CommitSplitQueuePreviewIssueQuickAction {
  kind: CommitSplitQueuePreviewIssueQuickActionKind;
  label: string;
  detail: string;
}

export interface CommitSplitQueuePreviewIssueCategoryAction {
  category: CommitSplitQueuePreviewIssueCategory;
  title: string;
  detail: string;
  primaryActionLabel: string;
  secondaryActionLabel?: string;
  quickActions: CommitSplitQueuePreviewIssueQuickAction[];
}

export interface CommitSplitQueueApplyGuard {
  allowed: boolean;
  reason?: CommitSplitQueueApplyBlockReason;
  message: string;
}

export interface CommitSplitQueueSubmissionResult {
  ok: boolean;
  revision?: string;
  message?: string;
}

export interface CommitSplitQueueSubmitGuard extends CommitSplitQueueApplyGuard {}

export interface CommitSplitQueueRetryGuard {
  allowed: boolean;
  reason?: CommitSplitQueueRetryBlockReason;
  message: string;
}

export interface CommitSplitQueueSummary {
  total: number;
  visible: number;
  hiddenCompleted: number;
  pending: number;
  applied: number;
  submitting: number;
  completed: number;
  failed: number;
  notPreviewed: number;
  ready: number;
  blocked: number;
}

export interface CommitSplitQueueBulkPreviewState {
  ids: string[];
  completedIds: string[];
  startedAt: number;
}

export interface CommitSplitQueueBulkPreviewSummary {
  total: number;
  completed: number;
  remaining: number;
  active: boolean;
}

export interface CommitSplitQueueBulkPreviewResultSummary {
  total: number;
  ready: number;
  blocked: number;
  notPreviewed: number;
  firstBlockedId?: string;
  firstBlockedTitle?: string;
  firstReadyId?: string;
  firstReadyTitle?: string;
}

export type CommitSplitQueueNextActionKind =
  | 'empty'
  | 'waitBulkPreview'
  | 'reviewBlocked'
  | 'retryFailed'
  | 'previewFailed'
  | 'submitReady'
  | 'previewNotPreviewed'
  | 'waitSubmitting'
  | 'allDone'
  | 'idle';

export type CommitSplitQueueNextActionCommand =
  | 'showBlocked'
  | 'retryFirstFailed'
  | 'previewFailed'
  | 'submitFirstReady'
  | 'previewAll'
  | 'previewNotPreviewed'
  | 'clearCompleted';

export interface CommitSplitQueueNextAction {
  kind: CommitSplitQueueNextActionKind;
  title: string;
  detail: string;
  primaryActionLabel?: string;
  primaryActionCommand?: CommitSplitQueueNextActionCommand;
}

export interface CommitSplitQueueAddManyResult {
  queue: CommitSplitQueueItem[];
  added: number;
  addedIds: string[];
  skippedDuplicate: number;
  skippedEmpty: number;
}

export function addCommitSplitToQueue(
  queue: CommitSplitQueueItem[],
  suggestion: AiCommitSplitSuggestion,
  now = Date.now()
): CommitSplitQueueItem[] {
  if (!suggestion.paths.length) {
    return queue;
  }

  const key = getSuggestionQueueKey(suggestion);
  const existing = queue.find((item) => getSuggestionQueueKey(item.suggestion) === key);
  if (existing) {
    return queue;
  }

  return [
    ...queue,
    {
      id: suggestion.id || key,
      title: suggestion.title || '拆分建议',
      suggestion,
      status: 'pending',
      planStatus: 'notPreviewed',
      addedAt: now
    }
  ];
}

export function addCommitSplitsToQueue(
  queue: CommitSplitQueueItem[],
  suggestions: AiCommitSplitSuggestion[],
  now = Date.now()
): CommitSplitQueueAddManyResult {
  let nextQueue = queue;
  let added = 0;
  const addedIds: string[] = [];
  let skippedDuplicate = 0;
  let skippedEmpty = 0;
  const existingKeys = new Set(queue.map((item) => getSuggestionQueueKey(item.suggestion)));

  suggestions.forEach((suggestion, index) => {
    if (!suggestion.paths.length) {
      skippedEmpty += 1;
      return;
    }

    const key = getSuggestionQueueKey(suggestion);
    if (existingKeys.has(key)) {
      skippedDuplicate += 1;
      return;
    }

    const id = suggestion.id || key;
    nextQueue = [
      ...nextQueue,
      {
        id,
        title: suggestion.title || '拆分建议',
        suggestion,
        status: 'pending',
        planStatus: 'notPreviewed',
        addedAt: now + index
      }
    ];
    existingKeys.add(key);
    addedIds.push(id);
    added += 1;
  });

  return {
    queue: nextQueue,
    added,
    addedIds,
    skippedDuplicate,
    skippedEmpty
  };
}

export function removeCommitSplitFromQueue(queue: CommitSplitQueueItem[], id: string): CommitSplitQueueItem[] {
  return queue.filter((item) => item.id !== id);
}

export function removeCompletedCommitSplitQueueItems(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return queue.filter((item) => item.status !== 'completed');
}

export function markCommitSplitQueueItemApplied(queue: CommitSplitQueueItem[], id: string): CommitSplitQueueItem[] {
  return queue.map((item) => item.id === id ? { ...item, status: 'applied' as const } : item);
}

export function canApplyCommitSplitQueueItem(item: CommitSplitQueueItem): CommitSplitQueueApplyGuard {
  if (item.status === 'submitting') {
    return {
      allowed: false,
      reason: 'submitting',
      message: '该拆分建议正在提交中，请等待结果后再操作。'
    };
  }

  if (item.status === 'completed') {
    return {
      allowed: false,
      reason: 'completed',
      message: '该拆分建议已经提交完成。'
    };
  }

  if (item.planStatus === 'notPreviewed') {
    return {
      allowed: false,
      reason: 'notPreviewed',
      message: '请先预览该拆分建议的提交计划。'
    };
  }

  if (item.planStatus === 'blocked') {
    return {
      allowed: false,
      reason: 'blocked',
      message: '该拆分建议的提交计划仍有阻止项，请处理后再套用。'
    };
  }

  return {
    allowed: true,
    message: '该拆分建议已通过提交计划预览。'
  };
}

export function canSubmitCommitSplitQueueItem(item: CommitSplitQueueItem): CommitSplitQueueSubmitGuard {
  const guard = canApplyCommitSplitQueueItem(item);
  if (!guard.allowed) {
    return guard;
  }

  return {
    allowed: true,
    message: '该拆分建议已通过提交计划预览，可以提交。'
  };
}

export function canRetryCommitSplitQueueItem(item: CommitSplitQueueItem): CommitSplitQueueRetryGuard {
  if (item.status !== 'failed') {
    return {
      allowed: false,
      reason: 'notFailed',
      message: '只有失败待处理的拆分建议可以重试。'
    };
  }

  const guard = canSubmitCommitSplitQueueItem(item);
  if (!guard.allowed) {
    return guard;
  }

  return {
    allowed: true,
    message: '该失败项已通过提交计划预览，可以重试提交。'
  };
}

export function markCommitSplitQueueItemSubmitting(queue: CommitSplitQueueItem[], id: string): CommitSplitQueueItem[] {
  return queue.map((item) => item.id === id
    ? {
      ...item,
      status: 'submitting' as const,
      lastSubmissionError: undefined
    }
    : item);
}

export function markCommitSplitQueueItemSubmissionResult(
  queue: CommitSplitQueueItem[],
  id: string,
  result: CommitSplitQueueSubmissionResult,
  now = Date.now()
): CommitSplitQueueItem[] {
  return queue.map((item) => {
    if (item.id !== id) {
      return item;
    }

    if (result.ok) {
      return {
        ...item,
        status: 'completed' as const,
        revision: result.revision,
        lastSubmissionError: undefined,
        completedAt: now
      };
    }

    return {
      ...item,
      status: 'failed' as const,
      revision: undefined,
      lastSubmissionError: result.message || '提交失败。',
      completedAt: undefined
    };
  });
}

export function refreshCommitSplitQueueAfterCommit(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return queue.map((item) => {
    if (item.status === 'completed') {
      return item;
    }

    return {
      ...item,
      planStatus: 'notPreviewed' as const,
      lastPreviewIssueCount: undefined,
      lastPreviewIssues: undefined
    };
  });
}

export function getVisibleCommitSplitQueueItems(
  queue: CommitSplitQueueItem[],
  hideCompleted: boolean,
  filter: CommitSplitQueueViewFilter = 'all',
  planFilter: CommitSplitQueuePlanFilter = 'all',
  previewIssueCategoryFilter: CommitSplitQueuePreviewIssueCategoryFilter = 'all'
): CommitSplitQueueItem[] {
  return queue
    .filter((item) => !hideCompleted || item.status !== 'completed')
    .filter((item) => filter === 'all' || item.status === filter)
    .filter((item) => planFilter === 'all' || item.planStatus === planFilter)
    .filter((item) => doesCommitSplitQueueItemMatchPreviewIssueCategory(item, previewIssueCategoryFilter));
}

export function getRepreviewableCommitSplitQueueItems(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return queue.filter((item) =>
    item.status !== 'completed' &&
    item.status !== 'submitting' &&
    Array.isArray(item.suggestion.paths) &&
    item.suggestion.paths.length > 0
  );
}

export function getNotPreviewedCommitSplitQueueItems(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return getRepreviewableCommitSplitQueueItems(queue).filter((item) => item.planStatus === 'notPreviewed');
}

export function getFailedRepreviewableCommitSplitQueueItems(queue: CommitSplitQueueItem[]): CommitSplitQueueItem[] {
  return getRepreviewableCommitSplitQueueItems(queue).filter((item) => item.status === 'failed');
}

export function createCommitSplitQueueBulkPreviewState(
  queue: CommitSplitQueueItem[],
  now = Date.now()
): CommitSplitQueueBulkPreviewState | undefined {
  const ids = getRepreviewableCommitSplitQueueItems(queue).map((item) => item.id);
  if (ids.length === 0) {
    return undefined;
  }

  return {
    ids,
    completedIds: [],
    startedAt: now
  };
}

export function completeCommitSplitQueueBulkPreviewItem(
  state: CommitSplitQueueBulkPreviewState | undefined,
  id: string
): CommitSplitQueueBulkPreviewState | undefined {
  if (!state || !state.ids.includes(id)) {
    return state;
  }

  const completedIds = state.completedIds.includes(id)
    ? state.completedIds
    : [...state.completedIds, id];
  if (completedIds.length >= state.ids.length) {
    return undefined;
  }

  return {
    ...state,
    completedIds
  };
}

export function summarizeCommitSplitQueueBulkPreview(
  state: CommitSplitQueueBulkPreviewState | undefined
): CommitSplitQueueBulkPreviewSummary {
  if (!state) {
    return {
      total: 0,
      completed: 0,
      remaining: 0,
      active: false
    };
  }

  const completed = state.completedIds.filter((id) => state.ids.includes(id)).length;
  return {
    total: state.ids.length,
    completed,
    remaining: Math.max(state.ids.length - completed, 0),
    active: state.ids.length > completed
  };
}

export function summarizeCommitSplitQueueBulkPreviewResult(
  queue: CommitSplitQueueItem[],
  ids: string[]
): CommitSplitQueueBulkPreviewResultSummary {
  const items = ids
    .map((id) => queue.find((item) => item.id === id))
    .filter((item): item is CommitSplitQueueItem => Boolean(item));
  const firstBlocked = items.find((item) => item.planStatus === 'blocked');
  const firstReady = items.find((item) => item.planStatus === 'ready');

  return {
    total: items.length,
    ready: items.filter((item) => item.planStatus === 'ready').length,
    blocked: items.filter((item) => item.planStatus === 'blocked').length,
    notPreviewed: items.filter((item) => item.planStatus === 'notPreviewed').length,
    firstBlockedId: firstBlocked?.id,
    firstBlockedTitle: firstBlocked?.title,
    firstReadyId: firstReady?.id,
    firstReadyTitle: firstReady?.title
  };
}

export function collectCommitSplitQueuePreviewIssues(queue: CommitSplitQueueItem[]): CommitSplitQueuePreviewIssueSummaryItem[] {
  return queue
    .filter((item) => item.planStatus === 'blocked')
    .flatMap((item) => {
      if (!item.lastPreviewIssues || item.lastPreviewIssues.length === 0) {
        return [{
          queueItemId: item.id,
          queueItemTitle: item.title,
          reason: '该拆分项预览未通过，请重新预览查看详情。'
        }];
      }

      return item.lastPreviewIssues.map((issue) => ({
        queueItemId: item.id,
        queueItemTitle: item.title,
        path: issue.path,
        reason: issue.reason
      }));
    });
}

export function groupCommitSplitQueuePreviewIssues(
  issues: CommitSplitQueuePreviewIssueSummaryItem[]
): CommitSplitQueuePreviewIssueGroup[] {
  const groups = new Map<CommitSplitQueuePreviewIssueCategory, CommitSplitQueuePreviewIssueSummaryItem[]>();
  for (const issue of issues) {
    const category = classifyCommitSplitQueuePreviewIssue(issue.reason);
    groups.set(category, [...(groups.get(category) ?? []), issue]);
  }

  return [...groups.entries()]
    .map(([category, groupIssues]) => ({
      category,
      label: getCommitSplitQueuePreviewIssueCategoryLabel(category),
      count: groupIssues.length,
      itemCount: new Set(groupIssues.map((issue) => issue.queueItemId)).size,
      issues: groupIssues
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function doesCommitSplitQueueItemMatchPreviewIssueCategory(
  item: CommitSplitQueueItem,
  category: CommitSplitQueuePreviewIssueCategoryFilter
): boolean {
  if (category === 'all') {
    return true;
  }

  if (item.planStatus !== 'blocked') {
    return false;
  }

  const issues = item.lastPreviewIssues && item.lastPreviewIssues.length
    ? item.lastPreviewIssues
    : [{ reason: '该拆分项预览未通过，请重新预览查看详情。' }];
  return issues.some((issue) => classifyCommitSplitQueuePreviewIssue(issue.reason) === category);
}

export function getCommitSplitQueuePreviewIssuePathsByCategory(
  queue: CommitSplitQueueItem[],
  category: CommitSplitQueuePreviewIssueCategoryFilter
): string[] {
  const byPath = new Map<string, string>();
  for (const item of queue) {
    if (!doesCommitSplitQueueItemMatchPreviewIssueCategory(item, category)) {
      continue;
    }

    const issues = item.lastPreviewIssues ?? [];
    const issuePaths = issues
      .filter((issue) => issue.path && (category === 'all' || classifyCommitSplitQueuePreviewIssue(issue.reason) === category))
      .map((issue) => issue.path as string);
    const paths = issuePaths.length ? issuePaths : item.suggestion.paths;
    for (const filePath of paths) {
      byPath.set(normalizeCommitSplitQueuePathKey(filePath), filePath);
    }
  }
  return [...byPath.values()];
}

export function classifyCommitSplitQueuePreviewIssue(reason: string): CommitSplitQueuePreviewIssueCategory {
  if (reason.includes('请选择至少一个文件')) {
    return 'emptySelection';
  }

  if (reason.includes('当前提交范围')) {
    return 'scope';
  }

  if (reason.includes('当前 SVN 候选列表')) {
    return 'candidate';
  }

  if (reason.includes('规则排除')) {
    return 'excluded';
  }

  if (reason.includes('阻止状态')) {
    return 'blocked';
  }

  if (reason.includes('当前 SVN 状态')) {
    return 'svnStatus';
  }

  return 'unknown';
}

export function getCommitSplitQueuePreviewIssueCategoryLabel(category: CommitSplitQueuePreviewIssueCategory): string {
  switch (category) {
    case 'scope':
      return '范围不匹配';
    case 'candidate':
      return '候选列表缺失';
    case 'excluded':
      return '规则排除';
    case 'blocked':
      return '阻止状态';
    case 'svnStatus':
      return 'SVN 状态不支持';
    case 'emptySelection':
      return '空选择';
    default:
      return '其他原因';
  }
}

export function getCommitSplitQueuePreviewIssueCategoryAction(
  category: CommitSplitQueuePreviewIssueCategory
): CommitSplitQueuePreviewIssueCategoryAction {
  switch (category) {
    case 'scope':
      return {
        category,
        title: '处理范围不匹配',
        detail: '拆分项包含当前右键范围外的文件。建议切到更高层级提交，或让 AI 重新生成只包含当前范围的拆分建议。',
        primaryActionLabel: '切换提交范围后重预览',
        secondaryActionLabel: '移除范围外文件并重新生成拆分',
        quickActions: [
          createRefreshAndRepreviewAction('刷新候选并重预览此原因'),
          createRegenerateSplitAction()
        ]
      };
    case 'candidate':
      return {
        category,
        title: '处理候选列表缺失',
        detail: '拆分项包含不在当前 SVN 候选列表中的文件。建议先刷新状态；如果文件已移动、删除或不属于本次范围，重新生成拆分建议。',
        primaryActionLabel: '刷新 SVN 状态后重预览',
        secondaryActionLabel: '重新生成拆分建议',
        quickActions: [
          createRefreshAndRepreviewAction('刷新候选并重预览此原因'),
          createRegenerateSplitAction()
        ]
      };
    case 'excluded':
      return {
        category,
        title: '处理规则排除',
        detail: '文件被生成文件规则或团队预设排除。建议确认是否确实需要提交；需要提交时先调整规则或白名单，再重新预览。',
        primaryActionLabel: '检查规则/白名单后重预览',
        secondaryActionLabel: '保留排除并从拆分中移除',
        quickActions: [
          createRefreshAndRepreviewAction('刷新候选并重预览此原因'),
          createManualReviewAction('查看具体阻止项')
        ]
      };
    case 'blocked':
      return {
        category,
        title: '处理阻止状态',
        detail: '文件处于冲突、缺失、阻塞或异常状态。建议先在冲突中心或 SVN 状态视图处理异常，再重新预览拆分计划。',
        primaryActionLabel: '处理异常状态后重预览',
        secondaryActionLabel: '打开冲突中心查看',
        quickActions: [
          createOpenConflictCenterAction(),
          createRefreshAndRepreviewAction('刷新候选并重预览此原因')
        ]
      };
    case 'svnStatus':
      return {
        category,
        title: '处理 SVN 状态不支持',
        detail: '当前 SVN 状态不能直接提交。建议根据状态执行 add、remove、revert、resolved 或 update，让文件回到可提交状态。',
        primaryActionLabel: '修正 SVN 状态后重预览',
        secondaryActionLabel: '查看文件状态明细',
        quickActions: [
          createOpenConflictCenterAction(),
          createRefreshAndRepreviewAction('刷新候选并重预览此原因')
        ]
      };
    case 'emptySelection':
      return {
        category,
        title: '处理空选择',
        detail: '拆分项没有可进入提交计划的文件。建议重新选择文件，或让 AI 基于当前候选列表重新生成拆分建议。',
        primaryActionLabel: '重新选择文件后生成拆分',
        secondaryActionLabel: '刷新候选列表',
        quickActions: [
          createRegenerateSplitAction(),
          createRefreshAndRepreviewAction('刷新候选并重预览此原因')
        ]
      };
    default:
      return {
        category,
        title: '处理其他原因',
        detail: '当前阻止项缺少明确分类。建议先重新预览获取最新详情；如果仍然无法识别，再按具体文件状态人工判断。',
        primaryActionLabel: '重新预览获取详情',
        secondaryActionLabel: '查看具体阻止项',
        quickActions: [
          createRefreshAndRepreviewAction('刷新候选并重预览此原因'),
          createManualReviewAction('查看具体阻止项')
        ]
      };
  }
}

function createRefreshAndRepreviewAction(label: string): CommitSplitQueuePreviewIssueQuickAction {
  return {
    kind: 'refreshAndRepreview',
    label,
    detail: '重新采集当前范围的 SVN 候选文件，然后重预览匹配该原因的拆分项。'
  };
}

function createOpenConflictCenterAction(): CommitSplitQueuePreviewIssueQuickAction {
  return {
    kind: 'openConflictCenter',
    label: '打开冲突中心',
    detail: '进入冲突中心查看冲突、异常状态和 AI 冲突建议。'
  };
}

function createRegenerateSplitAction(): CommitSplitQueuePreviewIssueQuickAction {
  return {
    kind: 'regenerateSplit',
    label: '重新生成拆分建议',
    detail: '基于当前已选文件重新生成 AI 拆分提交建议。'
  };
}

function createManualReviewAction(label: string): CommitSplitQueuePreviewIssueQuickAction {
  return {
    kind: 'manualReview',
    label,
    detail: '保留当前筛选结果，逐条查看阻止原因后再决定是否调整。'
  };
}

function normalizeCommitSplitQueuePathKey(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLocaleLowerCase();
}

export function summarizeCommitSplitQueue(
  queue: CommitSplitQueueItem[],
  hideCompleted = false,
  filter: CommitSplitQueueViewFilter = 'all',
  planFilter: CommitSplitQueuePlanFilter = 'all'
): CommitSplitQueueSummary {
  const visible = getVisibleCommitSplitQueueItems(queue, hideCompleted, filter, planFilter);
  return {
    total: queue.length,
    visible: visible.length,
    hiddenCompleted: hideCompleted ? queue.filter((item) => item.status === 'completed').length : 0,
    pending: queue.filter((item) => item.status === 'pending').length,
    applied: queue.filter((item) => item.status === 'applied').length,
    submitting: queue.filter((item) => item.status === 'submitting').length,
    completed: queue.filter((item) => item.status === 'completed').length,
    failed: queue.filter((item) => item.status === 'failed').length,
    notPreviewed: queue.filter((item) => item.planStatus === 'notPreviewed').length,
    ready: queue.filter((item) => item.planStatus === 'ready').length,
    blocked: queue.filter((item) => item.planStatus === 'blocked').length
  };
}

export function getCommitSplitQueueNextAction(
  queue: CommitSplitQueueItem[],
  bulkPreviewSummary: CommitSplitQueueBulkPreviewSummary = summarizeCommitSplitQueueBulkPreview(undefined)
): CommitSplitQueueNextAction {
  if (queue.length === 0) {
    return {
      kind: 'empty',
      title: '等待拆分建议',
      detail: '当前还没有拆分队列项，可以先生成 AI 拆分提交建议。'
    };
  }

  if (bulkPreviewSummary.active) {
    return {
      kind: 'waitBulkPreview',
      title: '等待批量预览完成',
      detail: `已完成 ${bulkPreviewSummary.completed} / ${bulkPreviewSummary.total}，剩余 ${bulkPreviewSummary.remaining} 项。`
    };
  }

  const actionable = queue.filter((item) => item.status !== 'completed' && item.status !== 'submitting');
  const blockedCount = actionable.filter((item) => item.planStatus === 'blocked').length;
  if (blockedCount > 0) {
    return {
      kind: 'reviewBlocked',
      title: '优先处理阻止项',
      detail: `当前有 ${blockedCount} 个拆分项需要处理，建议先查看原因并重预览。`,
      primaryActionLabel: '只看需处理',
      primaryActionCommand: 'showBlocked'
    };
  }

  const firstRetryable = getFirstRetryableCommitSplitQueueItem(queue);
  if (firstRetryable) {
    return {
      kind: 'retryFailed',
      title: '优先重试失败项',
      detail: `失败项可重试：${firstRetryable.title}。重试前仍会复用提交计划守卫和确认。`,
      primaryActionLabel: '重试首个失败',
      primaryActionCommand: 'retryFirstFailed'
    };
  }

  const failedRepreviewable = getFailedRepreviewableCommitSplitQueueItems(queue);
  if (failedRepreviewable.length > 0) {
    return {
      kind: 'previewFailed',
      title: '先重预览失败项',
      detail: `当前有 ${failedRepreviewable.length} 个失败项需要重新确认提交计划，建议只重预览失败项后再决定是否重试。`,
      primaryActionLabel: '重预览失败项',
      primaryActionCommand: 'previewFailed'
    };
  }

  const firstSubmittable = getFirstSubmittableCommitSplitQueueItem(queue);
  if (firstSubmittable) {
    return {
      kind: 'submitReady',
      title: '可以提交下一项',
      detail: `下一条可提交：${firstSubmittable.title}。提交前仍会执行远端更新检查和确认。`,
      primaryActionLabel: '提交首个可提交',
      primaryActionCommand: 'submitFirstReady'
    };
  }

  const notPreviewedCount = actionable.filter((item) => item.planStatus === 'notPreviewed').length;
  if (notPreviewedCount > 0) {
    return {
      kind: 'previewNotPreviewed',
      title: '先预览未确认项',
      detail: `当前有 ${notPreviewedCount} 个拆分项尚未预览，建议先批量预览提交计划。`,
      primaryActionLabel: '预览未预览项',
      primaryActionCommand: 'previewNotPreviewed'
    };
  }

  if (queue.some((item) => item.status === 'submitting')) {
    return {
      kind: 'waitSubmitting',
      title: '等待提交结果',
      detail: '当前有拆分项正在提交中，请等待结果回填后再继续。'
    };
  }

  if (queue.every((item) => item.status === 'completed')) {
    return {
      kind: 'allDone',
      title: '队列已处理完成',
      detail: '当前拆分队列均已完成，可以保留记录或清理已完成项。',
      primaryActionLabel: '清理已完成',
      primaryActionCommand: 'clearCompleted'
    };
  }

  return {
    kind: 'idle',
    title: '等待下一步操作',
    detail: '当前队列没有可直接推进的动作，可以检查筛选条件或重新预览。'
  };
}

export function getNextCommitSplitQueueItem(
  queue: CommitSplitQueueItem[],
  afterId?: string
): CommitSplitQueueItem | undefined {
  const actionable = (item: CommitSplitQueueItem) => item.status !== 'completed' && item.status !== 'submitting';
  if (!afterId) {
    return queue.find(actionable);
  }

  const index = queue.findIndex((item) => item.id === afterId);
  if (index < 0) {
    return queue.find(actionable);
  }

  return queue.slice(index + 1).find(actionable) ?? queue.slice(0, index).find(actionable);
}

export function getFirstSubmittableCommitSplitQueueItem(queue: CommitSplitQueueItem[]): CommitSplitQueueItem | undefined {
  return getNextSubmittableCommitSplitQueueItem(queue);
}

export function getFirstRetryableCommitSplitQueueItem(queue: CommitSplitQueueItem[]): CommitSplitQueueItem | undefined {
  return queue.find((item) => canRetryCommitSplitQueueItem(item).allowed);
}

export function getNextSubmittableCommitSplitQueueItem(
  queue: CommitSplitQueueItem[],
  afterId?: string
): CommitSplitQueueItem | undefined {
  const submittable = (item: CommitSplitQueueItem) => canSubmitCommitSplitQueueItem(item).allowed;
  if (!afterId) {
    return queue.find(submittable);
  }

  const index = queue.findIndex((item) => item.id === afterId);
  if (index < 0) {
    return queue.find(submittable);
  }

  return queue.slice(index + 1).find(submittable) ?? queue.slice(0, index).find(submittable);
}

export function updateCommitSplitQueueItemPreviewStatus(
  queue: CommitSplitQueueItem[],
  preview: CommitSplitPlanPreview
): CommitSplitQueueItem[] {
  return queue.map((item) => item.id === preview.splitId
    ? {
      ...item,
      planStatus: preview.preview.canCommit ? 'ready' as const : 'blocked' as const,
      lastPreviewIssueCount: preview.preview.issues.length,
      lastPreviewIssues: preview.preview.issues.map((issue) => ({
        path: issue.path,
        reason: issue.reason
      }))
    }
    : item);
}

export function getSuggestionQueueKey(suggestion: AiCommitSplitSuggestion): string {
  const paths = suggestion.paths.map((filePath) => filePath.replace(/\\/g, '/').toLocaleLowerCase()).sort();
  return paths.join('|') || suggestion.id || suggestion.title;
}
