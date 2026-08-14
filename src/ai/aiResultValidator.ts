import * as path from "node:path";
import { CommitSelectionExplanation } from "../commit/commitSelectionRules";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { AiFileDecision, AiSelectionResult } from "./aiProvider";

const AI_SELECTION_CATEGORIES = [
  "recommended",
  "excluded",
  "needsReview",
  "blocked",
] as const;

/**
 * AI 提交选择结果结构无效时抛出的结构化错误（V003-CR-04）。
 * 携带全部校验问题，Controller 捕获后进入 local-rule-fallback 降级：
 * 保留当前选择与预览，并在界面如实展示失败原因。
 */
export class AiSelectionResultStructureError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`AI 提交选择结果结构无效：${issues.join("；")}`);
    this.name = "AiSelectionResultStructureError";
    this.issues = issues;
  }
}

/**
 * 规范化 AI 提交选择结果。规范化之前先严格校验结构（V003-CR-04）：
 * 四个分类字段必须存在且为数组；每条目必须有非空 path 与可处理的
 * reason（字符串）；同一路径不得跨分类重复出现。任一条件不满足即抛出
 * AiSelectionResultStructureError——不得把缺失或类型错误的字段静默
 * 规范化为空数组，空结果会被误当成模型分析成功并清空用户当前选择。
 */
export function normalizeAiSelectionResult(result: unknown): AiSelectionResult {
  assertAiSelectionStructure(result);
  return {
    recommended: normalizeDecisionList(result.recommended),
    excluded: normalizeDecisionList(result.excluded),
    needsReview: normalizeDecisionList(result.needsReview),
    blocked: normalizeDecisionList(result.blocked),
  };
}

function assertAiSelectionStructure(
  result: unknown,
): asserts result is Partial<AiSelectionResult> {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new AiSelectionResultStructureError([
      "响应必须是包含 recommended、excluded、needsReview、blocked 的 JSON 对象。",
    ]);
  }
  const record = result as Record<string, unknown>;
  const issues: string[] = [];
  for (const category of AI_SELECTION_CATEGORIES) {
    if (!Array.isArray(record[category])) {
      issues.push(`分类字段 ${category} 缺失或不是数组。`);
    }
  }
  if (issues.length > 0) {
    throw new AiSelectionResultStructureError(issues);
  }
  const seen = new Map<string, string>();
  for (const category of AI_SELECTION_CATEGORIES) {
    const items = record[category] as unknown[];
    items.forEach((item, index) => {
      const where = `${category}[${index}]`;
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        issues.push(`${where} 不是包含 path 与 reason 的对象。`);
        return;
      }
      const raw = item as Record<string, unknown>;
      if (typeof raw.path !== "string" || raw.path.trim().length === 0) {
        issues.push(`${where} 缺少有效的 path。`);
      } else {
        const trimmedPath = raw.path.trim();
        const existing = seen.get(normalizePathKey(trimmedPath));
        if (existing !== undefined && existing !== category) {
          issues.push(
            `路径 ${trimmedPath} 同时出现在 ${existing} 与 ${category}，同一路径不得跨分类重复。`,
          );
        } else {
          seen.set(normalizePathKey(trimmedPath), category);
        }
      }
      if (typeof raw.reason !== "string") {
        issues.push(`${where} 缺少可处理的 reason（应为字符串）。`);
      }
    });
  }
  if (issues.length > 0) {
    throw new AiSelectionResultStructureError(issues);
  }
}

export function validateAiSelectionResult(
  scope: OperationScope,
  result: AiSelectionResult,
  allowedPaths?: string[],
): AiSelectionResult {
  const allowed = allowedPaths
    ? new Set(allowedPaths.map((filePath) => normalizePathKey(filePath)))
    : undefined;
  return {
    recommended: validateDecisionList(scope, result.recommended, allowed),
    excluded: validateDecisionList(scope, result.excluded, allowed),
    needsReview: validateDecisionList(scope, result.needsReview, allowed),
    blocked: validateDecisionList(scope, result.blocked, allowed),
  };
}

export interface AiSelectionLocalBoundaryCandidate {
  absolutePath: string;
  relativePath: string;
  evaluation: CommitSelectionExplanation;
}

