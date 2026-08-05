/**
 * 提交选择规则评估器（v0.0.3 阶段 1）。
 *
 * 输入候选（相对路径 + (status, propStatus) 二元组）与有效规则，输出最终决策
 * 与结构化解释模型。解释模型是设置预览表、提交页决策原因和 AI 请求“本地规则
 * 结论”的统一类型（规划 5.4）。纯函数、无 I/O、不依赖 VS Code，可在 Webview 端执行。
 *
 * 评估顺序（规划 5.1）：
 *   不可覆盖的安全规则（status 或 propStatus 命中 conflicted/obstructed/incomplete
 *   → blocked；status 为 external/ignored → 强制排除）→ 合并后路径规则
 *   （第一条命中）→ 状态默认策略。
 *
 * 仅属性变化（status=normal 且 propStatus=modified）走 propertyModified 策略，
 * 默认 recommended —— 这是对 v0.0.2 把其当作普通 normal 排除的有意行为修正。
 */

import picomatch from "picomatch";
import { SvnStatus } from "../svn/svnTypes";
import {
  CommitSelectionDecision,
  CommitSelectionExplanation,
  CommitSelectionStatusKey,
  CommitSelectionStatusPolicies,
  ResolvedCommitSelectionPathRule,
  blockedCommitSelectionStatuses,
  builtinCommitSelectionPathRules,
  defaultCommitSelectionStatusRules,
  isCommitSelectionStatusKey,
  normalizeCommitSelectionPattern,
} from "./commitSelectionRules";

export interface CommitSelectionCandidateInput {
  relativePath: string;
  status: SvnStatus;
  propStatus?: SvnStatus;
}

export interface EffectiveCommitSelectionRules {
  statusRules: CommitSelectionStatusPolicies;
  pathRules: ResolvedCommitSelectionPathRule[];
}

interface CompiledPathRule {
  rule: ResolvedCommitSelectionPathRule;
  isMatch: (path: string) => boolean;
}

export interface CommitSelectionEvaluator {
  rules: EffectiveCommitSelectionRules;
  evaluate(input: CommitSelectionCandidateInput): CommitSelectionExplanation;
  /** 只执行路径规则匹配，返回第一条命中的规则；用于 generatedFilePolicy 兼容包装。 */
  matchPath(relativePath: string): ResolvedCommitSelectionPathRule | undefined;
}

const blockedStatuses: readonly string[] = blockedCommitSelectionStatuses;

export function createCommitSelectionEvaluator(
  rules: EffectiveCommitSelectionRules,
): CommitSelectionEvaluator {
  const compiled: CompiledPathRule[] = rules.pathRules.map((rule) => ({
    rule,
    isMatch: picomatch(rule.normalizedPattern, {
      dot: true,
      nocase: rule.caseSensitive === false,
    }),
  }));

  const matchPath = (
    relativePath: string,
  ): ResolvedCommitSelectionPathRule | undefined => {
    const normalized = normalizeCandidatePath(relativePath);
    for (const { rule, isMatch } of compiled) {
      if (rule.enabled && isMatch(normalized)) {
        return rule;
      }
    }
    return undefined;
  };

  const evaluate = (
    input: CommitSelectionCandidateInput,
  ): CommitSelectionExplanation => {
    // 安全检查同时覆盖 status 与 propStatus（规划 5.2、V003-CR-01）：
    // 仅属性冲突（如 status=normal/modified 且 propStatus=conflicted）同样是
    // 不可覆盖的阻止项，先于任何路径规则与可配置状态策略。
    if (
      blockedStatuses.includes(input.status) ||
      (input.propStatus !== undefined &&
        blockedStatuses.includes(input.propStatus))
    ) {
      return {
        decision: "blocked",
        reasonKey: "safetyBlocked",
        safetyLocked: true,
      };
    }

    if (input.status === "external") {
      return {
        decision: "excluded",
        reasonKey: "safetyExternal",
        safetyLocked: true,
      };
    }
    if (input.status === "ignored") {
      return {
        decision: "excluded",
        reasonKey: "safetyIgnored",
        safetyLocked: true,
      };
    }

    const matchedRule = matchPath(input.relativePath);
    if (matchedRule) {
      return {
        decision: matchedRule.decision,
        reasonKey: "pathRule",
        matchedRuleId: matchedRule.id,
        ruleSource: matchedRule.source,
        safetyLocked: false,
      };
    }

    const statusPolicyKey = deriveCommitSelectionStatusKey(
      input.status,
      input.propStatus,
    );
    return {
      decision: rules.statusRules[statusPolicyKey],
      reasonKey: "statusPolicy",
      statusPolicyKey,
      safetyLocked: false,
    };
  };

  return { rules, evaluate, matchPath };
}

export function evaluateCommitSelection(
  input: CommitSelectionCandidateInput,
  rules: EffectiveCommitSelectionRules,
): CommitSelectionExplanation {
  return createCommitSelectionEvaluator(rules).evaluate(input);
}

/**
 * 派生状态策略键：仅属性变化（status=normal 且 propStatus=modified）独立为
 * propertyModified；其余 propStatus 值不改变状态判断（与 v0.0.2 一致）。
 * 调用前需先经过安全规则，因此这里的状态一定是可配置状态键之一。
 */
export function deriveCommitSelectionStatusKey(
  status: SvnStatus,
  propStatus?: SvnStatus,
): CommitSelectionStatusKey {
  if (status === "normal" && propStatus === "modified") {
    return "propertyModified";
  }
  if (isCommitSelectionStatusKey(status)) {
    return status;
  }
  // 理论不可达（安全状态已在前面返回），兜底按 unknown 策略处理。
  return "unknown";
}

/**
 * 规范化候选相对路径：统一 "/" 分隔、去掉开头的 "./"、折叠重复 "/"、
 * 去掉结尾 "/"。glob 方言固定为相对仓库根、"/" 分隔。不 trim 空白，
 * 保留文件名中合法的首尾空格。
 */
export function normalizeCandidatePath(relativePath: string): string {
  let normalized = relativePath.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/** 内置默认规则（无配置时的有效规则），用于兼容基线与默认评估。 */
export function getBuiltinCommitSelectionRules(): EffectiveCommitSelectionRules {
  return {
    statusRules: { ...defaultCommitSelectionStatusRules },
    pathRules: builtinCommitSelectionPathRules.map((rule) => ({
      ...rule,
      source: "builtin" as const,
      normalizedPattern: normalizeCommitSelectionPattern(rule.pattern),
    })),
  };
}

let builtinEvaluator: CommitSelectionEvaluator | undefined;

/** 内置默认评估器（进程级惰性单例；规则不可变，可安全复用）。 */
export function getBuiltinCommitSelectionEvaluator(): CommitSelectionEvaluator {
  if (!builtinEvaluator) {
    builtinEvaluator = createCommitSelectionEvaluator(
      getBuiltinCommitSelectionRules(),
    );
  }
  return builtinEvaluator;
}

/** 决策到提交候选选择状态的映射（保持 v0.0.2 的 CommitCandidate.selection 词汇）。 */
export function toCommitCandidateSelectionValue(
  decision: CommitSelectionDecision,
): "selected" | "needsReview" | "excluded" | "blocked" {
  return decision === "recommended" ? "selected" : decision;
}
