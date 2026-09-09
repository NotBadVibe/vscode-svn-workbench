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
import type {
  AnalysisReceipt,
  DiffCoverageState,
  DiffCoverageSummary,
  EvidenceReference,
  ValidatedCommitMessageClaim,
} from "../commit/commitDiffEvidence";
import type { ChangeUnderstandingSnapshot } from "../understanding/changeUnderstanding";

export type { ChangeUnderstandingSnapshot } from "../understanding/changeUnderstanding";
export type { EvidenceReference } from "../commit/commitDiffEvidence";
export type {
  OperationIntentKind,
  OperationIntentView,
} from "../operation/operationIntent";
import type { DisplayPath } from "../scope/pathBrands";
import type { SelectionKey } from "../selection/selectionCore";
import type { ReviewQueueItemView, ReviewQueueView } from "../diff/reviewQueue";

export type { ReviewQueueItemView, ReviewQueueView } from "../diff/reviewQueue";

/**
 * V023-R18：Diff 审阅队列视图别名（只读进度，不携带可写操作身份）。
 * 队列只描述顺序与已看/未看；标已看不代表提交授权或质量通过。
 */
export type DiffReviewQueueView = ReviewQueueView;
export type DiffReviewQueueItemView = ReviewQueueItemView;

export const WORKBENCH_PROTOCOL_VERSION = 2 as const;

export type WorkbenchModuleId =
  | "changes"
  | "commit"
  | "update"
  | "diff"
  | "history"
  | "conflicts"
  | "changelists"
  | "understanding"
  | "repository"
  | "settings"
  | "diagnostics"
  | "projects"
  | "activity";

export type WorkbenchTaskId =
  | "changes/overview"
  | "commit/compose"
  | "diff/working"
  | "history/revisions"
  | "conflicts/resolve"
  | "changelists/manage"
  | "understanding/analyze"
  | "update/preview"
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
  | "diagnostics/acceptance"
  | "projects/overview"
  | "activity/timeline";

const defaultTasks: Record<WorkbenchModuleId, WorkbenchTaskId> = {
  changes: "changes/overview",
  commit: "commit/compose",
  diff: "diff/working",
  history: "history/revisions",
  conflicts: "conflicts/resolve",
  changelists: "changelists/manage",
  understanding: "understanding/analyze",
  update: "update/preview",
  repository: "repository/browse",
  settings: "settings/ai",
  diagnostics: "diagnostics/environment",
  projects: "projects/overview",
  activity: "activity/timeline",
};

const taskModules: Record<WorkbenchTaskId, WorkbenchModuleId> = {
  "changes/overview": "changes",
  "commit/compose": "commit",
  "diff/working": "diff",
  "history/revisions": "history",
  "conflicts/resolve": "conflicts",
  "changelists/manage": "changelists",
  "understanding/analyze": "understanding",
  "update/preview": "update",
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
  "projects/overview": "projects",
  "activity/timeline": "activity",
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
  /**
   * 当前项目名（v0.0.7）：多根工作区与上层工作副本场景的主显示名；
   * 未解析项目上下文时缺省，界面回退显示 repositoryName。
   */
  projectName?: string;
  /** true 表示项目根回退为工作副本根，界面需提示“尚未设置项目根”。 */
  projectRootIsFallback?: boolean;
  /** 项目根在工作副本内的 "/" 分隔相对路径；空串/缺省表示重合。 */
  projectWorkingCopyRelativePath?: DisplayPath;
  roots: Array<{
    kind: "file" | "folder";
    relativePath: DisplayPath;
  }>;
  source: "explorer" | "editor" | "scm" | "commandPalette" | "internal";
  /**
   * v0.0.18 批次 E（U-07 收尾）：范围栏快捷事实——候选文件数与工作副本
   * revision，随最新候选状态更新（与推荐带同一下发时机）。
   */
  candidateCount?: number;
  /** 工作副本 revision（v0.0.11 起会话内解析；未解析时缺省）。 */
  workingCopyRevision?: string;
  /**
   * v0.0.17 批次 C：全局推荐下一步（Host 按最新候选状态推导，随
   * app/initialize 与 scope/changed 下发）。推荐只是推荐：不替用户执行、
   * 不扩大右键范围、不自动开始写操作；Webview 可忽略（会话内，状态
   * 变化产生新 key 时重新展示，忽略不持久惩罚）。
   */
  recommendation?: ScopeRecommendation;
}

/**
 * v0.0.17 批次 C：ScopeBar 下方推荐下一步带的协议形态。
 * key 由 Host 生成（含数量等状态摘要），状态变化即 key 变化。
 */
export interface ScopeRecommendation {
  /** 稳定键：同一状态重复下发不变，状态变化后变化。 */
  key: string;
  /** 推荐标题，如“处理 3 个冲突”。 */
  title: string;
  /** 说明为什么推荐此刻做这件事。 */
  reason: string;
  /** 主按钮文案（动词 + 对象）。 */
  actionLabel: string;
  target: {
    moduleId: WorkbenchModuleId;
    taskId?: WorkbenchTaskId;
  };
  /** 涉及的冲突/文件数量（用于标题与播报）。 */
  count?: number;
}

