import * as path from 'node:path';
import { OperationScope } from '../scope/operationScope';
import { isPathInScope } from '../scope/pathBoundaryGuard';
import { AiFileDecision, AiSelectionResult } from './aiProvider';

export function normalizeAiSelectionResult(result: Partial<AiSelectionResult>): AiSelectionResult {
  return {
    recommended: normalizeDecisionList(result.recommended),
    excluded: normalizeDecisionList(result.excluded),
    needsReview: normalizeDecisionList(result.needsReview),
    blocked: normalizeDecisionList(result.blocked)
  };
}

export function validateAiSelectionResult(
  scope: OperationScope,
  result: AiSelectionResult,
  allowedPaths?: string[]
): AiSelectionResult {
  const allowed = allowedPaths ? new Set(allowedPaths.map(normalizePathKey)) : undefined;
  return {
    recommended: validateDecisionList(scope, result.recommended, allowed),
    excluded: validateDecisionList(scope, result.excluded, allowed),
    needsReview: validateDecisionList(scope, result.needsReview, allowed),
    blocked: validateDecisionList(scope, result.blocked, allowed)
  };
}

function validateDecisionList(
  scope: OperationScope,
  items: AiFileDecision[],
  allowed: Set<string> | undefined
): AiFileDecision[] {
  return items
    .map((item) => ({
      path: toAbsoluteDecisionPath(scope, item.path),
      reason: item.reason
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
        path: typeof raw.path === 'string' ? raw.path.trim() : '',
        reason: typeof raw.reason === 'string' ? raw.reason.trim() : ''
      };
    })
    .filter((item) => item.path.length > 0)
    .map((item) => ({
      path: item.path,
      reason: item.reason || 'AI 未提供原因'
    }));
}

function toAbsoluteDecisionPath(scope: OperationScope, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(scope.repositoryRoot, filePath);
}

function normalizePathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}
