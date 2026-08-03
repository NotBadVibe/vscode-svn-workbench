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

export interface OpenWorkbenchRequest {
  moduleId: WorkbenchModuleId;
  taskId?: WorkbenchTaskId;
  svnPath: string;
  scope: OperationScope;
  targetFile?: string;
  selectedPaths?: string[];
  initialFileOperation?: {
    operation: "add" | "ignore" | "revert" | "lock" | "unlock";
    ignoreMode?: "directory" | "repository";
  };
}

export interface WorkbenchSession extends OpenWorkbenchRequest {
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
}
