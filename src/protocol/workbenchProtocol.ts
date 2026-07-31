export const WORKBENCH_PROTOCOL_VERSION = 1 as const;

export type WorkbenchModuleId =
  | 'changes'
  | 'commit'
  | 'diff'
  | 'history'
  | 'conflicts'
  | 'changelists'
  | 'ai-review'
  | 'impact'
  | 'agent'
  | 'repository'
  | 'settings'
  | 'diagnostics';

export type WorkbenchTaskId =
  | 'changes/overview'
  | 'commit/compose'
  | 'diff/working'
  | 'history/revisions'
  | 'conflicts/resolve'
  | 'changelists/manage'
  | 'ai-review/review'
  | 'impact/analyze'
  | 'agent/plan'
  | 'repository/update'
  | 'repository/recovery'
  | 'repository/browse'
  | 'repository/branch'
  | 'repository/tag'
  | 'repository/switch'
  | 'repository/relocate'
  | 'repository/merge'
  | 'repository/patch-shelf'
  | 'repository/release-notes'
  | 'repository/properties'
  | 'settings/ai'
  | 'settings/team'
  | 'settings/svn'
  | 'diagnostics/environment'
  | 'diagnostics/acceptance';

const defaultTasks: Record<WorkbenchModuleId, WorkbenchTaskId> = {
  changes: 'changes/overview',
  commit: 'commit/compose',
  diff: 'diff/working',
  history: 'history/revisions',
  conflicts: 'conflicts/resolve',
  changelists: 'changelists/manage',
  'ai-review': 'ai-review/review',
  impact: 'impact/analyze',
  agent: 'agent/plan',
  repository: 'repository/update',
  settings: 'settings/ai',
  diagnostics: 'diagnostics/environment'
};

const taskModules: Record<WorkbenchTaskId, WorkbenchModuleId> = {
  'changes/overview': 'changes',
  'commit/compose': 'commit',
  'diff/working': 'diff',
  'history/revisions': 'history',
  'conflicts/resolve': 'conflicts',
  'changelists/manage': 'changelists',
  'ai-review/review': 'ai-review',
  'impact/analyze': 'impact',
  'agent/plan': 'agent',
  'repository/update': 'repository',
  'repository/recovery': 'repository',
  'repository/browse': 'repository',
  'repository/branch': 'repository',
  'repository/tag': 'repository',
  'repository/switch': 'repository',
  'repository/relocate': 'repository',
  'repository/merge': 'repository',
  'repository/patch-shelf': 'repository',
  'repository/release-notes': 'repository',
  'repository/properties': 'repository',
  'settings/ai': 'settings',
  'settings/team': 'settings',
  'settings/svn': 'settings',
  'diagnostics/environment': 'diagnostics',
  'diagnostics/acceptance': 'diagnostics'
};

export function defaultWorkbenchTask(moduleId: WorkbenchModuleId): WorkbenchTaskId {
  return defaultTasks[moduleId];
}

export function isWorkbenchTaskId(value: unknown): value is WorkbenchTaskId {
  return typeof value === 'string' && value in taskModules;
}

export function isWorkbenchTaskForModule(taskId: unknown, moduleId: WorkbenchModuleId): taskId is WorkbenchTaskId {
  return isWorkbenchTaskId(taskId) && taskModules[taskId] === moduleId;
}

export type WorkbenchFileStatus =
  | 'normal'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'missing'
  | 'unversioned'
  | 'conflicted'
  | 'ignored'
  | 'external'
  | 'obstructed'
  | 'replaced'
  | 'incomplete'
  | 'unknown';

export interface WorkbenchScopeView {
  repositoryName: string;
  roots: Array<{
    kind: 'file' | 'folder';
    relativePath: string;
  }>;
  source: 'explorer' | 'editor' | 'scm' | 'commandPalette' | 'internal';
}

export interface WorkbenchFileView {
  relativePath: string;
  status: WorkbenchFileStatus;
  repositoryName?: string;
  ownership?: 'current' | 'external' | 'nested';
  propStatus?: WorkbenchFileStatus;
  fileType?: string;
  selection?: 'selected' | 'needsReview' | 'excluded' | 'blocked';
  reason?: string;
}

