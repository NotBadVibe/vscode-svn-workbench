import type {
  CommitSelectionDecision,
  CommitSelectionExplanation,
  CommitSelectionLayerConfig,
  CommitSelectionReasonKey,
  CommitSelectionRuleSource,
  CommitSelectionStatusKey,
  CommitSelectionStatusPolicies,
  ResolvedCommitSelectionPathRule,
} from "../commit/commitSelectionRules";

export const WORKBENCH_PROTOCOL_VERSION = 2 as const;

export type WorkbenchModuleId =
  | "changes"
  | "commit"
  | "diff"
  | "history"
  | "conflicts"
  | "changelists"
  | "ai-review"
  | "impact"
  | "agent"
  | "repository"
  | "settings"
  | "diagnostics";

export type WorkbenchTaskId =
  | "changes/overview"
  | "commit/compose"
  | "diff/working"
  | "history/revisions"
  | "conflicts/resolve"
  | "changelists/manage"
  | "ai-review/review"
  | "impact/analyze"
  | "agent/plan"
  | "repository/update"
  | "repository/recovery"
  | "repository/browse"
  | "repository/branch"
  | "repository/tag"
  | "repository/switch"
  | "repository/relocate"
  | "repository/merge"
  | "repository/patch-shelf"
  | "repository/release-notes"
  | "repository/properties"
  | "settings/ai"
  | "settings/team"
  | "settings/svn"
  | "settings/selection"
  | "diagnostics/environment"
  | "diagnostics/acceptance";

const defaultTasks: Record<WorkbenchModuleId, WorkbenchTaskId> = {
  changes: "changes/overview",
  commit: "commit/compose",
  diff: "diff/working",
  history: "history/revisions",
  conflicts: "conflicts/resolve",
  changelists: "changelists/manage",
  "ai-review": "ai-review/review",
  impact: "impact/analyze",
  agent: "agent/plan",
  repository: "repository/update",
  settings: "settings/ai",
  diagnostics: "diagnostics/environment",
};

const taskModules: Record<WorkbenchTaskId, WorkbenchModuleId> = {
  "changes/overview": "changes",
  "commit/compose": "commit",
  "diff/working": "diff",
  "history/revisions": "history",
  "conflicts/resolve": "conflicts",
  "changelists/manage": "changelists",
  "ai-review/review": "ai-review",
  "impact/analyze": "impact",
  "agent/plan": "agent",
  "repository/update": "repository",
  "repository/recovery": "repository",
  "repository/browse": "repository",
  "repository/branch": "repository",
  "repository/tag": "repository",
  "repository/switch": "repository",
  "repository/relocate": "repository",
  "repository/merge": "repository",
  "repository/patch-shelf": "repository",
  "repository/release-notes": "repository",
  "repository/properties": "repository",
  "settings/ai": "settings",
  "settings/team": "settings",
  "settings/svn": "settings",
  "settings/selection": "settings",
  "diagnostics/environment": "diagnostics",
  "diagnostics/acceptance": "diagnostics",
};

export function defaultWorkbenchTask(
  moduleId: WorkbenchModuleId,
): WorkbenchTaskId {
  return defaultTasks[moduleId];
}

export function isWorkbenchTaskId(value: unknown): value is WorkbenchTaskId {
  return typeof value === "string" && value in taskModules;
}

export function isWorkbenchTaskForModule(
  taskId: unknown,
  moduleId: WorkbenchModuleId,
): taskId is WorkbenchTaskId {
  return isWorkbenchTaskId(taskId) && taskModules[taskId] === moduleId;
}

export type WorkbenchFileStatus =
  | "normal"
  | "modified"
  | "added"
  | "deleted"
  | "missing"
  | "unversioned"
  | "conflicted"
  | "ignored"
  | "external"
  | "obstructed"
  | "replaced"
  | "incomplete"
  | "unknown";

export interface WorkbenchScopeView {
  repositoryName: string;
  roots: Array<{
    kind: "file" | "folder";
    relativePath: string;
  }>;
  source: "explorer" | "editor" | "scm" | "commandPalette" | "internal";
}

