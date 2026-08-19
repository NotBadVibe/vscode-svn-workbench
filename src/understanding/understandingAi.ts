/**
 * v0.0.12 批次 A：变更解读 AI 请求与严格结构校验（纯逻辑）。
 * 复用 v0.0.11 的受限差异片段与证据引用类型；模型输出只允许结构化纯文本，
 * 路径/命令不作为可执行值处理（由 Webview 白名单渲染）。
 */

import {
  type AnalysisReceipt,
  type ClaimStatus,
  type DiffCoverageSummary,
  type EvidenceReference,
} from "../commit/commitDiffEvidence";
import type {
  UnderstandingResultParts,
  VerificationSuggestion,
} from "./changeUnderstanding";

export interface AiUnderstandingRequest {
  scope: string;
  selectedFileCount: number;
  files: Array<{
    path: string;
    status: string;
    fileType: string;
    templateGroup: string;
    reason: string;
  }>;
  locale: "zh-CN";
  receipt: AnalysisReceipt;
  coverage: DiffCoverageSummary;
  diffs: Array<{
    candidateId: string;
    projectRelativePath: string;
    content: string;
    hunks: Array<{ hunkId: string; header: string }>;
    truncated: boolean;
    binary: boolean;
  }>;
  userConfirmations: string[];
}

export interface AiUnderstandingResult {
  summary: string;
  changes: Array<{
    statement: string;
    status: ClaimStatus;
    confidenceReason?: string;
    evidence?: EvidenceReference[];
    limitations?: string[];
    nextAction?: string;
  }>;
  findings: Array<{
    statement: string;
    category: "local-blocked" | "model" | "evidence-gap" | "business-unknown";
    severity: "critical" | "warning" | "note";
    consequence?: string;
    evidence?: EvidenceReference[];
    limitations?: string[];
    nextAction?: string;
  }>;
  verification: Array<{ title: string; reason: string; command?: string }>;
  warnings: string[];
}

/** 严格规范化：畸形条目丢弃并计入警告；引用有效性由 Host 复验。 */
export function normalizeUnderstandingResult(
  value: Partial<AiUnderstandingResult>,
): AiUnderstandingResult {
  const warnings = Array.isArray(value.warnings)
    ? value.warnings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const summary = typeof value.summary === "string" ? value.summary.trim() : "";
  const changes = normalizeChanges(value.changes, warnings);
  const findings = normalizeFindings(value.findings, warnings);
  const verification = normalizeVerification(value.verification, warnings);
  return {
    summary,
    changes,
    findings,
    verification,
    warnings,
  };
}

function normalizeEvidence(
  value: unknown,
  warnings: string[],
): EvidenceReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    warnings.push("模型返回的证据引用结构无效，已忽略。");
    return [];
  }
  const result: EvidenceReference[] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.candidateId !== "string" ||
      raw.candidateId.trim() === "" ||
      typeof raw.projectRelativePath !== "string" ||
      raw.projectRelativePath.trim() === ""
    ) {
      dropped += 1;
      continue;
    }
    const hunkId =
      typeof raw.hunkId === "string" && raw.hunkId.trim() !== ""
        ? raw.hunkId.trim()
        : undefined;
    result.push({
      candidateId: raw.candidateId.trim(),
      projectRelativePath: raw.projectRelativePath.trim(),
      ...(hunkId ? { hunkId } : {}),
    });
  }
  if (dropped > 0) warnings.push(`${dropped} 条证据引用结构无效，已忽略。`);
  return result;
}

