import type {
  AnalysisReceipt,
  DiffCoverageSummary,
  EvidenceReference,
} from "../commit/commitDiffEvidence";
import type {
  AiUnderstandingRequest,
  AiUnderstandingResult,
} from "../understanding/understandingAi";
import type { AiConflictInterpretation } from "./conflictInterpretation";

export type { AiUnderstandingRequest, AiUnderstandingResult };
export type { AiConflictInterpretation };

export interface AiProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiModelInfo {
  id: string;
  owner?: string;
}

export interface AiFileContext {
  path: string;
  relativePath?: string;
  status: string;
  type?: string;
  fileType?: string;
  templateGroup?: string;
  generatedDecision?: string;
  defaultSelection?: string;
  reason?: string;
  /** 本地规则结论：最终决策（recommended/needsReview/excluded/blocked）。 */
  localDecision?: string;
  /** 本地规则结论是否属于不可覆盖的安全结果（安全锁定）。 */
  safetyLocked?: boolean;
}

export interface AiSelectionRequest {
  scope: string;
  files: AiFileContext[];
  locale?: "zh-CN";
  policy?: {
    rightClickScopeOnly: boolean;
    excludeGeneratedByDefault: boolean;
    userFinalDecision: boolean;
  };
}

export interface AiFileDecision {
  path: string;
  reason: string;
}

export interface AiSelectionResult {
  recommended: AiFileDecision[];
  excluded: AiFileDecision[];
  needsReview: AiFileDecision[];
  blocked: AiFileDecision[];
}

export interface AiCommitMessageFileContext {
  path: string;
  status: string;
  fileType: string;
  templateGroup: string;
  reason: string;
  diff?: AiCommitMessageDiffSummary;
}

export interface AiCommitMessageDiffSummary {
  addedLines: number;
  deletedLines: number;
  hunks: number;
  binary: boolean;
  truncated: boolean;
  error?: string;
}

/**
 * v0.0.11 受限差异发送单元：经脱敏、裁剪与预算限制后的差异片段，
 * 携带不透明 candidateId 与逐差异块 hunkId 供证据绑定。
 */
export interface AiCommitMessageDiffContent {
  candidateId: string;
  projectRelativePath: string;
  content: string;
  hunks: Array<{ hunkId: string; header: string }>;
  truncated: boolean;
  binary: boolean;
}

export interface AiCommitConventionHint {
  enabled: boolean;
  requiredIssueId: boolean;
  issueIdPattern: string;
  requiredModule: boolean;
  allowedModules: string[];
  requiredPrefix: boolean;
  allowedPrefixes: string[];
  hint: string;
}

export interface AiCommitMessageRequest {
  scope: string;
  selectedFileCount: number;
  omittedFileCount: number;
  files: AiCommitMessageFileContext[];
  locale: "zh-CN";
  mode?: "draft" | "completeTemplate";
  templateId?: string;
  templateLabel?: string;
  currentMessage?: string;
  convention?: AiCommitConventionHint;
  recentHistory?: Array<{ revision?: string; summary: string }>;
  /** v0.0.12 批次 B：变更解读中仍有效的会话内确认事实。 */
  userConfirmations?: string[];
  /** v0.0.11 §2 生成输入模式。 */
  diffMode?: "metadata-only" | "limited-diff";
  /** v0.0.11 §3 动作级外发回执。 */
  receipt?: AnalysisReceipt;
  /** v0.0.11 §6 差异覆盖率（limited-diff 时携带）。 */
  coverage?: DiffCoverageSummary;
  /** v0.0.11 §2.2 受限差异正文（用户确认后按操作范围采集与脱敏）。 */
  diffs?: AiCommitMessageDiffContent[];
}

export interface AiCommitMessageResult {
  message: string;
  summary: string;
  warnings: string[];
  /**
   * v0.0.11 §4 证据引用：每条具体陈述关联的 Host 可校验证据；
   * 虚构、范围外、过期引用由 Host 丢弃并计入 coverage。
   */
  evidence?: EvidenceReference[];
  /**
   * v0.0.11 §5 逐条声明注解层（可选，不替代 message）：每条声明带
   * 状态（已证实/推断/待确认）与可关联证据；模型标为 confirmed 但无
   * 有效 Host 证据的声明由 Host 强制降级为 toConfirm。
   */
  claims?: AiCommitMessageClaim[];
}

