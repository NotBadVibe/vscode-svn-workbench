/**
 * v0.0.12 批次 A：变更解读 —— 统一结果模型与本地/模型/用户合并（纯逻辑，无 IO）。
 *
 * 负责（规划 §5/§8/§11.1）：
 * - 统一 `ChangeUnderstandingSnapshot`：状态、binding、回执、coverage、逐条
 *   changes/findings/verification、会话内用户确认、限制与草稿建议；
 * - 本地/模型/用户结果合并 `mergeUnderstandingResults`：来源逐条标记
 *   （local-rule/configured-model/user/mixed），本地硬阻止项不被模型降级；
 * - 状态机与时效 `isUnderstandingSnapshotStale`（scope/候选/revision 变化后
 *   旧结果只读、确认待复核，绝不静默沿用）；
 * - 用户确认会话内：`buildUserConfirmedFact` 绑定当前候选 hash，变化即标
 *   needsReview。
 *
 * 不负责：SVN 命令执行（见 understandingCollector.ts）、模型调用、UI。
 */

import {
  isCommitDraftEvidenceStale,
  type AnalysisReceipt,
  type AnalysisTask,
  type CommitDiffFragment,
  type DiffCoverageSummary,
  type EvidenceReference,
} from "../commit/commitDiffEvidence";
import type { CommitDiffFileCoverageView } from "../protocol/workbenchProtocol";

export type UnderstandingState =
  "idle" | "running" | "ready" | "partial" | "failed" | "stale";

/** 每条结论的来源（规划 §11.1 AI12-SOURCE-01）。 */
export type UnderstandingSource =
  "local-rule" | "configured-model" | "local-rule-fallback" | "user" | "mixed";

export type ClaimStatus = "confirmed" | "inferred" | "toConfirm";

export interface EvidenceBackedChange {
  id: string;
  /** “对象 + 变化 + 结果”的具体陈述（§4.3 statement）。 */
  statement: string;
  source: UnderstandingSource;
  status: ClaimStatus;
  /** 理由，不只是百分比（§4.3 confidenceReason）。 */
  confidenceReason: string;
  /** Host 校验后的有效证据引用。 */
  evidence: EvidenceReference[];
  /** 无效/过期/虚构引用（保留并附原因）。 */
  invalidEvidence: Array<{ reference: EvidenceReference; reason: string }>;
  limitations: string[];
  nextAction: string;
}

export interface EvidenceBackedFinding {
  id: string;
  category: "local-blocked" | "model" | "evidence-gap" | "business-unknown";
  statement: string;
  source: UnderstandingSource;
  severity: "critical" | "warning" | "note";
  /** 失败后果。 */
  consequence: string;
  evidence: EvidenceReference[];
  invalidEvidence: Array<{ reference: EvidenceReference; reason: string }>;
  limitations: string[];
  nextAction: string;
}

export interface VerificationSuggestion {
  id: string;
  title: string;
  /** 验证哪项具体风险。 */
  reason: string;
  /** 展示用命令文本（不执行）。 */
  command?: string;
  gate: "general" | "specific";
}

/** 会话内用户确认（规划 §4.3：用户确认与模型原始输出分开保存）。 */
export interface UserConfirmedFact {
  id: string;
  statement: string;
  confirmedAt: string;
  /** 确认时的候选 hash；变化后标记待复核，绝不静默沿用。 */
  candidateHash: string;
  needsReview: boolean;
}

export interface ChangeUnderstandingSnapshot {
  kind: "change-understanding";
  state: UnderstandingState;
  /** 页面级总来源（混合结果如实显示）。 */
  source: UnderstandingSource;
  binding: {
    repositoryUuid: string;
    scopeHash: string;
    candidateHash: string;
    revision?: string;
    generatedAt: string;
    model?: string;
  };
  receipt: AnalysisReceipt;
  coverage: DiffCoverageSummary;
  coverageFiles: CommitDiffFileCoverageView[];
  changes: EvidenceBackedChange[];
  findings: EvidenceBackedFinding[];
  verification: VerificationSuggestion[];
  userConfirmations: UserConfirmedFact[];
  limitations: string[];
  warnings: string[];
  /** v0.0.11 草稿建议衔接（批次 A 只读展示，不写回 Commit）。 */
  draftProposal?: {
    message: string;
    confirmedFacts: string[];
  };
  stale?: boolean;
  /** 一次性反馈（Host 下发后下一次快照清除）。 */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
}

export interface UnderstandingResultParts {
  changes: EvidenceBackedChange[];
  findings: EvidenceBackedFinding[];
  verification: VerificationSuggestion[];
  limitations: string[];
}

/** 本地/模型结果合并的输入（模型段可缺省 = 仅本地）。 */
/** 本地/模型结果合并的输入（模型段可缺省 = 仅本地）。 */
export interface MergeUnderstandingInput {
  local: UnderstandingResultParts;
  model?: { parts: UnderstandingResultParts; source: UnderstandingSource };
  userConfirmations: UserConfirmedFact[];
}

export function mergeUnderstandingResults(input: MergeUnderstandingInput): {
  parts: UnderstandingResultParts;
  source: UnderstandingSource;
  warnings: string[];
} {
  const warnings: string[] = [];
  const changes = mergeChanges(
    input.local.changes,
    input.model?.parts.changes ?? [],
  );
  const findings = mergeFindings(
    input.local.findings,
    input.model?.parts.findings ?? [],
  );
  const verification = dedupeById([
    ...input.local.verification,
    ...(input.model?.parts.verification ?? []),
  ]);
  const limitations = dedupeStrings([
    ...input.local.limitations,
    ...(input.model?.parts.limitations ?? []),
  ]);
  const source: UnderstandingSource =
    input.model === undefined
      ? "local-rule"
      : input.model.source === "local-rule-fallback"
        ? "local-rule-fallback"
        : "mixed";
  if (input.model?.source === "local-rule-fallback") {
    warnings.push("模型不可用，已使用本地结果；来源如实标记为本地回退。");
  }
  return {
    parts: { changes, findings, verification, limitations },
    source,
    warnings,
  };
}