export interface ChangesSnapshot {
  kind: 'changes';
  commitDraft: string;
  files: WorkbenchFileView[];
  summary: Record<string, number>;
  refreshedAt: string;
  operationPreview?: {
    token: string;
    operation: 'add' | 'remove' | 'revert' | 'lock' | 'unlock' | 'ignore';
    ignoreMode?: 'directory' | 'repository';
    paths: string[];
    command: string;
    consequences: string[];
    destructive: boolean;
    recoverability: string;
    canExecute: boolean;
    issues: string[];
  };
  feedback?: string;
}

export interface DiffSnapshot {
  kind: 'diff';
  relativePath: string;
  original: string;
  modified: string;
  language: string;
  truncated: boolean;
  binary: boolean;
  message?: string;
}

export interface CommitPlanView {
  token: string;
  canExecute: boolean;
  selectedPaths: string[];
  addPaths: string[];
  removePaths: string[];
  commands: string[];
  issues: string[];
  remoteRevision?: string;
  outOfDatePaths: string[];
  createdAt: string;
}

export interface CommitSnapshot {
  kind: 'commit';
  files: WorkbenchFileView[];
  summary: {
    total: number;
    selected: number;
    needsReview: number;
    excluded: number;
    blocked: number;
  };
  selectedPaths: string[];
  message: string;
  messageIssues: string[];
  conventionHint: string;
  templates: Array<{ id: string; label: string; body: string }>;
  preview?: CommitPlanView;
  ai?: {
    source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
    summary: string;
    warnings: string[];
    fallbackReason?: string;
  };
  aiPrivacy: Array<{
    scenario: 'selection' | 'message';
    model: string;
    fileLimit: number;
    data: string;
    historyIncluded: boolean;
    historyCount?: number;
  }>;
}

export interface HistoryRevisionView {
  revision: string;
  author: string;
  date: string;
  message: string;
  changedPaths: Array<{
    action: string;
    path: string;
    copyFromPath?: string;
    copyFromRevision?: string;
  }>;
}

export interface HistorySnapshot {
  kind: 'history';
  revisions: HistoryRevisionView[];
  selectedRevision?: string;
  compareRevisions: string[];
  limit: number;
  fileActionsAvailable: boolean;
  blame?: Array<{ line: number; revision: string; author: string; content: string }>;
  restorePreview?: {
    token: string;
    revision: string;
    relativePath: string;
    command: string;
    canExecute: boolean;
    issues: string[];
  };
  feedback?: string;
}

export interface ConflictFileContentView {
  content?: string;
  truncated: boolean;
  readError?: string;
}

export interface ConflictSnapshot {
  kind: 'conflicts';
  conflicts: Array<{
    relativePath: string;
    operation?: string;
    type?: string;
    sourceLeftRevision?: string;
    sourceRightRevision?: string;
  }>;
  selected?: {
    relativePath: string;
    operation?: string;
    type?: string;
    sourceLeftRevision?: string;
    sourceRightRevision?: string;
    contents: {
      base?: ConflictFileContentView;
      mine?: ConflictFileContentView;
      theirs?: ConflictFileContentView;
      working?: ConflictFileContentView;
    };
    mergeEditor: {
      token: string;
      editable: boolean;
      issues: string[];
      feedback?: string;
    };
  };
  advice?: {
    recommendation: 'acceptWorking' | 'acceptMine' | 'acceptTheirs' | 'manualMerge' | 'noSafeSuggestion';
    confidence: 'low' | 'medium' | 'high';
    summary: string;
    risks: string[];
    steps: string[];
    source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
    fallbackReason?: string;
  };
  resolvePreview?: {
    token: string;
    relativePath: string;
    command: string;
    canResolve: boolean;
    issues: string[];
  };
  aiPrivacy?: { model: string; characters: number; maxCharacters: number; data: string; historyIncluded: false };
}