/** v0.0.11 §5 逐条声明：文本 + 状态 + 可选证据引用。 */
export interface AiCommitMessageClaim {
  text: string;
  status: "confirmed" | "inferred" | "toConfirm";
  evidence?: EvidenceReference[];
}

export interface AiCommitSplitFileContext {
  path: string;
  status: string;
  fileType: string;
  templateGroup: string;
  moduleGroup: string;
  reason: string;
}

export interface AiCommitSplitRequest {
  scope: string;
  selectedFileCount: number;
  omittedFileCount: number;
  files: AiCommitSplitFileContext[];
  locale: "zh-CN";
  policy: {
    userFinalDecision: boolean;
    noAutoCommit: boolean;
    onlyUseProvidedFiles: boolean;
  };
  convention?: AiCommitConventionHint;
  /** v0.0.12 批次 B：变更解读中仍有效的会话内确认事实。 */
  userConfirmations?: string[];
  /** v0.0.12 批次 B：语义拆分时的受限差异片段（经独立回执/脱敏/预算）。 */
  diffs?: AiCommitMessageDiffContent[];
}

export interface AiCommitSplitSuggestion {
  id: string;
  title: string;
  summary: string;
  message: string;
  paths: string[];
  reason: string;
  risks: string[];
  /** v0.0.12 批次 B：该拆分的提交意图/目的（语义拆分时）。 */
  purpose?: string;
  /** v0.0.12 批次 B：依赖项说明（语义拆分时）。 */
  dependencies?: string[];
}

export interface AiCommitSplitResult {
  splits: AiCommitSplitSuggestion[];
  warnings: string[];
}

export interface AiTeamRulesRequest {
  repositoryName: string;
  directories: string[];
  sampleFiles: string[];
  currentConvention?: AiCommitConventionHint;
  locale: "zh-CN";
}

export interface AiTeamRulesRecommendation {
  commitConvention: AiCommitConventionHint;
  summary: string;
  reasons: string[];
  warnings: string[];
  confidence: AiConfidence;
}

export type AiConflictRecommendation =
  | "acceptWorking"
  | "acceptMine"
  | "acceptTheirs"
  | "manualMerge"
  | "noSafeSuggestion";

export type AiConfidence = "low" | "medium" | "high";

export interface AiConflictFileContent {
  path?: string;
  content?: string;
  truncated: boolean;
  readError?: string;
}

export interface AiConflictRequest {
  relativePath: string;
  operation?: string;
  type?: string;
  sourceLeftRevision?: string;
  sourceRightRevision?: string;
  contents: {
    base?: AiConflictFileContent;
    mine?: AiConflictFileContent;
    theirs?: AiConflictFileContent;
    working?: AiConflictFileContent;
  };
}

export interface AiConflictAdvice {
  recommendation: AiConflictRecommendation;
  confidence: AiConfidence;
  summary: string;
  risks: string[];
  steps: string[];
}

export interface AiProvider {
  testConnection(): Promise<void>;
  listModels(): Promise<AiModelInfo[]>;
  selectFiles(request: AiSelectionRequest): Promise<AiSelectionResult>;
  generateCommitMessage(
    request: AiCommitMessageRequest,
  ): Promise<AiCommitMessageResult>;
  suggestCommitSplits(
    request: AiCommitSplitRequest,
  ): Promise<AiCommitSplitResult>;
  recommendTeamRules(
    request: AiTeamRulesRequest,
  ): Promise<AiTeamRulesRecommendation>;
  adviseConflict(request: AiConflictRequest): Promise<AiConflictAdvice>;
  interpretConflict(
    request: AiConflictRequest,
  ): Promise<AiConflictInterpretation>;
  understandChanges(
    request: AiUnderstandingRequest,
  ): Promise<AiUnderstandingResult>;
}