export interface AiSelectionLocalBoundaryResult {
  result: AiSelectionResult;
  /** AI 越过本地边界的条目说明（已丢弃），计入警告展示给用户。 */
  violations: string[];
}

/**
 * AI 本地边界（规划 5.2、5.5）：AI 只能在 recommended 与 needsReview 之间调整。
 * AI 不得把本地阻止项（conflicted/obstructed/incomplete）、强制排除项
 * （ignored/external）或用户明确配置的排除项改为推荐；范围外、虚构路径已由
 * validateAiSelectionResult 拒绝。违规条目从 recommended 丢弃并计入警告。
 * 本函数必须在 validateAiSelectionResult 之后调用（路径已归一为绝对路径）。
 */
export function enforceAiSelectionLocalBoundary(
  candidates: AiSelectionLocalBoundaryCandidate[],
  result: AiSelectionResult,
): AiSelectionLocalBoundaryResult {
  const byPath = new Map(
    candidates.map(
      (candidate) =>
        [normalizePathKey(candidate.absolutePath), candidate] as const,
    ),
  );
  const violations: string[] = [];
  const recommended = result.recommended.filter((item) => {
    const candidate = byPath.get(normalizePathKey(item.path));
    if (!candidate) {
      // 不在当前候选集合的条目由范围/候选校验负责，这里保持原样。
      return true;
    }
    const evaluation = candidate.evaluation;
    if (
      evaluation.decision === "recommended" ||
      evaluation.decision === "needsReview"
    ) {
      return true;
    }
    violations.push(
      describeBoundaryViolation(candidate.relativePath, evaluation),
    );
    return false;
  });
  return { result: { ...result, recommended }, violations };
}

function describeBoundaryViolation(
  relativePath: string,
  evaluation: CommitSelectionExplanation,
): string {
  if (evaluation.reasonKey === "safetyBlocked") {
    return `AI 建议把 ${relativePath} 改为推荐，但该文件是本地阻止项（冲突或异常状态），已忽略该建议。`;
  }
  if (evaluation.reasonKey === "safetyExternal") {
    return `AI 建议把 ${relativePath} 改为推荐，但 external 不属于当前仓库，已忽略该建议。`;
  }
  if (evaluation.reasonKey === "safetyIgnored") {
    return `AI 建议把 ${relativePath} 改为推荐，但 ignored 文件不能通过建议选择隐式加入 SVN，已忽略该建议。`;
  }
  if (
    evaluation.reasonKey === "pathRule" &&
    evaluation.ruleSource &&
    evaluation.ruleSource !== "builtin"
  ) {
    return `AI 建议把 ${relativePath} 改为推荐，但该文件命中用户配置的排除规则 ${evaluation.matchedRuleId ?? ""}，已忽略该建议。`;
  }
  if (evaluation.reasonKey === "pathRule") {
    return `AI 建议把 ${relativePath} 改为推荐，但该文件命中内置排除规则，已忽略该建议。`;
  }
  return `AI 建议把 ${relativePath} 改为推荐，但本地状态策略已将其排除，已忽略该建议。`;
}

function validateDecisionList(
  scope: OperationScope,
  items: AiFileDecision[],
  allowed: Set<string> | undefined,
): AiFileDecision[] {
  return items
    .map((item) => ({
      path: toAbsoluteDecisionPath(scope, item.path),
      reason: item.reason,
    }))
    .filter((item) => isPathInScope(scope, item.path))
    .filter((item) => !allowed || allowed.has(normalizePathKey(item.path)));
}

function normalizeDecisionList(value: unknown): AiFileDecision[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const raw = item as Partial<AiFileDecision>;
      return {
        path: typeof raw.path === "string" ? raw.path.trim() : "",
        reason: typeof raw.reason === "string" ? raw.reason.trim() : "",
      };
    })
    .filter((item) => item.path.length > 0)
    .map((item) => ({
      path: item.path,
      reason: item.reason || "AI 未提供原因",
    }));
}

function toAbsoluteDecisionPath(
  scope: OperationScope,
  filePath: string,
): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(scope.repositoryRoot, filePath);
}