export interface SettingsSnapshot {
  kind: 'settings';
  svnSecurity: {
    authenticationActive: boolean;
    hasStoredAuthentication: boolean;
    passwordTransport: 'stdin';
    certificateTrust: 'explicit-svn-cache';
  };
  ai: {
    presets: Array<{ id: string; label: string; baseUrl: string; model: string; description: string }>;
    scenarios: Array<{ id: string; label: string; description: string }>;
    providerPreset: string;
    baseUrl: string;
    model: string;
    scenarioModels: Record<string, string>;
    hasApiKey: boolean;
    includeCommitHistory: boolean;
    historyLimit: number;
    models: Array<{ id: string; owner?: string }>;
    feedback?: { tone: 'success' | 'warning' | 'error'; message: string };
  };
  team: {
    configPath: string;
    enabled: boolean;
    requiredIssueId: boolean;
    issueIdPattern: string;
    requiredModule: boolean;
    allowedModulesText: string;
    requiredPrefix: boolean;
    allowedPrefixesText: string;
    warnings: string[];
    memory: {
      source: '当前仓库成功提交';
      count: number;
      maxEntries: number;
      externallyShared: false;
      recent: Array<{ revision?: string; summary: string; recordedAt: string }>;
    };
    recommendation?: {
      summary: string;
      reasons: string[];
      warnings: string[];
      confidence: 'low' | 'medium' | 'high';
      source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
      fallbackReason?: string;
    };
  };
}

export interface DiagnosticsSnapshot {
  kind: 'diagnostics';
  status: 'pass' | 'warn' | 'fail';
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    detail: string;
    action?: string;
  }>;
  acceptance: {
    summary: { sections: number; items: number; steps: number; expectedResults: number };
    sections: Array<{
      id: string;
      title: string;
      items: Array<{ id: string; title: string; description: string; steps: string[]; expected: string[] }>;
    }>;
  };
  generatedAt: string;
  reportText: string;
}

export interface RepositorySnapshot {
  kind: 'repository';
  recovery?: {
    category: 'working-copy-locked' | 'interrupted';
    title: string;
    detectedAt: string;
    steps: string[];
    requiresFreshPreview: true;
  };
  info: {
    name: string;
    url?: string;
    repositoryRoot?: string;
    revision?: string;
  };
  update?: {
    token: string;
    canExecute: boolean;
    localCount: number;
    remoteCount?: number;
    checkedRevision?: string;
    risk: 'low' | 'medium' | 'high';
    overlapPaths: string[];
    messages: string[];
    commands: string[];
    error?: string;
  };
  lastResult?: {
    ok: boolean;
    revision?: string;
    hasConflicts: boolean;
    message: string;
  };
  properties: {
    available: boolean;
    target: string;
    items: Array<{ name: string; value: string }>;
    error?: string;
    feedback?: string;
    preview?: {
      token: string;
      name: string;
      value?: string;
      remove: boolean;
      command: string;
      canExecute: boolean;
      issues: string[];
    };
  };
  cleanup: {
    available: boolean;
    target: string;
    reason?: string;
    feedback?: string;
    preview?: {
      token: string;
      command: string;
      canExecute: boolean;
      issues: string[];
    };
  };
  advanced: {
    browser?: {
      url: string;
      parentUrl?: string;
      entries: Array<{ name: string; kind: 'file' | 'dir'; size?: number; revision?: string; author?: string; date?: string }>;
      error?: string;
    };
    preview?: {
      token: string;
      operation: 'branch' | 'tag' | 'switch' | 'relocate' | 'merge' | 'apply-patch' | 'shelf';
      title: string;
      commands: string[];
      details: string[];
      issues: string[];
      canExecute: boolean;
      destructive: boolean;
    };
    releaseNotes?: { markdown: string; count: number; fromRevision?: string; toRevision?: string };
    feedback?: string;
  };
}

export interface AiReviewSnapshot {
  kind: 'ai-review';
  state: 'ready' | 'empty' | 'stale';
  source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
  generatedAt: string;
  privacy: { files: number; characters: number; maxCharacters: number; historyIncluded: boolean; model: string };
  summary: { critical: number; warning: number; note: number };
  findings: Array<{
    id: string;
    severity: 'critical' | 'warning' | 'note';
    category: 'security' | 'debug' | 'generated' | 'quality' | 'testing';
    relativePath?: string;
    line?: number;
    title: string;
    evidence: string;
    recommendation: string;
    confidence: 'low' | 'medium' | 'high';
  }>;
  warnings: string[];
}

export interface ImpactSnapshot {
  kind: 'impact';
  generatedAt: string;
  source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
  changedFiles: number;
  areas: Array<{ id: string; title: string; detail: string; paths: string[]; risk: 'low' | 'medium' | 'high' }>;
  tests: Array<{ title: string; reason: string; command?: string }>;
  observations: string[];
  warnings: string[];
}