export interface WorkbenchFileView {
  relativePath: string;
  /**
   * v0.0.8：选择集合/比较专用身份（working-copy identity + 规范化仓库内
   * 路径）。Webview 只能接收、携带与比较，绝不展示、复制或作为 SVN/fs
   * 参数；Host 动作仍提交 relativePath 并由 Host 复验范围。
   */
  selectionKey: SelectionKey;
  status: WorkbenchFileStatus;
  repositoryName?: string;
  ownership?: "current" | "external" | "nested";
  /**
   * v0.0.7：文件主路径默认显示项目内路径；缺省时使用 relativePath
   * （工作副本内路径）。显示路径不得作为 Host 写操作身份。
   */
  projectRelativePath?: DisplayPath;
  /** v0.0.7：跨项目 scope 时设置项目徽标；单项目列表不逐行重复。 */
  projectName?: string;
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

/**
 * v0.0.17 批次 E：命名筛选预设（名称 + 通配符集合，如 ["*.ts", "*.svelte"]）。
 * 存取走会话状态总线（Host WorkbenchSession，仅会话内、不落盘）；
 * patterns 使用简单通配符（* 匹配任意字符）匹配文件名，只缩小视图。
 */
export interface FilterPresetView {
  id: string;
  name: string;
  patterns: string[];
}

export interface ChangesSnapshot {
  kind: "changes";
  commitDraft: string;
  files: WorkbenchFileView[];
  summary: Record<string, number>;
  refreshedAt: string;
  /**
   * v0.1.4 V014-C1：Changes ↔ Diff 往返恢复视图（可选，向后兼容）。
   * 仅当 Host 侧存在未失效的连续任务上下文，且本次快照按最新候选
   * 计算出合法交集后下发；缺省表示无可恢复的上下文（首次进入、已消费、
   * 已失效或快照过期）。Webview 只做界面恢复（选择/活动行/滚动/草稿
   * 回填），绝不据此扩大操作范围；C2 负责消费，本字段缺省时保持现状。
   */
  continuityRestore?: ContinuityRestoreView;
  /**
   * v0.0.17 批次 E：会话共享的命名筛选预设（Host WorkbenchSession 存取，
   * Changes/Commit 共读）。预设只影响视图筛选，不改变真实操作范围。
   */
  filterPresets?: FilterPresetView[];
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

/**
 * v0.1.4 V014-C1：Changes ↔ Diff 往返恢复视图（随 Changes 快照下发）。
 *
 * 语义（与 v0.1.4 规划 §3 对齐）：
 * - 全部字段只描述“回到 Changes 时看到什么”，不携带可写操作身份；
 * - selectedKeys 是“过去已选 ∩ 最新合法候选”的交集，新出现文件永不自动加入；
 * - removedEntries 逐项说明被剔除的原因（消失/blocked/跨仓库/external）；
 * - commitDraft 仅在目标会话无更新草稿时由 Host 下发，不覆盖用户新编辑；
 * - scrollAnchorKey 是身份锚（优先），scrollAssistPixels 仅为辅助钳制；
 * - 所有字段可选/缺省友好：未知视图偏好一律缺省，Webview 按现状展示。
 */
export interface ContinuityRestoreView {
  /** 上下文版本（createContinuityContext 签发 1，迁移/失效后递增）。 */
  contextVersion: number;
  /** 来源模块（C1 固定为 changes，由 Host 写入）。 */
  originModule: WorkbenchModuleId;
  /** Changes 列表视图偏好恢复（仅界面偏好，不改变操作范围）。 */
  changesView: {
    /** 状态筛选（如 modified/conflicted；Host 无通道时缺省）。 */
    activeStatus?: string;
    /** 文件类型筛选（Host 无通道时缺省）。 */
    activeFileType?: string;
    /** 命名筛选预设 id（Host 无通道时缺省）。 */
    activePresetId?: string;
    /** 搜索文本（Host 无通道时缺省）。 */
    query?: string;
    /** 排序描述（如 "name:asc"；Host 无通道时缺省）。 */
    sort?: string;
    /** 列表密度（Host 无通道时缺省）。 */
    density?: "comfortable" | "compact";
    /** 是否只看已选项（Host 无通道时缺省）。 */
    onlySelected?: boolean;
  };
  /** 合法交集后的选择身份键（Host 生成的 SelectionKey，只缩小不扩大）。 */
  selectedKeys: SelectionKey[];
  /** 回退后的活动文件（焦点行对应的身份键；无合法项时缺省）。 */
  activeFileKey?: SelectionKey;
  /** 滚动锚点身份键（优先定位该文件所在行）。 */
  scrollAnchorKey?: SelectionKey;
  /** 像素辅助值（仅锚点失效时就近钳制，不得单独决定位置）。 */
  scrollAssistPixels?: number;
  /** 提交草稿原文（目标会话已有更新草稿时 Host 不下发）。 */
  commitDraft?: string;
  /** 逐项移除清单（含中文原因，直接可播报）。 */
  removedEntries: Array<{
    key: SelectionKey;
    path: string;
    reason: "disappeared" | "blocked" | "cross-repository" | "external";
    message: string;
  }>;
  /** 恢复播报（如“原文件状态已变化，已定位到最近的合法文件。”）。 */
  notices: string[];
  /** 恢复载荷生成时间（ISO）。 */
  restoredAt: string;
}

/**
 * V020-R09：Diff 比较种类。
 * - working-copy：单文件 Working Copy ↔ BASE（唯一可编辑种类）；
 * - revision-file：单文件历史 rA → rB（双侧只读，有真实单文件身份）；
 * - revision-patch：范围 rA → rB patch（双侧只读，无单文件身份）。
 */
export type DiffCompareKind =
  "working-copy" | "revision-file" | "revision-patch";

/**
 * V020-R09：Diff 展示身份（Host 签发，Webview 只展示不推导可写身份）。
 * - title：标题行主文本（如真实路径或“修订比较 r41 → r42 · 2 个路径”）；
 * - targetPath：真实单文件相对路径（仅 working-copy / revision-file 携带，
 *   revision-patch 与空/二进制/截断/多路径快照必须缺省）；
 * - leftRevision/rightRevision：左右基线（如 BASE/工作副本、r41/r42）。
 */
export interface DiffCompareView {
  kind: DiffCompareKind;
  title: string;
  targetPath?: string;
  leftRevision?: string;
  rightRevision?: string;
  pathCount?: number;
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
   * V020-R09：比较种类与展示身份（可选，向后兼容）。
   * - working-copy：单文件 Working Copy ↔ BASE，可编辑；
   * - revision-file：单文件 rA → rB，双侧只读；
   * - revision-patch：范围 rA → rB patch，双侧只读，无单文件身份。
   * 缺省的旧快照按保守规则派生（见 resolveDiffCompare）：language 为
   * diff 视为 revision-patch（只读、无路径操作），其余视为 working-copy。
   * relativePath 仅为展示文本；本地文件动作必须以 compare.targetPath
   * 为准，缺省时不得发起路径操作（防虚构路径）。
   */
  compare?: DiffCompareView;
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
  /**
   * V023-R18：连续审阅队列视图（可选，向后兼容）。
   * 缺省表示单文件模式（无队列）；携带时 Webview 只做只读展示与导航，
   * 上一文件/下一文件经既有 open-diff 切换（脏草稿走既有三选一守卫），
   * 标已看经 diff/mark-reviewed（Host 按 scope/内容指纹绑定，不缓存可复用写 token）。
   */
  review?: DiffReviewQueueView;
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

/**
 * v0.0.9 §4 提交说明建议草稿：生成（模型或本地回退）、失败、超时、取消、
 * 降级、过期均不直接覆盖用户已填写的提交说明（CommitSnapshot.message）；
 * 采用必须显式（commit/adopt-suggestion 的 insert-blank-fields / replace），
 * 替换前由 Webview 展示字符数并允许撤销。
 */
export interface CommitMessageSuggestion {
  /** 采用/放弃建议的一次性标识（与 session 绑定，Host 校验）。 */
  token: string;
  /** 建议正文；未采用前不写入 CommitSnapshot.message。 */
  message: string;
  /** 结果来源（v0.0.9 §3.1 统一文案）。 */
  source: "local-rule" | "configured-model" | "local-rule-fallback";
  /** 使用的模型（configured-model 时提供）。 */
  model?: string;
  /**
   * 生成输入仅包含文件信息与差异统计（未读取差异正文）：
   * 界面据此标记“基于文件信息”，不得声称理解具体行为。
   */
  metadataOnly: boolean;
  /**
   * v0.0.11 §2 生成输入模式：仅文件信息 / 用户确认后的受限差异。
   * limited-diff 时建议可携带逐条证据引用（evidence）。
   */
  diffMode: "metadata-only" | "limited-diff";
  /**
   * v0.0.11 §6 差异覆盖率：总候选、已分析、截断、二进制、读取失败、
   * 预算外数量；仅在 limited-diff 模式生成时提供。
   */
  coverage?: DiffCoverageSummary;
  /**
   * v0.0.11 §6 逐文件覆盖率（limited-diff 时提供）：页面可展示每个候选
   * 的分析状态，并据此识别可重试的失败项（读取失败/预算外）。
   */
  coverageFiles?: CommitDiffFileCoverageView[];
  /**
   * v0.0.11 §5 逐条声明注解层（可选，不替代 message）：每条声明带状态
   * （已证实/推断/待确认）与 Host 校验后的证据；模型标为 confirmed 但无
   * 有效证据的声明已被 Host 强制降级为 toConfirm（downgraded=true）。
   */
  claims?: ValidatedCommitMessageClaim[];
  /**
   * v0.0.11 §4/§10.1 AI11-SAFE-02 证据引用：每条引用经 Host 校验，
   * valid=false 的引用已丢弃并给出中文原因；建议正文不得引用范围外内容。
   */
  evidence?: Array<{
    reference: EvidenceReference;
    valid: boolean;
    reason?: string;
  }>;
  /** v0.0.11 §3 动作级外发回执：本次生成实际外发的数据范围与预算。 */
  receipt?: AnalysisReceipt;
  /**
   * v0.0.12 批次 B：生成时使用到的变更解读会话内确认事实（仍有效）。
   * 过期/待复核确认不会进入；采用/替换契约与 v0.0.11 不变。
   */
  userConfirmations?: string[];
  /** 生成/降级过程中的提醒（如文件过多、团队规范提示、降级原因）。 */
  warnings: string[];
  /**
   * binding 与当前范围/候选哈希不匹配（规划 6.3）：建议已过期，
   * 只能查看或重新生成，不能采用；用户草稿保持不变。
   */
  stale?: boolean;
  /** 建议绑定信息：仓库、范围、候选状态、工作副本 revision、生成时间与模型。 */
  binding?: {
    repositoryUuid: string;
    scopeHash: string;
    candidateHash: string;
    /** v0.0.11 §4：工作副本 revision（结果时效绑定之一）。 */
    revision?: string;
    generatedAt: string;
    model?: string;
  };
}

/**
 * v0.0.11 逐文件差异覆盖率（回执展示用）：覆盖分析、截断、二进制、
 * 读取失败与预算外五种状态；只携带项目内路径，不暴露本地绝对路径。
 */
export interface CommitDiffFileCoverageView {
  candidateId: string;
  projectRelativePath: DisplayPath;
  status: string;
  state: DiffCoverageState;
  diffHash: string;
  charCount: number;
  hunkCount: number;
  reason?: string;
}

/**
 * v0.0.11 §3 动作级外发回执视图：模型调用前由 Host 下发，用户确认
 * “开始模型生成”或“继续仅文件信息”后才实际调用模型；取消则不外发。
 * Webview 只能展示；token 一次性绑定 pending 回执，Host 校验。
 */
export interface CommitReceiptView {
  /** 一次性回执令牌（确认生成 / 放弃回执时回传，Host 校验）。 */
  token: string;
  /** 任务、模型、数据类型、文件数、预算与历史（规划 §8 AnalysisReceipt）。 */
  receipt: AnalysisReceipt;
  /** 差异覆盖率摘要（总候选/已分析/截断/二进制/读取失败/预算外）。 */
  coverage: DiffCoverageSummary;
  /** 逐文件覆盖率清单（用户可展开查看包含 / 排除文件）。 */
  files: CommitDiffFileCoverageView[];
  /** 预计排除文件数（范围外、二进制、读取失败、预算外合计）。 */
  excludedCount: number;
  /** 是否包含历史及条数。 */
  historyIncluded: boolean;
  historyCount?: number;
  /** 明确不会发送的数据（固定中文说明）。 */
  notSent: string[];
  /** 无法由插件证明的服务商保留策略提示。 */
  retentionNote: string;
}

/**
 * v0.0.12 批次 A：变更解读外发回执视图（与 commit/receipt 形状一致，
 * 任务固定 understand-changes；独立消息，不改动已发布 commit/receipt）。
 */
export interface UnderstandingReceiptView {
  /** 一次性回执令牌（确认生成 / 放弃回执时回传，Host 校验）。 */
  token: string;
  receipt: AnalysisReceipt;
  coverage: DiffCoverageSummary;
  files: CommitDiffFileCoverageView[];
  excludedCount: number;
  historyIncluded: boolean;
  historyCount?: number;
  notSent: string[];
  retentionNote: string;
}

/**
 * v0.0.12 批次 B：语义拆分外发回执视图（独立于 commit/understanding receipt，
 * 任务 changelist-split；脱敏与预算沿用 v0.0.11 的 6000/40000）。
 *//**
 * v0.0.12 批次 C：冲突意图解释外发回执视图（任务 conflict-interpret；
 * 明确冲突正文与逐文件字符预算）。
 */
export interface ConflictReceiptView {
  /** 一次性回执令牌（确认解释/放弃回执时回传，Host 校验）。 */
  token: string;
  receipt: AnalysisReceipt;
  /** 逐文件预算与合计字符数（base/mine/theirs/working）。 */
  files: Array<{
    name: string;
    characters: number;
    maxCharacters: number;
    truncated: boolean;
    readError?: string;
  }>;
  notSent: string[];
  retentionNote: string;
}

export interface ChangelistReceiptView {
  /** 一次性回执令牌（确认语义拆分/放弃回执时回传，Host 校验）。 */
  token: string;
  receipt: AnalysisReceipt;
  coverage: DiffCoverageSummary;
  files: CommitDiffFileCoverageView[];
  excludedCount: number;
  historyIncluded: boolean;
  historyCount?: number;
  notSent: string[];
  retentionNote: string;
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
  /** v0.0.17 批次 E：会话共享的命名筛选预设（与 Changes 共读，只影响视图）。 */
  filterPresets?: FilterPresetView[];
  /**
   * 提交页一次性反馈（规划 4.2、4.3）：应用本地规则结果、规则更新提示等；
   * Host 在下发后的下一次快照构建时清除。
   */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
  /** v0.0.9 §4：建议草稿；展示在旁侧/建议区，不写回主草稿。 */
  messageSuggestion?: CommitMessageSuggestion;
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
  /**
   * v0.1.4 V014-E：Changes → Commit 交接记录（可选，向后兼容）。
   * Host 在目标打开 Commit 时用权威候选整批复验交接选择后写入：
   * 全部合法时如实记录来源，部分非法时收缩为合法交集并逐项说明移除原因。
   * 缺省表示本次快照非交接进入（直接打开 Commit、旧快照或已失效）；
   * Webview 仅做展示（“来自本地修改，范围未扩大”与移除清单），
   * 绝不据此扩大操作范围。UI 消费属 E2，本字段缺省时保持现状。
   */
  handoff?: CommitHandoffView;
}

/**
 * v0.1.4 V014-E：Changes → Commit 交接记录视图（随 Commit 快照下发）。
 *
 * 语义：
 * - source 固定为 changes：当前唯一跨模块携带选择进入 Commit 的发送方
 *   为 Changes 主操作；若未来新增发送方，需经 OpenWorkbenchRequest 显式
 *   传递来源，不得复用本字段虚构来源。
 * - selectionVersion 为交接选择版本号（COMMIT_HANDOFF_SELECTION_VERSION），
 *   版本不匹配的载荷由 Host 忽略（fail-closed，不下发）。
 * - removedEntries 逐项说明复验剔除的原因（消失/排除项/阻止项/跨仓库），
 *   message 为可直接展示的中文原因；新文件绝不因交接自动加入。
 * - 只携带项目内相对路径，不暴露本地绝对路径，不进入日志与 URI。
 */
export interface CommitHandoffView {
  /** 交接来源模块（V014-E 固定为 changes，由 Host 写入）。 */
  source: "changes";
  /** 交接选择版本号（与 COMMIT_HANDOFF_SELECTION_VERSION 同源）。 */
  selectionVersion: number;
  /** 交接请求的选择数量（去重后）。 */
  requestedCount: number;
  /** 复验保留的合法交集数量。 */
  keptCount: number;
  /** 复验剔除清单（含中文原因，直接可播报）。 */
  removedEntries: Array<{
    path: string;
    reason: "disappeared" | "excluded" | "blocked" | "cross-repository";
    message: string;
  }>;
  /** 交接复验时间（ISO）。 */
  receivedAt: string;
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

/** v0.0.18 批次 C（C-06）：历史模块发起只读加载请求时使用的条件。 */
export interface HistoryQueryView {
  /** 较早修订号（包含）。 */
  revisionFrom?: string;
  /** 较晚修订号（包含）。 */
  revisionTo?: string;
  author?: string;
  /** YYYY-MM-DD，包含当天。 */
  dateFrom?: string;
  /** YYYY-MM-DD，包含当天。 */
  dateTo?: string;
}

export interface SnapshotFreshness {
  capturedAt: string;
  scopeHash: string;
  revision?: string;
}

export interface HistorySnapshot {
  kind: "history";
  revisions: HistoryRevisionView[];
  selectedRevision?: string;
  compareRevisions: string[];
  limit: number;
  /** 当前历史列表实际使用的只读请求条件；空对象表示未附加条件。 */
  query?: HistoryQueryView;
  /**
   * v0.0.18 批次 C（C-06）：true 表示已加载条数达到请求上限，可能还有
   * 更早修订（区分“没有更多”与“尚未加载”）；加载更早经
   * history/load-more 以更大 limit 重新采集（可取消）。
   */
  hasMore?: boolean;
  fileActionsAvailable: boolean;
  /**
   * V020-R10：行右键定位的单文件历史目标（Host 在原 scope 内复验后写入）。
   * 缺省表示目录范围历史；notice 存在时目标已失效（显示目录历史并提供返回入口）。
   */
  fileTarget?: {
    relativePath: string;
    notice?: string;
  };
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
    /**
     * v0.1.6 V016-F1：预览生成时的绑定（Webview 意向单自检 stale 用）。
     * 文件内容复验仍走 Host 内部 contentHash，不经 Webview 回传。
     */
    scopeHash?: string;
    repositoryUuid?: string;
  };
  feedback?: string;
  freshness?: SnapshotFreshness;
}

export interface ActivitySnapshot {
  kind: "activity";
  records: Array<{
    id: string;
    capturedAt: string;
    kind:
      "draft-checkpoint" | "understanding-confirmation" | "operation-execution";
    moduleId: WorkbenchModuleId;
    taskId: WorkbenchTaskId;
    projectName?: string;
    scopeHash: string;
    repositoryUuid: string;
    scopeLabel: string;
    impactedCount: number;
    previewSummary?: string;
    result?: "success" | "failed" | "pending";
    errorReason?: string;
    nextActions: Array<{
      id:
        | "retry"
        | "view-conflicts"
        | "open-output"
        | "copy-diagnostics"
        | "view-history";
      label: string;
      params?: Record<string, unknown>;
    }>;
    nonRecoverable?: boolean;
    nonRecoverableReason?: string;
  }>;
  generatedAt: string;
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
  /**
   * v0.0.10：处理进度——会话内首次采集的冲突总数、当前剩余与已处理
   * 数量。不跨会话累计；工作副本重新采集后以新会话为准。
   */
  progress?: {
    initialCount: number;
    remaining: number;
    resolvedCount: number;
  };
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
    /**
     * v0.0.13 批次 B：Host 侧冲突合并草稿（不写磁盘、不触发 Resolve）。
     * 存在时编辑器展示草稿内容；切换文件/刷新/关闭时由 Host 三选一守卫。
     */
    draft?: {
      content: string;
      revision: number;
      updatedAt: number;
      hasDraft: boolean;
      dirty: boolean;
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
  /**
   * v0.0.12 批次 C：冲突意图解释（§7 六段）。结果只辅助用户编辑工作副本；
   * 保存与 Resolve 仍走既有 token/预览/确认契约。
   */
  interpretation?: {
    myIntent: string;
    theirIntent: string;
    commonPoints: string[];
    conflictPoints: string[];
    recommendedHandling: {
      summary: string;
      recommendation:
        | "acceptWorking"
        | "acceptMine"
        | "acceptTheirs"
        | "manualMerge"
        | "noSafeSuggestion";
      evidence: string[];
    };
    businessUnknowns: string[];
    postSaveVerification: Array<{ title: string; command?: string }>;
    warnings: string[];
    source: "local-rule" | "configured-model" | "local-rule-fallback";
    fallbackReason?: string;
    binding?: {
      scopeHash: string;
      conflictHash: string;
      revision?: string;
      generatedAt: string;
    };
    stale?: boolean;
  };
  resolvePreview?: {
    token: string;
    relativePath: string;
    command: string;
    canResolve: boolean;
    issues: string[];
  };
  /**
   * v0.1.8 V018-F：外部合并工具出口（可选，向后兼容）。
   * 缺省表示 Host 尚未评估（旧快照）；携带时 Webview 据此渲染
   * 确认对话框或未配置三出口，不自动 Resolve。
   */
  externalMerge?: ExternalMergeView;
  aiPrivacy?: {
    model: string;
    characters: number;
    maxCharacters: number;
    data: string;
    historyIncluded: false;
  };
}

/** V018-F · 外部合并工具文件角色（中文标签由 Host 按四角色统一生成）。 */
export type ExternalMergeRole = "mine" | "theirs" | "base" | "result";

export interface ExternalMergeFileView {
  role: ExternalMergeRole;
  /** 中文角色标签，如“我的修改（本地）”。 */
  label: string;
  /** 工作副本内相对路径（展示用，不进入日志与 URI）。 */
  relativePath: string;
}

/**
 * V018-F · 外部合并工具视图（随 ConflictSnapshot 下发）。
 * - 只传递冲突四角色文件路径；凭据、token、AI 上下文绝不外传；
 * - preview 缺省表示未生成确认（未配置时 needsConfig=true，给出三出口）；
 * - stale=true 的预览只读，不可确认。
 */
export interface ExternalMergeView {
  /** 工具是否可用（已配置且 Host 复验存在）。 */
  available: boolean;
  /** 未配置/无效时为 true，Webview 展示三出口。 */
  needsConfig?: boolean;
  /** 工具展示名（基名或通用文案，不承诺唯一产品）。 */
  toolLabel: string;
  /** 四角色文件（展示用相对路径）。 */
  fileRoles: ExternalMergeFileView[];
  preview?: {
    token: string;
    /** 展示用命令预览（不执行，执行走 spawn 数组）。 */
    commandPreview: string;
    canOpen: boolean;
    issues: string[];
    stale?: boolean;
  };
  /** 一次性反馈（如退出后重采提示、失效说明）。 */
  feedback?: string;
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
    /** v0.0.7 §9：配置来源；inherited 为 true 时界面必须显示“继承自工作副本根”。 */
    configSource?: "project" | "workingCopy" | "vscodeSettings";
    inheritedFromWorkingCopy?: boolean;
    /** 可从工作副本根迁移到项目根时为 true。 */
    migrationAvailable?: boolean;
    /** 迁移预览（含确认令牌）；执行前 Host 重新校验源哈希与目标边界。 */
    migrationPreview?: {
      token: string;
      sourcePath: string;
      targetPath: string;
      keys: string[];
      targetContent: string;
      sourceContentAfter: string;
      issues: string[];
    };
    feedback?: { tone: "success" | "warning" | "error"; message: string };
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
    /**
     * V025-R47：提交说明样例即时校验（Host 权威结论，Webview 只展示）。
     * 基于设置页当前未保存草稿计算，不写入团队配置，不发起模型请求；
     * 逐规则结论与提交页使用同一校验逻辑，草稿变化后视为过期。
     */
    samplePreview?: TeamSamplePreview;
  };
  selection: CommitSelectionSettingsSection;
}

/** V025-R47：团队规则示例逐规则结论（Host 签发，Webview 只展示）。 */
export interface TeamSampleRuleResult {
  rule: "prefix" | "module" | "issueId";
  label: string;
  required: boolean;
  passed: boolean;
  message: string;
}

/** V025-R47：团队规则示例预览（Host 签发，Webview 只展示）。 */
export interface TeamSamplePreview {
  /** 发起校验时的样例原文（用于 Webview 判断草稿是否已变化）。 */
  sample: string;
  /** 符合前缀/模块结构的骨架；要求工单号时为占位写法，不编造真实工单号。 */
  skeleton: string;
  valid: boolean;
  configIssues: string[];
  budgetIssue?: string;
  ruleResults: TeamSampleRuleResult[];
  /** 恒为 true：结论基于未保存草稿，未写入任何配置文件，也未发起模型请求。 */
  draftBased: true;
}

export type DiagnosticActionId =
  | "selectSvnExecutable"
  | "openSettings"
  | "rerunDiagnostics"
  | "openFolder"
  | "copyDiagnostics"
  | "openUrl";

export interface DiagnosticAction {
  id: DiagnosticActionId;
  label: string;
  params?: Record<string, unknown>;
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
    actions?: DiagnosticAction[];
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

/**
 * V024-R38/R48：本地搁置清单条目视图（Host 签发，Webview 只展示）。
 * - displayName 为中文显示名；id/patchFileName 为内部安全标识；
 * - integrity 说明补丁完整性；缺省 shelves 表示尚未加载。
 */
export interface ShelfEntryView {
  id: string;
  displayName: string;
  createdAt: string;
  fileCount: number;
  files: string[];
  baselineRevision?: string;
  repositoryUuid: string;
  projectName?: string;
  patchFileName: string;
  integrity: "ok" | "missing-patch" | "corrupt" | "unreadable";
  integrityDetail?: string;
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
      /**
       * V026-R46：只读浏览上下文（可选，向后兼容）。
       * - revision：当前浏览 URL 的远端修订（解析不到即缺省，UI 显示“修订未知”）；
       * - repositoryRoot/projectUrl：仓库根与本地项目检出地址，用于说明浏览位置与本地关系；
       * - lastGoodUrl：最近一次成功浏览的 URL；失败时保留旧条目并给出返回出口。
       */
      revision?: string;
      repositoryRoot?: string;
      projectUrl?: string;
      lastGoodUrl?: string;
    };
    /**
     * V026-R46：远端只读内容预览（svn cat 内存读取，不写本地文件、不外发）。
     * binary=true 不展示正文；truncated=true 必须配截断说明与复制 URL 出口。
     */
    remoteFile?: {
      url: string;
      revision?: string;
      requestedRevision?: string;
      sourceLabel: string;
      binary?: boolean;
      truncated?: boolean;
      size?: number;
      contentPreview?: string;
      error?: string;
    };
    /** V026-R46：远端文件只读历史（svn log URL，revision 倒序，不进入工作副本范围）。 */
    remoteHistory?: {
      url: string;
      revisions: Array<{
        revision: string;
        author?: string;
        date?: string;
        message?: string;
      }>;
      error?: string;
    };
    /**
     * V026-R46：远端 revision 比较只读预览（复用 R09 revision-patch 语义：双侧只读、
     * 无本地路径操作）。超限截断展示，不写本地文件。
     */
    remoteCompare?: {
      url: string;
      fromRevision: string;
      toRevision: string;
      diffPreview?: string;
      truncated?: boolean;
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
        | "shelf"
        | "restore-shelf";
      title: string;
      commands: string[];
      details: string[];
      issues: string[];
      canExecute: boolean;
      destructive: boolean;
      /**
       * v0.1.6 V016-F1：预览生成时的绑定（Webview 意向单自检 stale 用）。
       * Host 执行前复验仍以会话权威状态为准，不信任 Webview 回传。
       */
      scopeHash?: string;
      candidateHash?: string;
      repositoryUuid?: string;
      /**
       * V026-R43：生成该预览的源/目标 URL 绑定（Host 归一化后写入）。
       * Webview 表单输入与此不一致时必须把旧预览标为失效并要求重新预览；
       * Host 执行前仍以会话内 input 为准复验，不信任 Webview 回传。
       */
      sourceUrl?: string;
      targetUrl?: string;
      sourceOrigin?: string;
      targetOrigin?: string;
    };
    releaseNotes?: {
      markdown: string;
      /** 含全部路径的完整版（导出/复制完整版用，不截断）。 */
      fullMarkdown?: string;
      count: number;
      fromRevision?: string;
      toRevision?: string;
      /**
       * V021-R14：范围采集完整性（可选，向后兼容）。
       * - revisionsRead：去重后已读取修订数；
       * - complete=false 必须配 partialReason/cancelled，不把部分结果冒充完整；
       * - omittedPathCount/truncatedRevisions：摘要省略路径数与分修订明细；
       * - resolvedHeadRevision：请求开始固定到的 HEAD（rN）；
       * - requestedFrom/requestedTo：用户原始输入（含 HEAD/空）；
       * - rangeNote：反向归一化等备注。
       */
      revisionsRead?: number;
      complete?: boolean;
      partialReason?: string;
      cancelled?: boolean;
      failedUpperBound?: string;
      omittedPathCount?: number;
      truncatedRevisions?: Array<{ revision: string; omitted: number }>;
      resolvedHeadRevision?: string;
      requestedFrom?: string;
      requestedTo?: string;
      rangeNote?: string;
    };
    feedback?: string;
    shelves?: ShelfEntryView[];
    shelvesError?: string;
    shelfFeedback?: string;
  };
}

/**
 * v0.0.17 批次 A：更新预览段（自 RepositorySnapshot 拆出，update 独立模块）。
 */
export interface UpdatePreviewView {
  token: string;
  canExecute: boolean;
  localCount: number;
  remoteCount?: number;
  checkedRevision?: string;
  risk: "low" | "medium" | "high";
  overlapPaths: string[];
  /**
   * V021-R15：远端变更明细（可选，向后兼容）。
   * - remotePaths：全部远端变更相对路径（含与本地无重叠项）；
   * - remoteItems：路径 + 远端状态（新增/删除/修改等）；
   * - remoteByStatus：按远端状态计数；
   * - remoteIncomplete=true 表示未能完整读取，此时不得把空清单当作“无变化”。
   */
  remotePaths?: string[];
  remoteItems?: Array<{ relativePath: string; repositoryStatus: string }>;
  remoteByStatus?: Record<string, number>;
  remoteIncomplete?: boolean;
  /** 预览生成时间（ISO）；执行期间 HEAD 可变化，实际数量以执行为准。 */
  previewedAt?: string;
  messages: string[];
  commands: string[];
  error?: string;
  /**
   * v0.1.6 V016-F1：预览生成时的绑定（Webview 意向单自检 stale 用）。
   * Host 执行前复验仍以会话权威状态为准，不信任 Webview 回传。
   */
  scopeHash?: string;
  candidateHash?: string;
  repositoryUuid?: string;
}

/** v0.0.17 批次 A：更新执行结果段（携带冲突直达 CTA 数据）。 */
export interface UpdateResultView {
  ok: boolean;
  revision?: string;
  hasConflicts: boolean;
  message: string;
}

/**
 * v0.0.17 批次 A/B：Update 独立模块快照（moduleId "update"，任务 update/preview）。
 * conflicts 由 Host 构建快照时采集当前范围冲突，常驻支撑“处理 N 个冲突”CTA。
 */
export interface UpdateSnapshot {
  kind: "update";
  recovery?: RepositorySnapshot["recovery"];
  info: RepositorySnapshot["info"];
  preview?: UpdatePreviewView;
  result?: UpdateResultView;
  conflicts: {
    count: number;
    paths: string[];
    /** 采集失败时如实说明；此时 count 为 0 且 CTA 不展示。 */
    error?: string;
  };
}

export interface ChangelistGroupFileView {
  relativePath: string;
  /** Host 身份键；缺失时该行只展示，不可选择。 */
  selectionKey?: SelectionKey;
  status?: WorkbenchFileStatus;
  propStatus?: WorkbenchFileStatus;
  fileType?: string;
  selection?: "selected" | "needsReview" | "excluded" | "blocked";
  reason?: string;
  projectRelativePath?: DisplayPath;
  projectName?: string;
  repositoryName?: string;
  ownership?: "current" | "external" | "nested";
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
  groups: Array<{ name: string; files: ChangelistGroupFileView[] }>;
  unassigned: WorkbenchFileView[];
  suggestions: Array<{
    id: string;
    title: string;
    summary: string;
    message: string;
    paths: string[];
    reason: string;
    risks: string[];
    /** v0.0.12 批次 B：拆分目的（语义拆分时）。 */
    purpose?: string;
    /** v0.0.12 批次 B：依赖项说明（语义拆分时）。 */
    dependencies?: string[];
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
    /**
     * V020-R08：预览生成时的绑定（Webview 自检 stale 用，向后兼容可选）。
     * Host 执行前复验仍以会话权威状态与保存的方案指纹为准，
     * 不信任 Webview 回传。
     */
    scopeHash?: string;
    candidateHash?: string;
    repositoryUuid?: string;
    /** 方案指纹（名称 + 方向 + 排序后路径，见 changelistPlan.ts）。 */
    planHash?: string;
  };
  feedback?: string;
  /**
   * v0.0.13 批次 C：会话级共享选择带入提示（不静默扩大）。
   * 当 Changes/Commit 的已选通过 session.selectedPaths 带入时，
   * 展示“已带入 N 个文件”并提供查看清单。
   */
  preselected?: {
    count: number;
    paths: string[];
  };
  /** 筛选变化仅提示的警告（不静默扩大选择）。 */
  preselectedFeedback?: string;
}

export type WorkbenchModuleSnapshot =
  | ChangesSnapshot
  | DiffSnapshot
  | CommitSnapshot
  | UpdateSnapshot
  | HistorySnapshot
  | ConflictSnapshot
  | SettingsSnapshot
  | DiagnosticsSnapshot
  | RepositorySnapshot
  | ChangelistsSnapshot
  | ProjectsSnapshot
  | ChangeUnderstandingSnapshot
  | ActivitySnapshot;

/**
 * V024-R39：项目级统计状态（Host/Webview/Mock 共用）。
 * - loading：正在采集（Webview 本地重试等待态；Host 快照终态不下发 loading）；
 * - ready：统计可信（counts 缺省仅表示非 SVN/路径缺失等不适用）；
 * - error：采集失败且无上一成功值（counts 缺省，不得当作 0）；
 * - stale：采集失败但保留上一成功值（counts 为过期值，须配 staleReason）。
 */
export type ProjectStatsStatus = "loading" | "ready" | "error" | "stale";

/**
 * v0.0.7 项目总览（§6.1）：只读优先的项目列表。允许聚合数量，但不得
 * 把多个项目自动合成一个 operationScope。
 * V024-R39：统计状态显式建模；零修改（counts 全 0）与未读取/失败（counts 缺省）
 * 不得等同；stale 必须保留上一成功值并说明过期原因与时间。
 */
export interface ProjectOverviewItem {
  /** workspace folder / 项目名称。 */
  name: string;
  /** 项目根显示路径。 */
  absolutePath: string;
  /** 路径是否仍可用。 */
  exists: boolean;
  /** 工作副本归属分类。 */
  binding:
    | "workingCopyRoot"
    | "parentWorkingCopy"
    | "nestedWorkingCopy"
    | "external"
    | "notSvn"
    | "missing";
  /** 归属分类中文标签（Host 统一生成）。 */
  bindingLabel: string;
  /** 所属工作副本根（仅展示）。 */
  workingCopyRoot?: string;
  /** 所属仓库 UUID（仅展示）。 */
  repositoryUuid?: string;
  /** 变更、冲突和未版本化数量；非 SVN 项目缺省。
   * V024-R39：缺省表示未读取/失败/不适用，绝不等于 0；零修改必须显式全 0。
   */
  counts?: { changes: number; conflicts: number; unversioned: number };
  /** V024-R39：项目级统计状态（Host 签发，Webview 只展示不推导）。 */
  statsStatus: ProjectStatsStatus;
  /** V024-R39：采集失败时的中文原因（error/stale 携带，ready 缺省）。 */
  statsError?: string;
  /** V024-R39：最近一次成功统计时间（ISO；ready/stale 携带）。 */
  statsUpdatedAt?: string;
  /** V024-R39：过期原因（stale 必带，如“工作副本统计失败，已保留上次成功值”）。 */
  staleReason?: string;
  /** 是否为当前会话项目。 */
  current: boolean;
}

export interface ProjectsSnapshot {
  kind: "projects";
  projects: ProjectOverviewItem[];
  generatedAt: string;
  /**
   * V024-R39：统计请求序号（Host 每次构建递增）。Webview 保留已见最大
   * 序号，旧序号快照晚到直接忽略，不覆盖新状态。
   */
  statsSeq: number;
}

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
        /**
         * v0.0.18 批次 A（C-03）：true 表示由“打开新手引导”命令进入，
         * Webview 应重置引导状态从头开始。
         */
        restartGuide?: boolean;
      }
    >
  | MessageEnvelope<"module/loading", { moduleId: WorkbenchModuleId }>
  | MessageEnvelope<"module/snapshot", { snapshot: WorkbenchModuleSnapshot }>
  | MessageEnvelope<
      "conflict/draft-checkpointed",
      {
        relativePath: string;
        revision: number;
        updatedAt: number;
      }
    >
  | MessageEnvelope<
      "conflict/draft-switch-confirm",
      {
        currentRelativePath: string;
        nextRelativePath: string;
      }
    >
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
  | MessageEnvelope<
      "file/path-detail-result",
      {
        /** 请求对应的工作副本内路径。 */
        relativePath: string;
        detail?: {
          projectRelativePath?: DisplayPath;
          /** 工作副本内路径（本地检出视角）。 */
          workingCopyRelativePath: DisplayPath;
          /** 仓库内路径（相对 repository root URL）；不可推导时缺省。 */
          repositoryRelativePath?: DisplayPath;
          /** 由工作副本根检出 URL 推导；SVN 不可用时缺省。 */
          svnUrl?: string;
          /** 本地完整路径只用于详情展示；复制与定位仍由 Host 完成。 */
          absolutePath: DisplayPath;
        };
        error?: string;
      }
    >
  | MessageEnvelope<"operation/result", { title: string; message: string }>
  | MessageEnvelope<"operation/cancelled", { title: string; message: string }>
  | MessageEnvelope<"scope/changed", { scope: WorkbenchScopeView }>
  | MessageEnvelope<"commit/receipt", CommitReceiptView>
  | MessageEnvelope<"understanding/receipt", UnderstandingReceiptView>
  | MessageEnvelope<"changelist/receipt", ChangelistReceiptView>
  | MessageEnvelope<"conflict/receipt", ConflictReceiptView>;

export type WebviewAction =
  | "diagnostics/select-svn-executable"
  | "diagnostics/open-settings"
  | "diagnostics/open-folder"
  | "diagnostics/copy-diagnostics"
  | "diagnostics/open-url"
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
  | "diff/mark-reviewed"
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
  | "commit/preview-receipt"
  | "commit/receipt-dismiss"
  | "commit/open-evidence"
  | "commit/retry-failed-diff"
  | "commit/adopt-suggestion"
  | "commit/undo-suggestion-replace"
  | "commit/discard-suggestion"
  | "commit/preview"
  | "commit/execute"
  | "understanding/run-local"
  | "understanding/preview-receipt"
  | "understanding/receipt-dismiss"
  | "understanding/run-model"
  | "understanding/open-evidence"
  | "understanding/retry-failed"
  | "understanding/confirm-fact"
  | "understanding/clear-confirmations"
  | "history/select"
  | "history/compare"
  | "history/view-path-diff"
  | "history/view-path-history"
  | "history/blame"
  | "history/query"
  | "history/load-more"
  | "history/preview-restore"
  | "history/execute-restore"
  | "conflict/select"
  | "conflict/advise"
  | "conflict/preview-receipt"
  | "conflict/receipt-dismiss"
  | "conflict/interpret"
  | "conflict/save-working"
  | "conflict/preview-resolve"
  | "conflict/resolve"
  | "conflict/draft-update"
  | "conflict/draft-checkpoint"
  | "conflict/draft-abandon"
  | "conflict/draft-copy"
  | "conflict/draft-export"
  | "conflict/draft-switch-decision"
  | "conflict/preview-external-merge"
  | "conflict/open-external-merge"
  | "conflict/select-merge-tool"
  | "settings/save-ai"
  | "settings/test-ai"
  | "settings/list-models"
  | "settings/save-team"
  | "settings/preview-team-sample"
  | "settings/recommend-team"
  | "settings/open-team-file"
  | "settings/preview-team-migration"
  | "settings/execute-team-migration"
  | "settings/clear-team-memory"
  | "settings/save-selection"
  | "settings/restore-selection-defaults"
  | "settings/open-selection-file"
  | "settings/refresh-selection-preview"
  | "settings/open-selection-vscode-settings"
  | "diagnostics/run"
  | "diagnostics/show-output"
  | "update/preview"
  | "update/execute"
  | "repository/preview-property"
  | "repository/execute-property"
  | "repository/preview-cleanup"
  | "repository/execute-cleanup"
  | "repository/browse"
  | "repository/preview-remote-file"
  | "repository/query-remote-history"
  | "repository/compare-remote-revisions"
  | "repository/discard-advanced-preview"
  | "repository/preview-advanced"
  | "repository/execute-advanced"
  | "repository/export-patch"
  | "repository/select-patch"
  | "repository/refresh-shelves"
  | "repository/preview-shelf-restore"
  | "repository/export-shelf"
  | "repository/delete-shelf"
  | "repository/generate-release-notes"
  | "repository/export-release-notes"
  | "changelist/suggest"
  | "changelist/preview-receipt"
  | "changelist/receipt-dismiss"
  | "changelist/run-semantic"
  | "changelist/preview-apply"
  | "changelist/execute-apply"
  | "changes/preview-operation"
  | "changes/execute-operation"
  | "changes/copy-url"
  | "changes/show-in-repository"
  | "list/save-filter-preset"
  | "list/delete-filter-preset"
  | "file/path-detail"
  | "file/copy-path"
  | "projects/open-task"
  | "projects/switch"
  | "projects/retry-stats"
  | "activity/refresh"
  | "activity/retry"
  | "activity/open-output"
  | "activity/copy-diagnostics"
  | "activity/view-conflicts"
  | "activity/view-history"
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
  "update",
  "diff",
  "history",
  "conflicts",
  "changelists",
  "understanding",
  "repository",
  "settings",
  "diagnostics",
  "projects",
  "activity",
]);

