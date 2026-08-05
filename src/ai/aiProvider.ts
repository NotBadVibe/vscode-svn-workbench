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
}

export interface AiCommitMessageResult {
  message: string;
  summary: string;
  warnings: string[];
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
}

export interface AiCommitSplitSuggestion {
  id: string;
  title: string;
  summary: string;
  message: string;
  paths: string[];
  reason: string;
  risks: string[];
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
}
