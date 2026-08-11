import type { AiUsageScenario } from "../../ai/aiModelConfiguration";
import type { CommitConventionConfig } from "../../commit/commitConvention";
import type { buildCommitPlanPreview } from "../../commit/commitPlanBuilder";
import type {
  AgentSnapshot,
  ChangesSnapshot,
  ChangelistsSnapshot,
  CommitPlanView,
  CommitSnapshot,
  HistorySnapshot,
  RepositorySnapshot,
  SettingsSnapshot,
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
}

export interface WorkbenchSession extends OpenWorkbenchRequest {
  /** 每次安全上下文或 Diff 目标变化时重新生成；旧 Webview 动作必须拒绝。 */
  sessionId: string;
  taskId: WorkbenchTaskId;
  scopeView: WorkbenchScopeView;
  repositoryUuid: string;
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
    advice?: import("../../protocol/workbenchProtocol").ConflictSnapshot["advice"];
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
  };
  repositoryState?: {
    update?: RepositorySnapshot["update"];
    candidateHash?: string;
    lastResult?: RepositorySnapshot["lastResult"];
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
  };
  agentState?: {
    snapshot: AgentSnapshot;
    candidateHash: string;
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
  preview?: {
    token: string;
    stateHash: string;
    plan: ReturnType<typeof buildCommitPlanPreview>;
    view: CommitPlanView;
  };
  ai?: CommitSnapshot["ai"];
  /**
   * 提交页一次性反馈（应用本地规则结果、规则更新提示）；
   * 下次构建提交快照时消费并清除。
   */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
}