/**
 * Webview 动作运行时清单（规划 9.2）：与 WebviewAction 字面量联合双处维护。
 * 下方 WebviewActionListConsistency 在编译期断言两侧同步，防止遗漏。
 */
export const webviewActions = [
  "diagnostics/select-svn-executable",
  "diagnostics/open-settings",
  "diagnostics/open-folder",
  "diagnostics/copy-diagnostics",
  "diagnostics/open-url",
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
  "diff/mark-reviewed",
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
  "commit/preview-receipt",
  "commit/receipt-dismiss",
  "commit/open-evidence",
  "commit/retry-failed-diff",
  "commit/adopt-suggestion",
  "commit/undo-suggestion-replace",
  "commit/discard-suggestion",
  "commit/preview",
  "commit/execute",
  "understanding/run-local",
  "understanding/preview-receipt",
  "understanding/receipt-dismiss",
  "understanding/run-model",
  "understanding/open-evidence",
  "understanding/retry-failed",
  "understanding/confirm-fact",
  "understanding/clear-confirmations",
  "history/select",
  "history/compare",
  "history/view-path-diff",
  "history/view-path-history",
  "history/blame",
  "history/query",
  "history/load-more",
  "history/preview-restore",
  "history/execute-restore",
  "conflict/select",
  "conflict/advise",
  "conflict/preview-receipt",
  "conflict/receipt-dismiss",
  "conflict/interpret",
  "conflict/save-working",
  "conflict/preview-resolve",
  "conflict/resolve",
  "conflict/draft-update",
  "conflict/draft-checkpoint",
  "conflict/draft-abandon",
  "conflict/draft-copy",
  "conflict/draft-export",
  "conflict/draft-switch-decision",
  "conflict/preview-external-merge",
  "conflict/open-external-merge",
  "conflict/select-merge-tool",
  "settings/save-ai",
  "settings/test-ai",
  "settings/list-models",
  "settings/save-team",
  "settings/preview-team-sample",
  "settings/recommend-team",
  "settings/open-team-file",
  "settings/preview-team-migration",
  "settings/execute-team-migration",
  "settings/clear-team-memory",
  "settings/save-selection",
  "settings/restore-selection-defaults",
  "settings/open-selection-file",
  "settings/refresh-selection-preview",
  "settings/open-selection-vscode-settings",
  "diagnostics/run",
  "diagnostics/show-output",
  "update/preview",
  "update/execute",
  "repository/preview-property",
  "repository/execute-property",
  "repository/preview-cleanup",
  "repository/execute-cleanup",
  "repository/browse",
  "repository/preview-remote-file",
  "repository/query-remote-history",
  "repository/compare-remote-revisions",
  "repository/discard-advanced-preview",
  "repository/preview-advanced",
  "repository/execute-advanced",
  "repository/export-patch",
  "repository/select-patch",
  "repository/refresh-shelves",
  "repository/preview-shelf-restore",
  "repository/export-shelf",
  "repository/delete-shelf",
  "repository/generate-release-notes",
  "repository/export-release-notes",
  "changelist/suggest",
  "changelist/preview-receipt",
  "changelist/receipt-dismiss",
  "changelist/run-semantic",
  "changelist/preview-apply",
  "changelist/execute-apply",
  "changes/preview-operation",
  "changes/execute-operation",
  "changes/copy-url",
  "changes/show-in-repository",
  "list/save-filter-preset",
  "list/delete-filter-preset",
  "file/path-detail",
  "file/copy-path",
  "projects/open-task",
  "projects/switch",
  "projects/retry-stats",
  "activity/refresh",
  "activity/retry",
  "activity/open-output",
  "activity/copy-diagnostics",
  "activity/view-conflicts",
  "activity/view-history",
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

/**
 * v0.1.4 V014-C1：ContinuityRestoreView 类型守卫（Host/Webview/Mock 共用）。
 * 可选字段缺省即合法；类型不符、selectedKeys 非字符串数组、移除项原因非法
 * 一律拒绝（fail-closed，调用方按“无可恢复上下文”处理，保持现状）。
 */
export function isContinuityRestoreView(
  value: unknown,
): value is ContinuityRestoreView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.contextVersion !== "number" ||
    !Number.isFinite(value.contextVersion) ||
    !isWorkbenchModuleId(value.originModule) ||
    !isRecord(value.changesView) ||
    !Array.isArray(value.selectedKeys) ||
    !value.selectedKeys.every((key) => typeof key === "string") ||
    !Array.isArray(value.removedEntries) ||
    !Array.isArray(value.notices) ||
    !value.notices.every((notice) => typeof notice === "string") ||
    typeof value.restoredAt !== "string"
  ) {
    return false;
  }
  const changesView = value.changesView as Record<string, unknown>;
  if (
    (changesView.activeStatus !== undefined &&
      typeof changesView.activeStatus !== "string") ||
    (changesView.activeFileType !== undefined &&
      typeof changesView.activeFileType !== "string") ||
    (changesView.activePresetId !== undefined &&
      typeof changesView.activePresetId !== "string") ||
    (changesView.query !== undefined &&
      typeof changesView.query !== "string") ||
    (changesView.sort !== undefined && typeof changesView.sort !== "string") ||
    (changesView.density !== undefined &&
      changesView.density !== "comfortable" &&
      changesView.density !== "compact") ||
    (changesView.onlySelected !== undefined &&
      typeof changesView.onlySelected !== "boolean")
  ) {
    return false;
  }
  if (
    (value.activeFileKey !== undefined &&
      typeof value.activeFileKey !== "string") ||
    (value.scrollAnchorKey !== undefined &&
      typeof value.scrollAnchorKey !== "string") ||
    (value.scrollAssistPixels !== undefined &&
      (typeof value.scrollAssistPixels !== "number" ||
        !Number.isFinite(value.scrollAssistPixels))) ||
    (value.commitDraft !== undefined && typeof value.commitDraft !== "string")
  ) {
    return false;
  }
  const reasons = new Set([
    "disappeared",
    "blocked",
    "cross-repository",
    "external",
  ]);
  for (const entry of value.removedEntries as unknown[]) {
    if (!isRecord(entry)) {
      return false;
    }
    if (
      typeof entry.key !== "string" ||
      typeof entry.path !== "string" ||
      typeof entry.reason !== "string" ||
      !reasons.has(entry.reason) ||
      typeof entry.message !== "string"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * v0.1.4 V014-C1：ChangesSnapshot 类型守卫（新增 continuityRestore 可选字段）。
 * 无 continuityRestore 的旧快照继续接受（向后兼容）；携带时必须通过
 * isContinuityRestoreView，否则整快照拒绝。
 */
export function isChangesSnapshot(value: unknown): value is ChangesSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "changes" ||
    typeof value.commitDraft !== "string" ||
    !Array.isArray(value.files) ||
    !isRecord(value.summary) ||
    typeof value.refreshedAt !== "string"
  ) {
    return false;
  }
  if (
    value.continuityRestore !== undefined &&
    !isContinuityRestoreView(value.continuityRestore)
  ) {
    return false;
  }
  return true;
}