/** 合并 changes：本地在前、模型在后；同 statement 去重（保留来源更权威者）。 */
function mergeChanges(
  local: EvidenceBackedChange[],
  model: EvidenceBackedChange[],
): EvidenceBackedChange[] {
  const seen = new Set<string>();
  const result: EvidenceBackedChange[] = [];
  for (const item of [...local, ...model]) {
    const key = item.statement.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** 合并 findings：本地硬阻止项始终在最前且不被模型降级（§9）。 */
function mergeFindings(
  local: EvidenceBackedFinding[],
  model: EvidenceBackedFinding[],
): EvidenceBackedFinding[] {
  const blocked = local.filter((item) => item.category === "local-blocked");
  const rest = dedupeById([
    ...local.filter((item) => item.category !== "local-blocked"),
    ...model,
  ]);
  return [...blocked, ...rest];
}

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

export function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * 会话内用户确认：绑定当前候选 hash；scope/候选/revision 变化后
 * 标记 needsReview（待复核），绝不静默沿用（§8 过期）。
 */
export function buildUserConfirmedFact(input: {
  statement: string;
  candidateHash: string;
  now?: string;
}): UserConfirmedFact {
  return {
    id: `user-${Math.random().toString(36).slice(2, 10)}`,
    statement: input.statement.trim(),
    confirmedAt: input.now ?? new Date().toISOString(),
    candidateHash: input.candidateHash,
    needsReview: false,
  };
}

/** 已确认事实待复核标记：当前候选 hash 与确认时不一致即 needsReview。 */
export function markConfirmationsNeedsReview(
  confirmations: UserConfirmedFact[],
  currentCandidateHash: string,
): UserConfirmedFact[] {
  return confirmations.map((fact) =>
    fact.candidateHash !== currentCandidateHash
      ? { ...fact, needsReview: true }
      : fact,
  );
}

/**
 * 快照时效（规划 §8 过期）：scope、候选或 revision 变化后旧结果只读、
 * 确认待复核；重新分析才恢复。
 */
export function isUnderstandingSnapshotStale(input: {
  binding?: ChangeUnderstandingSnapshot["binding"];
  currentScopeHash: string;
  currentCandidateHash: string;
  currentRevision?: string;
}): boolean {
  if (input.binding === undefined) return false;
  return isCommitDraftEvidenceStale({
    bindingScopeHash: input.binding.scopeHash,
    currentScopeHash: input.currentScopeHash,
    bindingCandidateHash: input.binding.candidateHash,
    currentCandidateHash: input.currentCandidateHash,
    bindingRevision: input.binding.revision,
    currentRevision: input.currentRevision,
  });
}

/**
 * v0.0.12 批次 A：变更解读会话状态（纯数据；Host 持有一份，跨任务拒绝
 * 由 Host 校验 pendingReceipt.task 执行）。用户确认仅会话内。
 */
export interface UnderstandingSessionState {
  pendingReceipt?: {
    token: string;
    /** 显式绑定任务 understand-changes；跨任务一律拒绝。 */
    task: AnalysisTask;
    receipt: AnalysisReceipt;
    coverage: DiffCoverageSummary;
    files: CommitDiffFileCoverageView[];
    fragments: CommitDiffFragment[];
    revision?: string;
    scopeHash: string;
    candidateHash: string;
    excludedCount: number;
    historyIncluded: boolean;
    historyCount?: number;
    retryNote?: string;
  };
  /** 会话内用户确认（切换项目/会话替换即失效；变化标待复核）。 */
  userConfirmations: UserConfirmedFact[];
  /** 最近一次分析绑定（stale 判断用）。 */
  binding?: ChangeUnderstandingSnapshot["binding"];
  /** 最近一次采集的逐文件覆盖率（重试失败项用）。 */
  lastCoverageFiles?: CommitDiffFileCoverageView[];
  /** 最近一次本地结果（离线/降级展示）。 */
  localParts?: UnderstandingResultParts;
  /** 最近一次模型结果（ready/partial 展示）。 */
  modelParts?: UnderstandingResultParts;
  analysis?: {
    state: "ready" | "partial" | "failed";
    source: UnderstandingSource;
    warnings: string[];
    generatedAt: string;
  };
  /** 一次性反馈。 */
  feedback?: { tone: "success" | "warning" | "error"; message: string };
}

/** 由已确认事实生成“准备提交”草稿建议（批次 A 只读展示）。 */
export function buildDraftProposalFromConfirmations(
  confirmations: UserConfirmedFact[],
  scopeText: string,
): { message: string; confirmedFacts: string[] } | undefined {
  const reviewed = confirmations.filter((fact) => !fact.needsReview);
  if (reviewed.length === 0) return undefined;
  const confirmedFacts = reviewed.map((fact) => fact.statement);
  return {
    message: [
      "变更：整理当前 SVN 提交范围",
      "",
      `范围：${scopeText}`,
      "",
      ...confirmedFacts.map((statement) => `- ${statement}`),
    ].join("\n"),
    confirmedFacts,
  };
}