function normalizeChanges(
  value: unknown,
  warnings: string[],
): AiUnderstandingResult["changes"] {
  if (!Array.isArray(value)) return [];
  const result: AiUnderstandingResult["changes"] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.statement !== "string" || raw.statement.trim() === "") {
      dropped += 1;
      continue;
    }
    if (
      raw.status !== "confirmed" &&
      raw.status !== "inferred" &&
      raw.status !== "toConfirm"
    ) {
      dropped += 1;
      continue;
    }
    result.push({
      statement: raw.statement.trim(),
      status: raw.status,
      ...(typeof raw.confidenceReason === "string" &&
      raw.confidenceReason.trim()
        ? { confidenceReason: raw.confidenceReason.trim() }
        : {}),
      evidence: normalizeEvidence(raw.evidence, warnings),
      limitations: normalizeStrings(raw.limitations),
      nextAction:
        typeof raw.nextAction === "string" && raw.nextAction.trim()
          ? raw.nextAction.trim()
          : undefined,
    });
  }
  if (dropped > 0)
    warnings.push(`${dropped} 条“改了什么”声明结构无效，已忽略。`);
  return result;
}

function normalizeFindings(
  value: unknown,
  warnings: string[],
): AiUnderstandingResult["findings"] {
  if (!Array.isArray(value)) return [];
  const result: AiUnderstandingResult["findings"] = [];
  let dropped = 0;
  const categories = new Set([
    "local-blocked",
    "model",
    "evidence-gap",
    "business-unknown",
  ]);
  const severities = new Set(["critical", "warning", "note"]);
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.statement !== "string" || raw.statement.trim() === "") {
      dropped += 1;
      continue;
    }
    if (
      typeof raw.category !== "string" ||
      !categories.has(raw.category) ||
      typeof raw.severity !== "string" ||
      !severities.has(raw.severity)
    ) {
      dropped += 1;
      continue;
    }
    result.push({
      statement: raw.statement.trim(),
      category:
        raw.category as AiUnderstandingResult["findings"][number]["category"],
      severity:
        raw.severity as AiUnderstandingResult["findings"][number]["severity"],
      ...(typeof raw.consequence === "string" && raw.consequence.trim()
        ? { consequence: raw.consequence.trim() }
        : {}),
      evidence: normalizeEvidence(raw.evidence, warnings),
      limitations: normalizeStrings(raw.limitations),
      nextAction:
        typeof raw.nextAction === "string" && raw.nextAction.trim()
          ? raw.nextAction.trim()
          : undefined,
    });
  }
  if (dropped > 0) warnings.push(`${dropped} 条“需要确认”结构无效，已忽略。`);
  return result;
}

function normalizeVerification(
  value: unknown,
  warnings: string[],
): AiUnderstandingResult["verification"] {
  if (!Array.isArray(value)) return [];
  const result: AiUnderstandingResult["verification"] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.title !== "string" ||
      raw.title.trim() === "" ||
      typeof raw.reason !== "string" ||
      raw.reason.trim() === ""
    ) {
      continue;
    }
    result.push({
      title: raw.title.trim(),
      reason: raw.reason.trim(),
      ...(typeof raw.command === "string" && raw.command.trim()
        ? { command: raw.command.trim() }
        : {}),
    });
  }
  if (value.length > result.length) {
    warnings.push(
      `${value.length - result.length} 条验证建议结构无效，已忽略。`,
    );
  }
  return result;
}

function normalizeStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

/** 把（可能是本地回退的）结构化段映射为 AiUnderstandingResult（供 Provider 输出）。 */
export function toAiUnderstandingResult(
  parts: UnderstandingResultParts,
): AiUnderstandingResult {
  return {
    summary: "已生成变更解读（本地回退）。",
    changes: parts.changes.map((change) => ({
      statement: change.statement,
      status: change.status,
      confidenceReason: change.confidenceReason,
      evidence: change.evidence,
      limitations: change.limitations,
      nextAction: change.nextAction,
    })),
    findings: parts.findings.map((finding) => ({
      statement: finding.statement,
      category: finding.category,
      severity: finding.severity,
      consequence: finding.consequence,
      evidence: finding.evidence,
      limitations: finding.limitations,
      nextAction: finding.nextAction,
    })),
    verification: parts.verification.map((item: VerificationSuggestion) => ({
      title: item.title,
      reason: item.reason,
      ...(item.command ? { command: item.command } : {}),
    })),
    warnings: [],
  };
}