/**
 * v0.1.4 V014-E：CommitHandoffView 类型守卫（Host/Webview/Mock 共用）。
 * 可选字段无（全必填）；来源非 changes、版本号非有限数值、数量非数值、
 * 移除项原因非法或中文说明缺失一律拒绝（fail-closed，调用方按“无交接”
 * 处理，保持现状，不扩大范围）。
 */
export function isCommitHandoffView(
  value: unknown,
): value is CommitHandoffView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.source !== "changes" ||
    typeof value.selectionVersion !== "number" ||
    !Number.isFinite(value.selectionVersion) ||
    typeof value.requestedCount !== "number" ||
    !Number.isFinite(value.requestedCount) ||
    typeof value.keptCount !== "number" ||
    !Number.isFinite(value.keptCount) ||
    !Array.isArray(value.removedEntries) ||
    typeof value.receivedAt !== "string"
  ) {
    return false;
  }
  const reasons = new Set([
    "disappeared",
    "excluded",
    "blocked",
    "cross-repository",
  ]);
  for (const entry of value.removedEntries as unknown[]) {
    if (!isRecord(entry)) {
      return false;
    }
    if (
      typeof entry.path !== "string" ||
      typeof entry.reason !== "string" ||
      !reasons.has(entry.reason) ||
      typeof entry.message !== "string"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * v0.1.4 V014-E：CommitSnapshot 交接字段校验（新增 handoff 可选字段）。
 * 无 handoff 的旧快照继续接受（向后兼容）；携带时必须通过
 * isCommitHandoffView，否则整快照拒绝。
 */
export function isCommitSnapshot(value: unknown): value is CommitSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "commit" ||
    !Array.isArray(value.files) ||
    !isRecord(value.summary) ||
    !Array.isArray(value.selectedPaths) ||
    typeof value.message !== "string"
  ) {
    return false;
  }
  if (value.handoff !== undefined && !isCommitHandoffView(value.handoff)) {
    return false;
  }
  return true;
}