export interface ChangelistsSnapshot {
  kind: 'changelists';
  source: 'local-rule' | 'configured-model' | 'local-rule-fallback';
  fallbackReason?: string;
  aiPrivacy: { model: string; fileLimit: number; data: string; historyIncluded: false };
  groups: Array<{ name: string; paths: string[] }>;
  unassigned: WorkbenchFileView[];
  suggestions: Array<{
    id: string;
    title: string;
    summary: string;
    message: string;
    paths: string[];
    reason: string;
    risks: string[];
  }>;
  warnings: string[];
  preview?: {
    token: string;
    name?: string;
    remove: boolean;
    paths: string[];
    command: string;
    canExecute: boolean;
    issues: string[];
  };
  feedback?: string;
}

export interface AgentSnapshot {
  kind: 'agent';
  status: 'idle' | 'planned' | 'running' | 'completed' | 'cancelled' | 'failed';
  objective: string;
  guardrails: string[];
  steps: Array<{
    id: string;
    title: string;
    detail: string;
    capability: 'svn-read' | 'local-analysis';
    command?: string;
    scope: string;
    risk: string;
    reversibility: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    output?: string;
    requiresApproval: boolean;
  }>;
  nextStepId?: string;
  message?: string;
}

export type WorkbenchModuleSnapshot =
  | ChangesSnapshot
  | DiffSnapshot
  | CommitSnapshot
  | HistorySnapshot
  | ConflictSnapshot
  | SettingsSnapshot
  | DiagnosticsSnapshot
  | RepositorySnapshot
  | AiReviewSnapshot
  | ImpactSnapshot
  | ChangelistsSnapshot
  | AgentSnapshot;

export interface MessageEnvelope<TType extends string, TPayload> {
  protocolVersion: typeof WORKBENCH_PROTOCOL_VERSION;
  type: TType;
  requestId?: string;
  moduleId: WorkbenchModuleId;
  taskId?: WorkbenchTaskId;
  repositoryUuid?: string;
  scopeHash?: string;
  payload: TPayload;
}

export type HostToWebviewMessage =
  | MessageEnvelope<'app/initialize', {
      moduleId: WorkbenchModuleId;
      scope: WorkbenchScopeView;
      snapshot?: WorkbenchModuleSnapshot;
    }>
  | MessageEnvelope<'module/loading', { moduleId: WorkbenchModuleId }>
  | MessageEnvelope<'module/snapshot', { snapshot: WorkbenchModuleSnapshot }>
  | MessageEnvelope<'operation/error', {
      title: string;
      message: string;
      recoverable: boolean;
      category?: 'authentication' | 'certificate' | 'network' | 'working-copy-locked' | 'interrupted' | 'cli-missing' | 'generic';
      categoryLabel?: string;
      guidance?: string[];
      certificate?: {
        host?: string;
        fingerprint?: string;
        issuer?: string;
        validFrom?: string;
        validUntil?: string;
        failures: Array<'unknown-ca' | 'cn-mismatch' | 'expired' | 'not-yet-valid' | 'other'>;
        canTrust: boolean;
      };
      network?: {
        kind: 'dns' | 'proxy' | 'offline' | 'timeout' | 'connection-refused' | 'unknown';
      };
      recovery?: {
        moduleId: 'repository';
      };
    }>
  | MessageEnvelope<'operation/progress', { title: string; message?: string; stage?: string; scope?: string; percent?: number; cancellable?: boolean; outputAvailable?: boolean }>
  | MessageEnvelope<'operation/result', { title: string; message: string }>
  | MessageEnvelope<'operation/cancelled', { title: string; message: string }>
  | MessageEnvelope<'scope/changed', { scope: WorkbenchScopeView }>;

