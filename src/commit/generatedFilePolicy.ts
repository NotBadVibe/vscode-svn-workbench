import * as path from "node:path";
import { getBuiltinCommitSelectionEvaluator } from "./commitSelectionRuleEvaluator";

export type GeneratedFileDecision = "exclude" | "review" | "include";

/**
 * v0.0.2 兼容包装：导出签名保持不变，内部改为经由内置默认路径规则评估
 * （见 commitSelectionRules.ts 中从本文件硬编码迁移的内置规则）。
 * 决策语义与 v0.0.2 一致：命中 excluded 规则 → "exclude"，命中 needsReview
 * 规则 → "review"，未命中 → "include"。
 */
export function classifyGeneratedFile(
  relativePath: string,
): GeneratedFileDecision {
  const normalized = relativePath.split(path.sep).join("/");
  const matched = getBuiltinCommitSelectionEvaluator().matchPath(normalized);
  if (matched?.decision === "excluded") {
    return "exclude";
  }
  if (matched?.decision === "needsReview") {
    return "review";
  }
  return "include";
}