/**
 * v0.1.8 V018-F：ExternalMergeView 类型守卫（Host/Webview/Mock 共用）。
 * 可选字段缺省即合法；available/toolLabel/fileRoles 缺失、角色非法、
 * preview 结构非法一律拒绝（fail-closed，调用方按“无外部工具状态”处理）。
 */
export function isExternalMergeView(
  value: unknown,
): value is ExternalMergeView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.available !== "boolean" ||
    typeof value.toolLabel !== "string" ||
    !Array.isArray(value.fileRoles)
  ) {
    return false;
  }
  const roles = new Set(["mine", "theirs", "base", "result"]);
  for (const entry of value.fileRoles as unknown[]) {
    if (!isRecord(entry)) {
      return false;
    }
    if (
      typeof entry.role !== "string" ||
      !roles.has(entry.role) ||
      typeof entry.label !== "string" ||
      typeof entry.relativePath !== "string"
    ) {
      return false;
    }
  }
  if (
    value.needsConfig !== undefined &&
    typeof value.needsConfig !== "boolean"
  ) {
    return false;
  }
  if (value.preview !== undefined) {
    if (!isRecord(value.preview)) return false;
    const preview = value.preview as Record<string, unknown>;
    if (
      typeof preview.token !== "string" ||
      typeof preview.commandPreview !== "string" ||
      typeof preview.canOpen !== "boolean" ||
      !Array.isArray(preview.issues) ||
      !(preview.issues as unknown[]).every((i) => typeof i === "string") ||
      (preview.stale !== undefined && typeof preview.stale !== "boolean")
    ) {
      return false;
    }
  }
  if (value.feedback !== undefined && typeof value.feedback !== "string") {
    return false;
  }
  return true;
}

