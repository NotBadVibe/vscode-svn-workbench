import { CommitSelectionAiDecision } from '../ai/commitSelectionExplanation';
import { CommitCandidate } from './commitCandidateCollector';

export type CommitCandidateGroupMode =
  | 'none'
  | 'module'
  | 'fileType'
  | 'status'
  | 'template'
  | 'aiDecision';

export interface CommitCandidateGroup {
  mode: CommitCandidateGroupMode;
  key: string;
  label: string;
  candidates: CommitCandidate[];
  total: number;
  defaultSelected: number;
  needsReview: number;
  excluded: number;
  blocked: number;
}

export interface CommitCandidateGroupingOptions {
  mode: CommitCandidateGroupMode;
  getAiDecision?: (candidate: CommitCandidate) => CommitSelectionAiDecision;
}

const aiDecisionOrder: CommitSelectionAiDecision[] = [
  'recommended',
  'needsReview',
  'excluded',
  'blocked',
  'none'
];

export function groupCommitCandidates(
  candidates: CommitCandidate[],
  options: CommitCandidateGroupingOptions
): CommitCandidateGroup[] {
  if (options.mode === 'none') {
    return [createGroup('none', 'all', '全部文件', candidates)];
  }

  const groups = new Map<string, { label: string; candidates: CommitCandidate[]; order: number }>();
  for (const candidate of candidates) {
    const group = getCandidateGroup(candidate, options);
    const existing = groups.get(group.key);
    if (existing) {
      existing.candidates.push(candidate);
    } else {
      groups.set(group.key, {
        label: group.label,
        candidates: [candidate],
        order: group.order
      });
    }
  }

  return [...groups.entries()]
    .sort((left, right) => {
      const orderDelta = left[1].order - right[1].order;
      if (orderDelta !== 0) {
        return orderDelta;
      }
      return left[1].label.localeCompare(right[1].label);
    })
    .map(([key, group]) => createGroup(options.mode, key, group.label, group.candidates));
}

export function getGroupSelectableCandidatePaths(group: CommitCandidateGroup): string[] {
  return group.candidates
    .filter((candidate) => candidate.selection !== 'excluded' && candidate.selection !== 'blocked')
    .map((candidate) => candidate.absolutePath);
}

export function inferCommitCandidateModuleGroup(relativePath: string): string {
  const normalized = relativePath.split('\\').join('/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return 'repository-root';
  }

  if (
    parts.length >= 3 &&
    parts[0] === 'src' &&
    ['pages', 'views', 'modules', 'features'].includes(parts[1])
  ) {
    return parts.slice(0, 3).join('/');
  }

  if (parts.length >= 3 && parts[0] === 'packages') {
    return parts.slice(0, 2).join('/');
  }

  if (parts.length >= 2 && ['src', 'app', 'apps'].includes(parts[0])) {
    return parts.slice(0, 2).join('/');
  }

  return parts[0];
}

function getCandidateGroup(
  candidate: CommitCandidate,
  options: CommitCandidateGroupingOptions
): { key: string; label: string; order: number } {
  switch (options.mode) {
    case 'module': {
      const key = inferCommitCandidateModuleGroup(candidate.relativePath);
      return {
        key,
        label: key === 'repository-root' ? '仓库根目录' : key,
        order: key === 'repository-root' ? -1 : 0
      };
    }
    case 'fileType':
      return {
        key: candidate.fileType,
        label: `类型: ${candidate.fileType}`,
        order: 0
      };
    case 'status':
      return {
        key: candidate.status,
        label: `状态: ${candidate.status}`,
        order: 0
      };
    case 'template':
      return {
        key: candidate.templateGroup,
        label: `预设: ${candidate.templateGroup}`,
        order: 0
      };
    case 'aiDecision': {
      const decision = options.getAiDecision?.(candidate) ?? 'none';
      return {
        key: decision,
        label: `AI: ${decision}`,
        order: aiDecisionOrder.indexOf(decision)
      };
    }
    case 'none':
      return {
        key: 'all',
        label: '全部文件',
        order: 0
      };
  }
}

function createGroup(
  mode: CommitCandidateGroupMode,
  key: string,
  label: string,
  candidates: CommitCandidate[]
): CommitCandidateGroup {
  return {
    mode,
    key,
    label,
    candidates,
    total: candidates.length,
    defaultSelected: countSelection(candidates, 'selected'),
    needsReview: countSelection(candidates, 'needsReview'),
    excluded: countSelection(candidates, 'excluded'),
    blocked: countSelection(candidates, 'blocked')
  };
}

function countSelection(candidates: CommitCandidate[], selection: CommitCandidate['selection']): number {
  return candidates.filter((candidate) => candidate.selection === selection).length;
}