export interface WorkbenchFileView {
  relativePath: string;
  status: WorkbenchFileStatus;
  repositoryName?: string;
  ownership?: "current" | "external" | "nested";
  propStatus?: WorkbenchFileStatus;
  fileType?: string;
  selection?: "selected" | "needsReview" | "excluded" | "blocked";
  reason?: string;
  /**
   * 本地规则决策解释（规划 4.3、5.4）：最终决策、决策原因、命中规则及来源、
   * 是否不可覆盖的安全结果；提交页据此展示决策依据。
   */
  evaluation?: CommitSelectionExplanation;
}

export interface ChangesSnapshot {
  kind: "changes";
  commitDraft: string;
  files: WorkbenchFileView[];
  summary: Record<string, number>;
  refreshedAt: string;
  operationPreview?: {
    token: string;
    operation: "add" | "remove" | "revert" | "lock" | "unlock" | "ignore";
    ignoreMode?: "directory" | "repository";
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
  kind: "diff";
  relativePath: string;
  original: string;
  modified: string;
  language: string;
  truncated: boolean;
  binary: boolean;
  message?: string;
  /**
   * v0.0.6 页内编辑能力：supported=true 时 Webview 可切换编辑态并发起
   * diff/save-working；targetId 为 Host 签发的不透明标识，Webview 不接触
   * 可写绝对路径。reason 为不支持时的中文原因与恢复动作。
   */
  edit?: {
    supported: boolean;
    targetId?: string;
    reason?: string;
  };
  /** 草稿检查点（仅内存）：存在时编辑态可恢复/放弃/导出。 */
  draft?: {
    revision: number;
    updatedAt: number;
  };
}

/** diff/save-working 的结构化拒绝原因（协议 §7）。 */
export type DiffSaveRejectReason =
  | "tokenExpired"
  | "scopeChanged"
  | "diskChanged"
  | "documentDirty"
  | "targetMoved"
  | "tooLarge"
  | "unsupportedEncoding"
  | "writeFailed";

/** diff/save-working 成功响应。 */
export interface DiffSaveAccepted {
  ok: true;
  acceptedRevision: number;
  newContentHash: string;
  newEditToken: string;
  snapshotVersion: number;
}

/** diff/save-working 拒绝响应（含中文说明与草稿恢复版本）。 */
export interface DiffSaveRejected {
  ok: false;
  reason: DiffSaveRejectReason;
  message: string;
  recoverable: boolean;
  draftRevision?: number;
}

export type DiffSaveWorkingResult = DiffSaveAccepted | DiffSaveRejected;

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
  kind: "commit";
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
  /**
   * 提交文件选择场景的 AI 配置状态（规划 4.2）：
   * configured 为 true 时提交页才提供“获取 AI 建议”，否则显示“配置 AI”入口。
   */
  selectionAi: {
    configured: boolean;
    model?: string;
  };
  /**
   * 提交页一次性反馈（规划 4.2、4.3）：应用本地规则结果、规则更新提示等；
   * Host 在下发后的下一次快照构建时清除。
   */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
  ai?: {
    source: "local-rule" | "configured-model" | "local-rule-fallback";
    summary: string;
    warnings: string[];
    fallbackReason?: string;
    /**
     * AI 建议获取失败（规划 4.2）：未配置、超时或返回无效结构时保留当前选择，
     * 界面展示失败原因与“应用本地规则”恢复动作，不再静默替换为本地规则结果。
     */
    failed?: boolean;
    /**
     * binding 与当前范围/候选哈希不匹配（规划 6.3）：结果已过期，
     * 只能查看或重新生成，不能直接采用。
     */
    stale?: boolean;
    /**
     * AI 结果绑定信息（规划 5.5、6.3）：关键状态（仓库、范围、候选状态）
     * 变化后结果失效；规则来源变化时由 Host 清除。
     */
    binding?: {
      repositoryUuid: string;
      scopeHash: string;
      candidateHash: string;
      generatedAt: string;
      model?: string;
    };
  };
  aiPrivacy: Array<{
    scenario: "selection" | "message";
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
  kind: "history";
  revisions: HistoryRevisionView[];
  selectedRevision?: string;
  compareRevisions: string[];
  limit: number;
  fileActionsAvailable: boolean;
  blame?: Array<{
    line: number;
    revision: string;
    author: string;
    content: string;
  }>;
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
  kind: "conflicts";
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
    recommendation:
      | "acceptWorking"
      | "acceptMine"
      | "acceptTheirs"
      | "manualMerge"
      | "noSafeSuggestion";
    confidence: "low" | "medium" | "high";
    summary: string;
    risks: string[];
    steps: string[];
    source: "local-rule" | "configured-model" | "local-rule-fallback";
    fallbackReason?: string;
  };
  resolvePreview?: {
    token: string;
    relativePath: string;
    command: string;
    canResolve: boolean;
    issues: string[];
  };
  aiPrivacy?: {
    model: string;
    characters: number;
    maxCharacters: number;
    data: string;
    historyIncluded: false;
  };
}