export function isDiffCompareView(value: unknown): value is DiffCompareView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    (value.kind !== "working-copy" &&
      value.kind !== "revision-file" &&
      value.kind !== "revision-patch") ||
    typeof value.title !== "string" ||
    value.title.length === 0
  ) {
    return false;
  }
  if (
    (value.targetPath !== undefined &&
      (typeof value.targetPath !== "string" ||
        value.targetPath.length === 0)) ||
    (value.leftRevision !== undefined &&
      typeof value.leftRevision !== "string") ||
    (value.rightRevision !== undefined &&
      typeof value.rightRevision !== "string") ||
    (value.pathCount !== undefined &&
      (typeof value.pathCount !== "number" ||
        !Number.isFinite(value.pathCount)))
  ) {
    return false;
  }
  // revision-patch 无单文件身份：携带 targetPath 视为非法（防虚构路径）。
  if (value.kind === "revision-patch" && value.targetPath !== undefined) {
    return false;
  }
  return true;
}

/**
 * V023-R18：DiffReviewQueueView 类型守卫（Host/Webview/Mock 共用）。
 * 无 review 的旧快照继续接受（向后兼容，单文件模式）；携带时逐项严检，
 * 畸形载荷一律拒绝（fail-closed，调用方按无队列处理，不扩大范围）。
 * 只读语义：此处只校验形状，不校验可写身份（队列本就不含 token）。
 */
export function isDiffReviewQueueView(
  value: unknown,
): value is DiffReviewQueueView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    !Array.isArray(value.queue) ||
    typeof value.index !== "number" ||
    !Number.isInteger(value.index) ||
    typeof value.total !== "number" ||
    !Number.isInteger(value.total) ||
    typeof value.reviewedCount !== "number" ||
    !Number.isInteger(value.reviewedCount) ||
    typeof value.unreviewedCount !== "number" ||
    !Number.isInteger(value.unreviewedCount) ||
    typeof value.scopeHash !== "string" ||
    typeof value.repositoryUuid !== "string"
  ) {
    return false;
  }
  const queue = value.queue as unknown[];
  if (value.total !== queue.length) return false;
  if (queue.length === 0) return false;
  if (value.index < -1 || value.index >= queue.length) return false;
  if (
    value.reviewedCount < 0 ||
    value.unreviewedCount < 0 ||
    value.reviewedCount + value.unreviewedCount !== queue.length
  ) {
    return false;
  }
  for (const entry of queue) {
    if (!isRecord(entry)) return false;
    if (
      typeof entry.relativePath !== "string" ||
      entry.relativePath.length === 0 ||
      typeof entry.contentHash !== "string" ||
      typeof entry.current !== "boolean" ||
      typeof entry.reviewed !== "boolean"
    ) {
      return false;
    }
  }
  if (value.notice !== undefined && typeof value.notice !== "string") {
    return false;
  }
  return true;
}

/**
 * V020-R09：DiffSnapshot 类型守卫（Host/Webview/Mock 共用）。
 * 无 compare 的旧快照继续接受（向后兼容，Webview 按保守规则派生）；
 * 携带时必须通过 isDiffCompareView，否则整快照拒绝。
 * V023-R18：无 review 的旧快照继续接受（单文件模式）；携带时必须通过
 * isDiffReviewQueueView，否则整快照拒绝。
 */
export function isDiffSnapshot(value: unknown): value is DiffSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "diff" ||
    typeof value.relativePath !== "string" ||
    typeof value.original !== "string" ||
    typeof value.modified !== "string" ||
    typeof value.language !== "string" ||
    typeof value.truncated !== "boolean" ||
    typeof value.binary !== "boolean"
  ) {
    return false;
  }
  if (value.compare !== undefined && !isDiffCompareView(value.compare)) {
    return false;
  }
  if (value.review !== undefined && !isDiffReviewQueueView(value.review)) {
    return false;
  }
  return true;
}

/**
 * V020-R05：HistoryQueryView 类型守卫（Host/Webview/Mock 共用）。
 * 全部字段可选，缺省即合法（空条件/旧载荷兼容）；携带的字段必须为 string，
 * number/对象/数组/null 等一律拒绝（fail-closed，调用方按无条件处理）。
 * 语义校验（修订号倒置、日期非法）仍由 normalizeSvnHistoryQuery 负责。
 */
export function isHistoryQueryView(value: unknown): value is HistoryQueryView {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.revisionFrom === undefined ||
      typeof value.revisionFrom === "string") &&
    (value.revisionTo === undefined || typeof value.revisionTo === "string") &&
    (value.author === undefined || typeof value.author === "string") &&
    (value.dateFrom === undefined || typeof value.dateFrom === "string") &&
    (value.dateTo === undefined || typeof value.dateTo === "string")
  );
}

