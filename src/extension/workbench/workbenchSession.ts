import type { AiUsageScenario } from "../../ai/aiModelConfiguration";
import type { CommitConventionConfig } from "../../commit/commitConvention";
import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import type { buildCommitPlanPreview } from "../../commit/commitPlanBuilder";
import type {
  ChangesSnapshot,
  ChangelistsSnapshot,
  CommitMessageSuggestion,
  CommitPlanView,
  CommitSnapshot,
  FilterPresetView,
  HistoryQueryView,
  HistorySnapshot,
  RepositorySnapshot,
  SettingsSnapshot,
  UpdatePreviewView,
  UpdateResultView,
  WorkbenchModuleId,
  WorkbenchScopeView,
  WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";
import type { OperationScope } from "../../scope/operationScope";
import type {
  SvnAuthenticationContext,
  SvnCertificateTrustContext,
} from "../../security/svnSecurityContext";
import type { SvnCertificateDetails } from "../../svn/svnErrorClassifier";

/**
 * 修订比较（history/compare）会话负载：
 * 打开 diff 模块后直接展示 rA → rB 的 patch 差异，不走 Working/BASE 快照。
 */
export interface RevisionCompareRequest {
  revisions: [string, string];
}

export interface OpenWorkbenchRequest {
  moduleId: WorkbenchModuleId;
  taskId?: WorkbenchTaskId;
  svnPath: string;
  scope: OperationScope;
  targetFile?: string;
  selectedPaths?: string[];
  revisionCompare?: RevisionCompareRequest;
  initialFileOperation?: {
    operation: "add" | "ignore" | "revert" | "lock" | "unlock";
    ignoreMode?: "directory" | "repository";
  };
  /**
   * v0.0.18 批次 A（C-03）：由“打开新手引导”命令进入时置 true，
   * 随 app/initialize 下发，Webview 重置引导状态。
   */
  restartGuide?: boolean;
}

export interface WorkbenchSession extends OpenWorkbenchRequest {
  /** 每次安全上下文或 Diff 目标变化时重新生成；旧 Webview 动作必须拒绝。 */
  sessionId: string;
  taskId: WorkbenchTaskId;
  scopeView: WorkbenchScopeView;
  repositoryUuid: string;
  /**
   * v0.0.17 批次 E：会话共享的命名筛选预设（v0.0.13 会话状态总线模式，
   * 仅会话内、不落盘）。Changes/Commit 共读；预设只影响视图筛选，
   * 不改变真实操作范围。
   */
  filterPresets?: FilterPresetView[];
  /** v0.0.17 批次 C：推荐推导输入缓存（随模块快照更新，会话内）。 */
  recommendationInput?: import("./nextStepRecommendation").ScopeRecommendationInput;
  /** v0.0.7：仓库根 URL，仅用于路径详情推导仓库内路径。 */
  repositoryRootUrl?: string;
  /** v0.0.7：工作副本根检出 URL，是推导文件 SVN URL 的唯一合法基础。 */
  workingCopyUrl?: string;
  /** v0.0.11：工作副本 revision（AI 结果时效绑定之一）。 */
  workingCopyRevision?: string;
  /**
   * v0.0.12 批次 A：变更解读会话状态（用户确认仅会话内；切换项目/会话
   * 替换即失效）。snapshot 由 sendUnderstandingSnapshot 重建。
   */
  understandingState?: import("../../understanding/changeUnderstanding").UnderstandingSessionState;
  scopeHash: string;
  aiModels: Partial<Record<AiUsageScenario, string>>;
  security: {
    authentication?: SvnAuthenticationContext;
    hasStoredAuthentication: boolean;
    certificateTrust?: SvnCertificateTrustContext;
    lastCertificate?: SvnCertificateDetails;
  };
  recoveryState?: RepositorySnapshot["recovery"];
  commitState?: CommitSessionState;
  historyState?: {
    selectedRevision?: string;
    compareRevisions: string[];
    /**
     * v0.0.18 批次 C（C-06）：会话内已请求的历史条数上限；默认 100，
     * “加载更早”逐步增大并重采（可取消）。
     */
    historyLimit?: number;
    /** v0.0.18 C-06：已应用于当前历史列表的只读查询条件。 */
    historyQuery?: HistoryQueryView;
    blame?: HistorySnapshot["blame"];
    restorePreview?: {
      token: string;
      contentHash: string;
      revision: string;
      relativePath: string;
      issues: string[];
    };
    feedback?: string;
  };
  conflictState?: {
    selectedPath?: string;
    /** v0.0.10：会话内首次冲突总数（处理进度基线）。 */
    initialCount?: number;
    /** v0.0.13 批次 B：缓存各冲突文件的原始工作副本内容，供 draft-update 无重采 */
    workingBaseContents?: Record<string, string>;
    /** v0.0.13 批次 B：缓存上次快照的冲突路径集合，供 draft-update 校验存在性无重采 */
    conflictPaths?: string[];
    advice?: import("../../protocol/workbenchProtocol").ConflictSnapshot["advice"];
    /** v0.0.12 批次 C：冲突意图解释（§7 六段）。 */
    interpretation?: import("../../protocol/workbenchProtocol").ConflictSnapshot["interpretation"];
    /** v0.0.12 批次 C：语义回执（任务 conflict-interpret，跨任务拒绝）。 */
    pendingReceipt?: {
      token: string;
      task: import("../../commit/commitDiffEvidence").AnalysisTask;
      receipt: import("../../commit/commitDiffEvidence").AnalysisReceipt;
      files: Array<{
        name: string;
        characters: number;
        maxCharacters: number;
        truncated: boolean;
        readError?: string;
      }>;
      scopeHash: string;
      conflictHash: string;
      revision?: string;
    };
    resolvePreview?: {
      token: string;
      contentHash: string;
      relativePath: string;
    };
    editState?: {
      token: string;
      contentHash: string;
      relativePath: string;
      feedback?: string;
    };
  };
  settingsState?: {
    models: Array<{ id: string; owner?: string }>;
    aiFeedback?: SettingsSnapshot["ai"]["feedback"];
    recommendedTeamConfig?: CommitConventionConfig;
    recommendation?: SettingsSnapshot["team"]["recommendation"];
    /** 提交选择规则保存/恢复/刷新动作反馈。 */
    selectionFeedback?: SettingsSnapshot["selection"]["feedback"];
    /** 保存被拒绝时的结构化校验错误列表。 */
    selectionSaveErrors?: string[];
    /** v0.0.7 §9：团队规则迁移待确认预览（含源哈希与执行计划）。 */
    teamMigration?: {
      token: string;
      sourcePath: string;
      targetPath: string;
      sourceHash: string;
      plan: {
        keys: string[];
        targetContent: string;
        sourceContentAfter: string;
        issues: string[];
      };
    };
    /** 团队规则动作一次性反馈。 */
    teamFeedback?: { tone: "success" | "warning" | "error"; message: string };
  };
  /**
   * v0.0.17 批次 A：Update 独立模块的会话状态（自 repositoryState 拆出）。
   * 预览与结果契约不变：token + candidateHash 绑定，范围/候选变化后失效。
   */
  updateState?: {
    preview?: UpdatePreviewView;
    candidateHash?: string;
    result?: UpdateResultView;
  };
  repositoryState?: {
    propertyPreview?: {
      token: string;
      stateHash: string;
      target: string;
      name: string;
      value: string;
      remove: boolean;
      issues: string[];
    };
    propertyFeedback?: string;
    cleanupPreview?: { token: string; target: string; issues: string[] };
    cleanupFeedback?: string;
    advanced?: {
      browser?: RepositorySnapshot["advanced"]["browser"];
      releaseNotes?: RepositorySnapshot["advanced"]["releaseNotes"];
      feedback?: string;
      preview?: {
        token: string;
        candidateHash: string;
        operation: NonNullable<
          RepositorySnapshot["advanced"]["preview"]
        >["operation"];
        title: string;
        commands: string[];
        details: string[];
        issues: string[];
        destructive: boolean;
        input: Record<string, string>;
      };
    };
  };
  changelistState?: {
    suggestions: ChangelistsSnapshot["suggestions"];
    warnings: string[];
    source: "local-rule" | "configured-model" | "local-rule-fallback";
    fallbackReason?: string;
    feedback?: string;
    preview?: {
      token: string;
      candidateHash: string;
      name?: string;
      remove: boolean;
      paths: string[];
      issues: string[];
    };
    /** v0.0.12 批次 B：语义拆分受限差异回执（任务 changelist-split，跨任务拒绝）。 */
    pendingReceipt?: {
      token: string;
      task: import("../../commit/commitDiffEvidence").AnalysisTask;
      receipt: import("../../commit/commitDiffEvidence").AnalysisReceipt;
      coverage: import("../../commit/commitDiffEvidence").DiffCoverageSummary;
      files: import("../../protocol/workbenchProtocol").CommitDiffFileCoverageView[];
      fragments: import("../../commit/commitDiffEvidence").CommitDiffFragment[];
      revision?: string;
      scopeHash: string;
      candidateHash: string;
      excludedCount: number;
      historyIncluded: boolean;
      historyCount?: number;
      retryNote?: string;
    };
  };
  changesState?: {
    preview?: {
      token: string;
      candidateHash: string;
      operation: NonNullable<ChangesSnapshot["operationPreview"]>["operation"];
      ignoreMode?: "directory" | "repository";
      paths: string[];
      issues: string[];
    };
    feedback?: string;
  };
  activeOperation?: {
    moduleId: WorkbenchModuleId;
    controller: AbortController;
  };
}

export interface CommitSessionState {
  message: string;
  selectedPaths?: string[];
  /**
   * 最近一次权威候选采集（buildCommitSnapshot 缓存）：commit/update-selection
   * 用它逐项复验（路径 ∈ 候选集合且非 excluded/blocked），避免每次勾选都
   * 重跑 SVN status；refresh 后重新采集并更新。
   */
  candidates?: CommitCandidate[];
  /**
   * 最后一次 commit/update-selection 的手动选择（provenance）：规则/AI
   * 应用时用它计算“新增/保留/移除手动选择”摘要，随后清空（规则/AI 接管
   * 后的选择不再称手动）。不得把规则/AI 推荐虚构成手动选择。
   */
  manualSelectedPaths?: string[];
  preview?: {
    token: string;
    stateHash: string;
    plan: ReturnType<typeof buildCommitPlanPreview>;
    view: CommitPlanView;
  };
  ai?: CommitSnapshot["ai"];
  /**
   * v0.0.9 §4：提交说明建议草稿。生成、失败、超时、取消、降级、过期均
   * 不写入 message；采用必须经 commit/adopt-suggestion 显式执行。
   */
  messageSuggestion?: CommitMessageSuggestion;
  /**
   * v0.0.9 §4：替换草稿前的备份，供 commit/undo-suggestion-replace 恢复；
   * 用户后续编辑、再次采用或放弃建议后清除。
   */
  messageSuggestionReplaceBackup?: { previous: string };
  /**
   * v0.0.11 §3：受限差异模式的外发回执（模型调用前由 commit/preview-receipt
   * 建立）。确认“开始模型生成”必须回传匹配 token；范围/候选变化或
   * commit/receipt-dismiss 后失效，不得据此继续调用模型。
   */
  pendingReceipt?: {
    token: string;
    /** v0.0.12：回执显式绑定任务；跨任务使用一律拒绝。 */
    task: import("../../commit/commitDiffEvidence").AnalysisTask;
    receipt: import("../../commit/commitDiffEvidence").AnalysisReceipt;
    coverage: import("../../commit/commitDiffEvidence").DiffCoverageSummary;
    files: import("../../protocol/workbenchProtocol").CommitDiffFileCoverageView[];
    fragments: import("../../commit/commitDiffEvidence").CommitDiffFragment[];
    revision?: string;
    scopeHash: string;
    candidateHash: string;
    excludedCount: number;
    historyIncluded: boolean;
    historyCount?: number;
    /** v0.0.11 §6：重试失败项时携带说明，生成时并入建议警告。 */
    retryNote?: string;
  };
  /**
   * 提交页一次性反馈（应用本地规则结果、规则更新提示）；
   * 下次构建提交快照时消费并清除。
   */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
}