/** 提交选择规则设置的可编辑作用域；当前版本仅仓库级可编辑。 */
export type CommitSelectionSettingsScope = "user" | "workspace" | "repository";

/** 设置快照中单层（用户/工作区/仓库）提交选择规则配置视图。 */
export interface CommitSelectionSettingsLayerView {
  /** 该层是否可在设置页表单中编辑；用户/工作区级只读，走 VS Code 原生设置。 */
  editable: boolean;
  /** empty=未配置；applied=已应用；failed=校验失败已回退。 */
  state: "empty" | "applied" | "failed";
  /** 该层解析后的原始配置（state 为 applied 时存在）。 */
  config?: CommitSelectionLayerConfig;
  errors: string[];
  warnings: string[];
}

/** 设置页实时预览条目：候选文件 + 本地规则最终决策与解释。 */
export interface CommitSelectionPreviewItem {
  relativePath: string;
  status: WorkbenchFileStatus;
  propStatus?: WorkbenchFileStatus;
  decision: CommitSelectionDecision;
  reasonKey: CommitSelectionReasonKey;
  statusPolicyKey?: CommitSelectionStatusKey;
  matchedRuleId?: string;
  ruleSource?: CommitSelectionRuleSource;
  safetyLocked: boolean;
}

/**
 * 设置快照的提交选择规则段（v0.0.3 阶段 3，规划 7.4）。
 * 实时预览所需的合并结果与候选清单随快照一次性下发；
 * 规则评估在 Webview 端本地执行，协议不承担高频预览往返。
 */
export interface CommitSelectionSettingsSection {
  /** 当前编辑作用域；保存与恢复默认只作用于该作用域（当前版本固定仓库级）。 */
  editingScope: CommitSelectionSettingsScope;
  /** 仓库配置文件相对仓库根的路径。 */
  configPath: string;
  layers: Record<
    CommitSelectionSettingsScope,
    CommitSelectionSettingsLayerView
  >;
  /** 有效合并结果：状态策略 + 有序路径规则（第一条命中生效，含来源）。 */
  effective: {
    statusRules: CommitSelectionStatusPolicies;
    pathRules: ResolvedCommitSelectionPathRule[];
  };
  /** 校验错误（含配置损坏降级说明）。 */
  errors: string[];
  /** 校验警告（含被更宽前置规则遮蔽的规则警告）。 */
  warnings: string[];
  /** 当前候选文件的规则预览；只进行本地计算，不调用 AI。 */
  preview: {
    state: "ready" | "empty" | "error";
    error?: string;
    items: CommitSelectionPreviewItem[];
  };
  /** 保存/恢复/刷新等动作的反馈。 */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
  /** 保存被拒绝时的结构化校验错误列表（仅保存失败时出现）。 */
  saveErrors?: string[];
}

export interface SettingsSnapshot {
  kind: "settings";
  svnSecurity: {
    authenticationActive: boolean;
    hasStoredAuthentication: boolean;
    passwordTransport: "stdin";
    certificateTrust: "explicit-svn-cache";
  };
  ai: {
    presets: Array<{
      id: string;
      label: string;
      baseUrl: string;
      model: string;
      description: string;
    }>;
    scenarios: Array<{ id: string; label: string; description: string }>;
    providerPreset: string;
    baseUrl: string;
    model: string;
    scenarioModels: Record<string, string>;
    hasApiKey: boolean;
    includeCommitHistory: boolean;
    historyLimit: number;
    models: Array<{ id: string; owner?: string }>;
    feedback?: { tone: "success" | "warning" | "error"; message: string };
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
      source: "当前仓库成功提交";
      count: number;
      maxEntries: number;
      externallyShared: false;
      recent: Array<{ revision?: string; summary: string; recordedAt: string }>;
    };
    recommendation?: {
      summary: string;
      reasons: string[];
      warnings: string[];
      confidence: "low" | "medium" | "high";
      source: "local-rule" | "configured-model" | "local-rule-fallback";
      fallbackReason?: string;
    };
  };
  selection: CommitSelectionSettingsSection;
}