/**
 * V020-R10：HistorySnapshot.fileTarget 类型守卫（Host/Webview/Mock 共用）。
 * relativePath 必填且为非空 string；notice 缺省合法，携带时必须为 string。
 * 畸形载荷（如 relativePath=42）一律拒绝（fail-closed，调用方按目录历史处理）。
 */
export function isFileTargetView(
  value: unknown,
): value is NonNullable<HistorySnapshot["fileTarget"]> {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.relativePath !== "string" ||
    value.relativePath.length === 0
  ) {
    return false;
  }
  if (value.notice !== undefined && typeof value.notice !== "string") {
    return false;
  }
  return true;
}

/**
 * V020-R05/R10：HistorySnapshot 类型守卫（Host/Webview/Mock 共用）。
 * 无 query/fileTarget 的旧快照继续接受（向后兼容）；携带时必须分别通过
 * isHistoryQueryView/isFileTargetView，否则整快照拒绝（fail-closed，
 * 调用方按无条件/目录历史处理，保持现状，不扩大范围）。
 */
export function isHistorySnapshot(value: unknown): value is HistorySnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "history" ||
    !Array.isArray(value.revisions) ||
    !Array.isArray(value.compareRevisions) ||
    typeof value.limit !== "number" ||
    !Number.isFinite(value.limit) ||
    typeof value.fileActionsAvailable !== "boolean"
  ) {
    return false;
  }
  if (value.query !== undefined && !isHistoryQueryView(value.query)) {
    return false;
  }
  if (value.fileTarget !== undefined && !isFileTargetView(value.fileTarget)) {
    return false;
  }
  return true;
}

/**
 * V021-R14：RepositorySnapshot.advanced.releaseNotes 类型守卫（Host/Webview/Mock 共用）。
 * markdown/count 必填；其余完整性字段（revisionsRead/complete/partialReason/
 * cancelled/failedUpperBound/omittedPathCount/truncatedRevisions/resolvedHeadRevision/
 * requestedFrom/requestedTo/rangeNote/fullMarkdown/fromRevision/toRevision）缺省即合法
 * （旧快照兼容），携带时必须类型正确；complete=false 的语义诚实性由 Host 构建
 * 与 Webview 渲染保证，守卫只做形状校验。畸形载荷一律拒绝（fail-closed，
 * 调用方按“无发布说明”处理，不冒充完整）。
 */