export type WebviewAction =
  | 'refresh'
  | 'open-module'
  | 'open-diff'
  | 'open-file'
  | 'copy-text'
  | 'security/configure-authentication'
  | 'security/clear-authentication'
  | 'security/review-certificate'
  | 'security/open-proxy-settings'
  | 'commit/update-draft'
  | 'commit/update-selection'
  | 'commit/ai-select'
  | 'commit/apply-template'
  | 'commit/generate-message'
  | 'commit/preview'
  | 'commit/execute'
  | 'history/select'
  | 'history/compare'
  | 'history/blame'
  | 'history/preview-restore'
  | 'history/execute-restore'
  | 'conflict/select'
  | 'conflict/advise'
  | 'conflict/save-working'
  | 'conflict/preview-resolve'
  | 'conflict/resolve'
  | 'settings/save-ai'
  | 'settings/test-ai'
  | 'settings/list-models'
  | 'settings/save-team'
  | 'settings/recommend-team'
  | 'settings/open-team-file'
  | 'settings/clear-team-memory'
  | 'diagnostics/run'
  | 'diagnostics/show-output'
  | 'repository/preview-update'
  | 'repository/execute-update'
  | 'repository/preview-property'
  | 'repository/execute-property'
  | 'repository/preview-cleanup'
  | 'repository/execute-cleanup'
  | 'repository/browse'
  | 'repository/preview-advanced'
  | 'repository/execute-advanced'
  | 'repository/export-patch'
  | 'repository/select-patch'
  | 'repository/generate-release-notes'
  | 'ai-review/run'
  | 'impact/run'
  | 'changelist/suggest'
  | 'changelist/preview-apply'
  | 'changelist/execute-apply'
  | 'agent/create-plan'
  | 'agent/approve-step'
  | 'agent/cancel'
  | 'changes/preview-operation'
  | 'changes/execute-operation'
  | 'changes/copy-url'
  | 'changes/show-in-repository'
  | 'operation/cancel';

export type WebviewToHostMessage =
  | MessageEnvelope<'webview/ready', Record<string, never>>
  | MessageEnvelope<'workbench/action', {
      action: WebviewAction;
      data?: Record<string, unknown>;
    }>;

const moduleIds = new Set<WorkbenchModuleId>([
  'changes',
  'commit',
  'diff',
  'history',
  'conflicts',
  'changelists',
  'ai-review',
  'impact',
  'agent',
  'repository',
  'settings',
  'diagnostics'
]);

const actions = new Set<WebviewAction>([
  'refresh',
  'open-module',
  'open-diff',
  'open-file',
  'copy-text',
  'security/configure-authentication',
  'security/clear-authentication',
  'security/review-certificate',
  'security/open-proxy-settings',
  'commit/update-draft',
  'commit/update-selection',
  'commit/ai-select',
  'commit/apply-template',
  'commit/generate-message',
  'commit/preview',
  'commit/execute',
  'history/select',
  'history/compare',
  'history/blame',
  'history/preview-restore',
  'history/execute-restore',
  'conflict/select',
  'conflict/advise',
  'conflict/save-working',
  'conflict/preview-resolve',
  'conflict/resolve',
  'settings/save-ai',
  'settings/test-ai',
  'settings/list-models',
  'settings/save-team',
  'settings/recommend-team',
  'settings/open-team-file',
  'settings/clear-team-memory',
  'diagnostics/run',
  'diagnostics/show-output',
  'repository/preview-update',
  'repository/execute-update',
  'repository/preview-property',
  'repository/execute-property',
  'repository/preview-cleanup',
  'repository/execute-cleanup',
  'repository/browse',
  'repository/preview-advanced',
  'repository/execute-advanced',
  'repository/export-patch',
  'repository/select-patch',
  'repository/generate-release-notes',
  'ai-review/run',
  'impact/run',
  'changelist/suggest',
  'changelist/preview-apply',
  'changelist/execute-apply',
  'agent/create-plan',
  'agent/approve-step',
  'agent/cancel',
  'changes/preview-operation',
  'changes/execute-operation',
  'changes/copy-url',
  'changes/show-in-repository',
  'operation/cancel'
]);

export function isWorkbenchModuleId(value: unknown): value is WorkbenchModuleId {
  return typeof value === 'string' && moduleIds.has(value as WorkbenchModuleId);
}

export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (value.protocolVersion !== WORKBENCH_PROTOCOL_VERSION || !isWorkbenchModuleId(value.moduleId)) {
    return false;
  }
  if (value.taskId !== undefined && !isWorkbenchTaskForModule(value.taskId, value.moduleId)) {
    return false;
  }
  if (value.type === 'webview/ready') {
    return isRecord(value.payload);
  }
  if (value.type !== 'workbench/action' || !isRecord(value.payload)) {
    return false;
  }
  return typeof value.repositoryUuid === 'string'
    && typeof value.scopeHash === 'string'
    && typeof value.payload.action === 'string'
    && actions.has(value.payload.action as WebviewAction);
}

export function createRequestId(prefix = 'request'): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