export interface DiagnosticsSnapshot {
  kind: "diagnostics";
  status: "pass" | "warn" | "fail";
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
    action?: string;
  }>;
  acceptance: {
    summary: {
      sections: number;
      items: number;
      steps: number;
      expectedResults: number;
    };
    sections: Array<{
      id: string;
      title: string;
      items: Array<{
        id: string;
        title: string;
        description: string;
        steps: string[];
        expected: string[];
      }>;
    }>;
  };
  generatedAt: string;
  reportText: string;
}

export interface RepositorySnapshot {
  kind: "repository";
  recovery?: {
    category: "working-copy-locked" | "interrupted";
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
    risk: "low" | "medium" | "high";
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
      entries: Array<{
        name: string;
        kind: "file" | "dir";
        size?: number;
        revision?: string;
        author?: string;
        date?: string;
      }>;
      error?: string;
    };
    preview?: {
      token: string;
      operation:
        | "branch"
        | "tag"
        | "switch"
        | "relocate"
        | "merge"
        | "apply-patch"
        | "shelf";
      title: string;
      commands: string[];
      details: string[];
      issues: string[];
      canExecute: boolean;
      destructive: boolean;
    };
    releaseNotes?: {
      markdown: string;
      count: number;
      fromRevision?: string;
      toRevision?: string;
    };
    feedback?: string;
  };
}

export interface AiReviewSnapshot {
  kind: "ai-review";
  state: "ready" | "empty" | "stale";
  source: "local-rule" | "configured-model" | "local-rule-fallback";
  generatedAt: string;
  privacy: {
    files: number;
    characters: number;
    maxCharacters: number;
    historyIncluded: boolean;
    model: string;
  };
  summary: { critical: number; warning: number; note: number };
  findings: Array<{
    id: string;
    severity: "critical" | "warning" | "note";
    category: "security" | "debug" | "generated" | "quality" | "testing";
    relativePath?: string;
    line?: number;
    title: string;
    evidence: string;
    recommendation: string;
    confidence: "low" | "medium" | "high";
  }>;
  warnings: string[];
}

export interface ImpactSnapshot {
  kind: "impact";
  generatedAt: string;
  source: "local-rule" | "configured-model" | "local-rule-fallback";
  changedFiles: number;
  areas: Array<{
    id: string;
    title: string;
    detail: string;
    paths: string[];
    risk: "low" | "medium" | "high";
  }>;
  tests: Array<{ title: string; reason: string; command?: string }>;
  observations: string[];
  warnings: string[];
}