export function isReleaseNotesView(
  value: unknown,
): value is NonNullable<RepositorySnapshot["advanced"]["releaseNotes"]> {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.markdown !== "string" ||
    typeof value.count !== "number" ||
    !Number.isFinite(value.count)
  ) {
    return false;
  }
  if (
    (value.fullMarkdown !== undefined &&
      typeof value.fullMarkdown !== "string") ||
    (value.fromRevision !== undefined &&
      typeof value.fromRevision !== "string") ||
    (value.toRevision !== undefined && typeof value.toRevision !== "string") ||
    (value.revisionsRead !== undefined &&
      (typeof value.revisionsRead !== "number" ||
        !Number.isFinite(value.revisionsRead))) ||
    (value.complete !== undefined && typeof value.complete !== "boolean") ||
    (value.partialReason !== undefined &&
      typeof value.partialReason !== "string") ||
    (value.cancelled !== undefined && typeof value.cancelled !== "boolean") ||
    (value.failedUpperBound !== undefined &&
      typeof value.failedUpperBound !== "string") ||
    (value.omittedPathCount !== undefined &&
      (typeof value.omittedPathCount !== "number" ||
        !Number.isFinite(value.omittedPathCount))) ||
    (value.resolvedHeadRevision !== undefined &&
      typeof value.resolvedHeadRevision !== "string") ||
    (value.requestedFrom !== undefined &&
      typeof value.requestedFrom !== "string") ||
    (value.requestedTo !== undefined &&
      typeof value.requestedTo !== "string") ||
    (value.rangeNote !== undefined && typeof value.rangeNote !== "string")
  ) {
    return false;
  }
  if (value.truncatedRevisions !== undefined) {
    if (!Array.isArray(value.truncatedRevisions)) return false;
    for (const entry of value.truncatedRevisions as unknown[]) {
      if (!isRecord(entry)) return false;
      if (
        typeof entry.revision !== "string" ||
        typeof entry.omitted !== "number" ||
        !Number.isFinite(entry.omitted)
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * V021-R15：UpdatePreviewView 类型守卫（Host/Webview/Mock 共用）。
 * token/canExecute/localCount/risk/overlapPaths 必填；远端明细（remotePaths/
 * remoteItems/remoteByStatus/remoteIncomplete）与绑定字段缺省即合法（旧快照兼容），
 * 携带时必须逐项严检；畸形载荷（如 remotePaths=42）一律拒绝（fail-closed，
 * 调用方按“无预览”处理，不把空清单当作“无变化”）。
 */
export function isUpdatePreviewView(
  value: unknown,
): value is UpdatePreviewView {
  if (!isRecord(value)) {
    return false;
  }
  if (
    typeof value.token !== "string" ||
    value.token.length === 0 ||
    typeof value.canExecute !== "boolean" ||
    typeof value.localCount !== "number" ||
    !Number.isFinite(value.localCount) ||
    (value.risk !== "low" &&
      value.risk !== "medium" &&
      value.risk !== "high") ||
    !Array.isArray(value.overlapPaths) ||
    !(value.overlapPaths as unknown[]).every((item) => typeof item === "string")
  ) {
    return false;
  }
  if (value.remotePaths !== undefined) {
    if (
      !Array.isArray(value.remotePaths) ||
      !(value.remotePaths as unknown[]).every(
        (item) => typeof item === "string",
      )
    ) {
      return false;
    }
  }
  if (value.remoteItems !== undefined) {
    if (!Array.isArray(value.remoteItems)) return false;
    for (const entry of value.remoteItems as unknown[]) {
      if (!isRecord(entry)) return false;
      if (
        typeof entry.relativePath !== "string" ||
        typeof entry.repositoryStatus !== "string"
      ) {
        return false;
      }
    }
  }
  if (value.remoteByStatus !== undefined) {
    if (!isRecord(value.remoteByStatus)) return false;
    for (const count of Object.values(value.remoteByStatus)) {
      if (typeof count !== "number" || !Number.isFinite(count)) return false;
    }
  }
  if (
    (value.remoteCount !== undefined &&
      (typeof value.remoteCount !== "number" ||
        !Number.isFinite(value.remoteCount))) ||
    (value.checkedRevision !== undefined &&
      typeof value.checkedRevision !== "string") ||
    (value.remoteIncomplete !== undefined &&
      typeof value.remoteIncomplete !== "boolean") ||
    (value.previewedAt !== undefined &&
      typeof value.previewedAt !== "string") ||
    (value.error !== undefined && typeof value.error !== "string") ||
    (value.scopeHash !== undefined && typeof value.scopeHash !== "string") ||
    (value.candidateHash !== undefined &&
      typeof value.candidateHash !== "string") ||
    (value.repositoryUuid !== undefined &&
      typeof value.repositoryUuid !== "string")
  ) {
    return false;
  }
  if (
    value.messages !== undefined &&
    (!Array.isArray(value.messages) ||
      !(value.messages as unknown[]).every((item) => typeof item === "string"))
  ) {
    return false;
  }
  if (
    value.commands !== undefined &&
    (!Array.isArray(value.commands) ||
      !(value.commands as unknown[]).every((item) => typeof item === "string"))
  ) {
    return false;
  }
  return true;
}

/**
 * V024-R39：项目统计状态守卫（Host/Webview/Mock 共用）。
 * 非法状态字符串一律拒绝（fail-closed，调用方按无统计处理，不当作 0）。
 */
export function isProjectStatsStatus(
  value: unknown,
): value is ProjectStatsStatus {
  return (
    value === "loading" ||
    value === "ready" ||
    value === "error" ||
    value === "stale"
  );
}

/**
 * V024-R39：项目总览条目守卫（Host/Webview/Mock 共用）。
 * - statsStatus 必填且为合法状态；
 * - counts 缺省表示未读取/失败/不适用（绝不等于 0），携带时三项必须为有限数值；
 * - stale 必须携带上一成功值（counts）与 staleReason；
 * - ready/stale 携带 statsUpdatedAt（成功时间），error/stale 携带 statsError（中文原因）。
 * 畸形载荷一律拒绝（fail-closed，调用方按无该项目统计处理）。
 */
export function isProjectOverviewItem(
  value: unknown,
): value is ProjectOverviewItem {
  if (!isRecord(value)) return false;
  if (
    typeof value.name !== "string" ||
    typeof value.absolutePath !== "string" ||
    typeof value.exists !== "boolean" ||
    (value.binding !== "workingCopyRoot" &&
      value.binding !== "parentWorkingCopy" &&
      value.binding !== "nestedWorkingCopy" &&
      value.binding !== "external" &&
      value.binding !== "notSvn" &&
      value.binding !== "missing") ||
    typeof value.bindingLabel !== "string" ||
    typeof value.current !== "boolean" ||
    !isProjectStatsStatus(value.statsStatus)
  ) {
    return false;
  }
  if (
    (value.workingCopyRoot !== undefined &&
      typeof value.workingCopyRoot !== "string") ||
    (value.repositoryUuid !== undefined &&
      typeof value.repositoryUuid !== "string") ||
    (value.statsError !== undefined && typeof value.statsError !== "string") ||
    (value.statsUpdatedAt !== undefined &&
      typeof value.statsUpdatedAt !== "string") ||
    (value.staleReason !== undefined && typeof value.staleReason !== "string")
  ) {
    return false;
  }
  if (value.counts !== undefined) {
    if (!isRecord(value.counts)) return false;
    const counts = value.counts as Record<string, unknown>;
    for (const key of ["changes", "conflicts", "unversioned"] as const) {
      if (typeof counts[key] !== "number" || !Number.isFinite(counts[key])) {
        return false;
      }
    }
  }
  // stale 必须保留上一成功值并说明过期原因：缺 counts 或缺 staleReason 即非法。
  if (value.statsStatus === "stale") {
    if (value.counts === undefined || typeof value.staleReason !== "string") {
      return false;
    }
  }
  return true;
}

/**
 * V024-R39：项目总览快照守卫（Host/Webview/Mock 共用）。
 * statsSeq 必填（旧序号快照由 Webview 按序号忽略，不在此拒绝）；
 * 任一条目非法即整快照拒绝（fail-closed，调用方保留上一可信快照）。
 */
export function isProjectsSnapshot(value: unknown): value is ProjectsSnapshot {
  if (!isRecord(value)) return false;
  if (
    value.kind !== "projects" ||
    !Array.isArray(value.projects) ||
    typeof value.generatedAt !== "string" ||
    typeof value.statsSeq !== "number" ||
    !Number.isFinite(value.statsSeq)
  ) {
    return false;
  }
  for (const entry of value.projects as unknown[]) {
    if (!isProjectOverviewItem(entry)) return false;
  }
  return true;
}

/**
 * V024-R38/R48：搁置条目视图守卫（Host/Webview/Mock 共用）。
 * 缺省字段即合法（旧快照兼容）；携带时逐项严检，畸形拒绝。
 */
export function isShelfEntryView(value: unknown): value is ShelfEntryView {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.displayName !== "string" ||
    value.displayName.length === 0 ||
    typeof value.createdAt !== "string" ||
    typeof value.fileCount !== "number" ||
    !Number.isFinite(value.fileCount) ||
    !Array.isArray(value.files) ||
    !(value.files as unknown[]).every((item) => typeof item === "string") ||
    typeof value.repositoryUuid !== "string" ||
    typeof value.patchFileName !== "string" ||
    (value.integrity !== "ok" &&
      value.integrity !== "missing-patch" &&
      value.integrity !== "corrupt" &&
      value.integrity !== "unreadable")
  ) {
    return false;
  }
  if (
    (value.baselineRevision !== undefined &&
      typeof value.baselineRevision !== "string") ||
    (value.projectName !== undefined &&
      typeof value.projectName !== "string") ||
    (value.integrityDetail !== undefined &&
      typeof value.integrityDetail !== "string")
  ) {
    return false;
  }
  return true;
}

/**
 * V026-R43/R46：仓库浏览与远端只读视图类型守卫（Host/Webview/Mock 共用）。
 * 可选字段缺省即合法（旧快照兼容）；携带时必须逐项严检，畸形一律拒绝
 * （fail-closed，调用方按“无该视图”处理，不把坏载荷当作有效预览）。
 */
export function isRepositoryBrowserView(
  value: unknown,
): value is NonNullable<RepositorySnapshot["advanced"]["browser"]> {
  if (!isRecord(value)) return false;
  if (typeof value.url !== "string") return false;
  if (value.parentUrl !== undefined && typeof value.parentUrl !== "string")
    return false;
  if (!Array.isArray(value.entries)) return false;
  for (const entry of value.entries as unknown[]) {
    if (!isRecord(entry)) return false;
    if (typeof entry.name !== "string") return false;
    if (entry.kind !== "file" && entry.kind !== "dir") return false;
    if (entry.size !== undefined && typeof entry.size !== "number")
      return false;
    if (entry.revision !== undefined && typeof entry.revision !== "string")
      return false;
    if (entry.author !== undefined && typeof entry.author !== "string")
      return false;
    if (entry.date !== undefined && typeof entry.date !== "string")
      return false;
  }
  if (value.error !== undefined && typeof value.error !== "string")
    return false;
  if (value.revision !== undefined && typeof value.revision !== "string")
    return false;
  if (
    value.repositoryRoot !== undefined &&
    typeof value.repositoryRoot !== "string"
  )
    return false;
  if (value.projectUrl !== undefined && typeof value.projectUrl !== "string")
    return false;
  if (value.lastGoodUrl !== undefined && typeof value.lastGoodUrl !== "string")
    return false;
  return true;
}

export function isRepositoryRemoteFileView(
  value: unknown,
): value is NonNullable<RepositorySnapshot["advanced"]["remoteFile"]> {
  if (!isRecord(value)) return false;
  if (typeof value.url !== "string" || typeof value.sourceLabel !== "string")
    return false;
  if (value.revision !== undefined && typeof value.revision !== "string")
    return false;
  if (
    value.requestedRevision !== undefined &&
    typeof value.requestedRevision !== "string"
  )
    return false;
  if (value.binary !== undefined && typeof value.binary !== "boolean")
    return false;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean")
    return false;
  if (value.size !== undefined && typeof value.size !== "number") return false;
  if (
    value.contentPreview !== undefined &&
    typeof value.contentPreview !== "string"
  )
    return false;
  if (value.error !== undefined && typeof value.error !== "string")
    return false;
  return true;
}

export function isRepositoryRemoteHistoryView(
  value: unknown,
): value is NonNullable<RepositorySnapshot["advanced"]["remoteHistory"]> {
  if (!isRecord(value)) return false;
  if (typeof value.url !== "string") return false;
  if (!Array.isArray(value.revisions)) return false;
  for (const item of value.revisions as unknown[]) {
    if (!isRecord(item)) return false;
    if (typeof item.revision !== "string") return false;
    if (item.author !== undefined && typeof item.author !== "string")
      return false;
    if (item.date !== undefined && typeof item.date !== "string") return false;
    if (item.message !== undefined && typeof item.message !== "string")
      return false;
  }
  if (value.error !== undefined && typeof value.error !== "string")
    return false;
  return true;
}

export function isRepositoryRemoteCompareView(
  value: unknown,
): value is NonNullable<RepositorySnapshot["advanced"]["remoteCompare"]> {
  if (!isRecord(value)) return false;
  if (typeof value.url !== "string") return false;
  if (typeof value.fromRevision !== "string") return false;
  if (typeof value.toRevision !== "string") return false;
  if (value.diffPreview !== undefined && typeof value.diffPreview !== "string")
    return false;
  if (value.truncated !== undefined && typeof value.truncated !== "boolean")
    return false;
  if (value.error !== undefined && typeof value.error !== "string")
    return false;
  return true;
}

/**
 * V026-R43：高级预览源/目标绑定守卫（可选字段，缺省兼容旧预览）。
 */
export function isRepositoryAdvancedPreviewBinding(
  value: unknown,
): value is Pick<
  NonNullable<RepositorySnapshot["advanced"]["preview"]>,
  "sourceUrl" | "targetUrl" | "sourceOrigin" | "targetOrigin"
> {
  if (!isRecord(value)) return false;
  if (value.sourceUrl !== undefined && typeof value.sourceUrl !== "string")
    return false;
  if (value.targetUrl !== undefined && typeof value.targetUrl !== "string")
    return false;
  if (
    value.sourceOrigin !== undefined &&
    typeof value.sourceOrigin !== "string"
  )
    return false;
  if (
    value.targetOrigin !== undefined &&
    typeof value.targetOrigin !== "string"
  )
    return false;
  return true;
}

/**
 * V026-R43：高级操作结构化 URL 意图（Webview → Host）。
 * 兼容旧扁平 sourceUrl/targetUrl 字符串；新结构化 source/target 记录优先：
 * `{ url: string; origin?: "browse" | "manual" | "shortcut"; revision?: string }`。
 * origin 仅作展示与问题解释 hint，不参与 Host 信任判断；Host 一律归一化复验。
 */
export function readRepositoryUrlIntent(
  data: Record<string, unknown>,
  structuredKey: "source" | "target",
  legacyKey: "sourceUrl" | "targetUrl",
): { rawUrl: string; origin?: string } {
  const structured = data[structuredKey];
  if (isRecord(structured) && typeof structured.url === "string") {
    return {
      rawUrl: structured.url,
      origin:
        typeof structured.origin === "string" ? structured.origin : undefined,
    };
  }
  const legacy = data[legacyKey];
  return { rawUrl: typeof legacy === "string" ? legacy : "" };
}

/**
 * V021-R14/R15：RepositorySnapshot / UpdateSnapshot 类型守卫（Host/Webview/Mock 共用）。
 * 无 releaseNotes/preview 的旧快照继续接受（向后兼容）；携带时必须分别通过
 * isReleaseNotesView/isUpdatePreviewView，否则整快照拒绝（fail-closed）。
 */
export function isRepositorySnapshot(
  value: unknown,
): value is RepositorySnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "repository" ||
    !isRecord(value.info) ||
    !isRecord(value.properties) ||
    !isRecord(value.cleanup) ||
    !isRecord(value.advanced)
  ) {
    return false;
  }
  const advanced = value.advanced as Record<string, unknown>;
  if (
    advanced.releaseNotes !== undefined &&
    !isReleaseNotesView(advanced.releaseNotes)
  ) {
    return false;
  }
  if (advanced.shelves !== undefined) {
    if (!Array.isArray(advanced.shelves)) return false;
    for (const entry of advanced.shelves as unknown[]) {
      if (!isShelfEntryView(entry)) return false;
    }
  }
  if (
    (advanced.shelvesError !== undefined &&
      typeof advanced.shelvesError !== "string") ||
    (advanced.shelfFeedback !== undefined &&
      typeof advanced.shelfFeedback !== "string")
  ) {
    return false;
  }
  if (
    advanced.browser !== undefined &&
    !isRepositoryBrowserView(advanced.browser)
  ) {
    return false;
  }
  if (
    advanced.remoteFile !== undefined &&
    !isRepositoryRemoteFileView(advanced.remoteFile)
  ) {
    return false;
  }
  if (
    advanced.remoteHistory !== undefined &&
    !isRepositoryRemoteHistoryView(advanced.remoteHistory)
  ) {
    return false;
  }
  if (
    advanced.remoteCompare !== undefined &&
    !isRepositoryRemoteCompareView(advanced.remoteCompare)
  ) {
    return false;
  }
  if (
    advanced.preview !== undefined &&
    !isRepositoryAdvancedPreviewBinding(advanced.preview)
  ) {
    return false;
  }
  return true;
}

export function isUpdateSnapshot(value: unknown): value is UpdateSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.kind !== "update" ||
    !isRecord(value.info) ||
    !isRecord(value.conflicts)
  ) {
    return false;
  }
  const conflicts = value.conflicts as Record<string, unknown>;
  if (
    typeof conflicts.count !== "number" ||
    !Number.isFinite(conflicts.count) ||
    !Array.isArray(conflicts.paths) ||
    !(conflicts.paths as unknown[]).every((item) => typeof item === "string") ||
    (conflicts.error !== undefined && typeof conflicts.error !== "string")
  ) {
    return false;
  }
  if (value.preview !== undefined && !isUpdatePreviewView(value.preview)) {
    return false;
  }
  if (value.result !== undefined) {
    if (!isRecord(value.result)) return false;
    const result = value.result as Record<string, unknown>;
    if (
      typeof result.ok !== "boolean" ||
      typeof result.hasConflicts !== "boolean" ||
      typeof result.message !== "string" ||
      (result.revision !== undefined && typeof result.revision !== "string")
    ) {
      return false;
    }
  }
  return true;
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