export interface ChangelistsSnapshot {
  kind: "changelists";
  source: "local-rule" | "configured-model" | "local-rule-fallback";
  fallbackReason?: string;
  aiPrivacy: {
    model: string;
    fileLimit: number;
    data: string;
    historyIncluded: false;
  };
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
  kind: "agent";
  status: "idle" | "planned" | "running" | "completed" | "cancelled" | "failed";
  objective: string;
  guardrails: string[];
  steps: Array<{
    id: string;
    title: string;
    detail: string;
    capability: "svn-read" | "local-analysis";
    command?: string;
    scope: string;
    risk: string;
    reversibility: string;
    status: "pending" | "running" | "completed" | "failed" | "cancelled";
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
  sessionId?: string;
  repositoryUuid?: string;
  scopeHash?: string;
  payload: TPayload;
}

export type HostToWebviewMessage =
  | MessageEnvelope<
      "app/initialize",
      {
        moduleId: WorkbenchModuleId;
        scope: WorkbenchScopeView;
        snapshot?: WorkbenchModuleSnapshot;
      }
    >
  | MessageEnvelope<"module/loading", { moduleId: WorkbenchModuleId }>
  | MessageEnvelope<"module/snapshot", { snapshot: WorkbenchModuleSnapshot }>
  | MessageEnvelope<
      "operation/error",
      {
        title: string;
        message: string;
        recoverable: boolean;
        category?:
          | "authentication"
          | "certificate"
          | "network"
          | "working-copy-locked"
          | "interrupted"
          | "cli-missing"
          | "generic";
        categoryLabel?: string;
        guidance?: string[];
        certificate?: {
          host?: string;
          fingerprint?: string;
          issuer?: string;
          validFrom?: string;
          validUntil?: string;
          failures: Array<
            "unknown-ca" | "cn-mismatch" | "expired" | "not-yet-valid" | "other"
          >;
          canTrust: boolean;
        };
        network?: {
          kind:
            | "dns"
            | "proxy"
            | "offline"
            | "timeout"
            | "connection-refused"
            | "unknown";
        };
        recovery?: {
          moduleId: "repository";
        };
      }
    >
  | MessageEnvelope<
      "operation/progress",
      {
        title: string;
        message?: string;
        stage?: string;
        scope?: string;
        percent?: number;
        cancellable?: boolean;
        outputAvailable?: boolean;
      }
    >
  | MessageEnvelope<
      "diff/edit-opened",
      {
        targetId: string;
        editToken: string;
        draftRevision: number;
        baseHash: string;
        baseRevision: string;
        rawHash: string;
        baseContents: string;
        message: string;
      }
    >
  | MessageEnvelope<
      "diff/save-result",
      {
        /** 结果所属目标（编辑会话基准更新按此匹配）。 */
        targetId: string;
        result: DiffSaveWorkingResult;
        snapshotVersion: number;
      }
    >
  | MessageEnvelope<
      "diff/draft-checkpointed",
      {
        targetId: string;
        draftRevision: number;
      }
    >
  | MessageEnvelope<
      "diff/target-switch-confirm",
      {
        /** 当前仍持有脏草稿的目标。 */
        currentTargetId: string;
        /** 即将打开的新目标（展示用相对路径）。 */
        nextRelativePath: string;
      }
    >
  | MessageEnvelope<"operation/result", { title: string; message: string }>
  | MessageEnvelope<"operation/cancelled", { title: string; message: string }>
  | MessageEnvelope<"scope/changed", { scope: WorkbenchScopeView }>;

export type WebviewAction =
  | "refresh"
  | "open-module"
  | "open-diff"
  | "open-file"
  | "diff/open-in-editor"
  | "diff/open-edit"
  | "diff/save-working"
  | "diff/draft-checkpoint"
  | "diff/draft-abandon"
  | "diff/draft-export"
  | "diff/target-switch-decision"
  | "copy-text"
  | "security/configure-authentication"
  | "security/clear-authentication"
  | "security/review-certificate"
  | "security/open-proxy-settings"
  | "commit/update-draft"
  | "commit/update-selection"
  | "commit/apply-local-rules"
  | "commit/ai-select"
  | "commit/apply-template"
  | "commit/generate-message"
  | "commit/preview"
  | "commit/execute"
  | "history/select"
  | "history/compare"
  | "history/blame"
  | "history/preview-restore"
  | "history/execute-restore"
  | "conflict/select"
  | "conflict/advise"
  | "conflict/save-working"
  | "conflict/preview-resolve"
  | "conflict/resolve"
  | "settings/save-ai"
  | "settings/test-ai"
  | "settings/list-models"
  | "settings/save-team"
  | "settings/recommend-team"
  | "settings/open-team-file"
  | "settings/clear-team-memory"
  | "settings/save-selection"
  | "settings/restore-selection-defaults"
  | "settings/open-selection-file"
  | "settings/refresh-selection-preview"
  | "settings/open-selection-vscode-settings"
  | "diagnostics/run"
  | "diagnostics/show-output"
  | "repository/preview-update"
  | "repository/execute-update"
  | "repository/preview-property"
  | "repository/execute-property"
  | "repository/preview-cleanup"
  | "repository/execute-cleanup"
  | "repository/browse"
  | "repository/preview-advanced"
  | "repository/execute-advanced"
  | "repository/export-patch"
  | "repository/select-patch"
  | "repository/generate-release-notes"
  | "ai-review/run"
  | "impact/run"
  | "changelist/suggest"
  | "changelist/preview-apply"
  | "changelist/execute-apply"
  | "agent/create-plan"
  | "agent/approve-step"
  | "agent/cancel"
  | "changes/preview-operation"
  | "changes/execute-operation"
  | "changes/copy-url"
  | "changes/show-in-repository"
  | "operation/cancel";

export type WebviewToHostMessage =
  | MessageEnvelope<"webview/ready", Record<string, never>>
  | MessageEnvelope<
      "workbench/action",
      {
        action: WebviewAction;
        data?: Record<string, unknown>;
      }
    >;

const moduleIds = new Set<WorkbenchModuleId>([
  "changes",
  "commit",
  "diff",
  "history",
  "conflicts",
  "changelists",
  "ai-review",
  "impact",
  "agent",
  "repository",
  "settings",
  "diagnostics",
]);

/**
 * Webview 动作运行时清单（规划 9.2）：与 WebviewAction 字面量联合双处维护。
 * 下方 WebviewActionListConsistency 在编译期断言两侧同步，防止遗漏。
 */
export const webviewActions = [
  "refresh",
  "open-module",
  "open-diff",
  "open-file",
  "diff/open-in-editor",
  "diff/open-edit",
  "diff/save-working",
  "diff/draft-checkpoint",
  "diff/draft-abandon",
  "diff/draft-export",
  "diff/target-switch-decision",
  "copy-text",
  "security/configure-authentication",
  "security/clear-authentication",
  "security/review-certificate",
  "security/open-proxy-settings",
  "commit/update-draft",
  "commit/update-selection",
  "commit/apply-local-rules",
  "commit/ai-select",
  "commit/apply-template",
  "commit/generate-message",
  "commit/preview",
  "commit/execute",
  "history/select",
  "history/compare",
  "history/blame",
  "history/preview-restore",
  "history/execute-restore",
  "conflict/select",
  "conflict/advise",
  "conflict/save-working",
  "conflict/preview-resolve",
  "conflict/resolve",
  "settings/save-ai",
  "settings/test-ai",
  "settings/list-models",
  "settings/save-team",
  "settings/recommend-team",
  "settings/open-team-file",
  "settings/clear-team-memory",
  "settings/save-selection",
  "settings/restore-selection-defaults",
  "settings/open-selection-file",
  "settings/refresh-selection-preview",
  "settings/open-selection-vscode-settings",
  "diagnostics/run",
  "diagnostics/show-output",
  "repository/preview-update",
  "repository/execute-update",
  "repository/preview-property",
  "repository/execute-property",
  "repository/preview-cleanup",
  "repository/execute-cleanup",
  "repository/browse",
  "repository/preview-advanced",
  "repository/execute-advanced",
  "repository/export-patch",
  "repository/select-patch",
  "repository/generate-release-notes",
  "ai-review/run",
  "impact/run",
  "changelist/suggest",
  "changelist/preview-apply",
  "changelist/execute-apply",
  "agent/create-plan",
  "agent/approve-step",
  "agent/cancel",
  "changes/preview-operation",
  "changes/execute-operation",
  "changes/copy-url",
  "changes/show-in-repository",
  "operation/cancel",
] as const satisfies readonly WebviewAction[];

type AssertNever<T extends never> = T;

/** 编译期一致性断言：字面量联合有而运行时清单没有的成员会让本行编译失败。 */
export type WebviewActionListConsistency = AssertNever<
  Exclude<WebviewAction, (typeof webviewActions)[number]>
>;

const actions = new Set<WebviewAction>(webviewActions);

export function isWorkbenchModuleId(
  value: unknown,
): value is WorkbenchModuleId {
  return typeof value === "string" && moduleIds.has(value as WorkbenchModuleId);
}

export function isWebviewToHostMessage(
  value: unknown,
): value is WebviewToHostMessage {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.protocolVersion !== WORKBENCH_PROTOCOL_VERSION ||
    !isWorkbenchModuleId(value.moduleId)
  ) {
    return false;
  }
  if (
    value.taskId !== undefined &&
    !isWorkbenchTaskForModule(value.taskId, value.moduleId)
  ) {
    return false;
  }
  if (value.type === "webview/ready") {
    return isRecord(value.payload);
  }
  if (value.type !== "workbench/action" || !isRecord(value.payload)) {
    return false;
  }
  return (
    typeof value.sessionId === "string" &&
    typeof value.repositoryUuid === "string" &&
    typeof value.scopeHash === "string" &&
    typeof value.payload.action === "string" &&
    actions.has(value.payload.action as WebviewAction)
  );
}

export function createRequestId(prefix = "request"): string {
  const random = globalThis.crypto.randomUUID().replaceAll("-", "");
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
