/**
 * 提交选择规则领域模型（v0.0.3 阶段 1）。
 *
 * 本模块只包含纯数据与纯函数：决策类型、状态策略、路径规则、内置默认值、
 * 配置解析与校验。不依赖 VS Code API、不做 I/O，可随设置快照下发到 Webview。
 * 合并语义见 commitSelectionRuleResolver.ts，评估见 commitSelectionRuleEvaluator.ts，
 * 规划依据见 docs/releases/v0.0.3/README.md 第 4–6 节。
 */

import picomatch from "picomatch";

export const COMMIT_SELECTION_CONFIG_VERSION = 1;
export const MAX_COMMIT_SELECTION_PATH_RULES = 200;
export const MAX_COMMIT_SELECTION_PATTERN_LENGTH = 200;

/** 最终决策。blocked 只由不可覆盖的安全规则产出，不作为可写配置值。 */
export type CommitSelectionDecision =
  "recommended" | "needsReview" | "excluded" | "blocked";

/** 允许写入配置的决策值。 */
export type ConfigurableCommitSelectionDecision = Exclude<
  CommitSelectionDecision,
  "blocked"
>;

/** 允许配置默认策略的状态键；propertyModified 表示 status=normal 且 propStatus=modified。 */
export type CommitSelectionStatusKey =
  | "modified"
  | "added"
  | "deleted"
  | "replaced"
  | "propertyModified"
  | "missing"
  | "unversioned"
  | "unknown"
  | "normal";

export type CommitSelectionStatusPolicies = Record<
  CommitSelectionStatusKey,
  ConfigurableCommitSelectionDecision
>;

/** 规则来源；安全规则不可覆盖，不列入配置来源。 */
export type CommitSelectionRuleSource =
  "builtin" | "user" | "workspace" | "repository";

/** 用户可编辑的路径规则字段。caseSensitive 缺省为 true。 */
export interface CommitSelectionPathRule {
  id: string;
  enabled: boolean;
  pattern: string;
  decision: ConfigurableCommitSelectionDecision;
  reason: string;
  caseSensitive?: boolean;
}

/** 合并后的有效路径规则，附带来源与规范化 pattern。 */
export interface ResolvedCommitSelectionPathRule extends CommitSelectionPathRule {
  source: CommitSelectionRuleSource;
  normalizedPattern: string;
}

/** 单层原始配置解析后的类型化结果（commitSelection 键的内容）。 */
export interface CommitSelectionLayerConfig {
  version?: number;
  statusRules?: Partial<
    Record<CommitSelectionStatusKey, ConfigurableCommitSelectionDecision>
  >;
  pathRules?: CommitSelectionPathRule[];
}

export interface CommitSelectionLayerValidation {
  /** 校验通过时存在；存在错误时整层无效。 */
  config?: CommitSelectionLayerConfig;
  errors: string[];
  warnings: string[];
}

/** 决策解释模型的原因 key，是预览表、提交页原因与 AI“本地规则结论”的统一类型。 */
export type CommitSelectionReasonKey =
  | "safetyBlocked"
  | "safetyExternal"
  | "safetyIgnored"
  | "pathRule"
  | "statusPolicy";

export interface CommitSelectionExplanation {
  decision: CommitSelectionDecision;
  reasonKey: CommitSelectionReasonKey;
  /** reasonKey === "statusPolicy" 时命中的状态策略键。 */
  statusPolicyKey?: CommitSelectionStatusKey;
  /** reasonKey === "pathRule" 时命中的规则 ID 与来源。 */
  matchedRuleId?: string;
  ruleSource?: CommitSelectionRuleSource;
  /** 是否属于不可覆盖的安全结果。 */
  safetyLocked: boolean;
}

export const configurableCommitSelectionStatusKeys: readonly CommitSelectionStatusKey[] =
  [
    "modified",
    "added",
    "deleted",
    "replaced",
    "propertyModified",
    "missing",
    "unversioned",
    "unknown",
    "normal",
  ];

/** 始终阻止提交的安全状态，不可配置。 */
export const blockedCommitSelectionStatuses = [
  "conflicted",
  "obstructed",
  "incomplete",
] as const;

/** 始终强制排除的安全状态，不可配置。 */
export const forcedExcludedCommitSelectionStatuses = [
  "external",
  "ignored",
] as const;

/** 内置默认状态策略（规划 4.1 表）。 */
export const defaultCommitSelectionStatusRules: CommitSelectionStatusPolicies =
  {
    modified: "recommended",
    added: "recommended",
    deleted: "recommended",
    replaced: "recommended",
    propertyModified: "recommended",
    missing: "needsReview",
    unversioned: "needsReview",
    unknown: "needsReview",
    normal: "excluded",
  };

/**
 * 内置默认路径规则，从 generatedFilePolicy.ts 的 v0.0.2 硬编码迁移而来。
 *
 * 顺序即优先级（第一条命中生效），与旧实现的检查顺序一致：
 * 生成物目录段（大小写敏感）→ 根锚定 bin/Debug、bin/Release（大小写不敏感）
 * → 根锚定 bin/ 其余内容（review）→ 扩展名（大小写不敏感）。
 *
 * 目录规则同时覆盖目录项本身与其内容：picomatch 中 `**\/dist/**` 可匹配
 * "dist"、"a/dist"、"dist/x"、"a/dist/x"；`bin/*{,/**}` 匹配 bin 的直接与
 * 间接子项但不匹配 "bin" 本身（与旧实现 segments.length >= 2 的前置条件一致）。
 * 扩展名规则使用 `?*` 而非 `*`，保证恰名为 ".log"/".tmp"/".pyc" 的文件与
 * 旧实现 path.extname 行为一致（不命中）。
 */
export const builtinCommitSelectionPathRules: CommitSelectionPathRule[] = [
  {
    id: "generated-node-modules",
    enabled: true,
    pattern: "**/node_modules/**",
    decision: "excluded",
    reason: "第三方依赖目录",
  },
  {
    id: "generated-dist",
    enabled: true,
    pattern: "**/dist/**",
    decision: "excluded",
    reason: "构建输出目录",
  },
  {
    id: "generated-build",
    enabled: true,
    pattern: "**/build/**",
    decision: "excluded",
    reason: "构建输出目录",
  },
  {
    id: "generated-target",
    enabled: true,
    pattern: "**/target/**",
    decision: "excluded",
    reason: "构建输出目录",
  },
  {
    id: "generated-next",
    enabled: true,
    pattern: "**/.next/**",
    decision: "excluded",
    reason: "Next.js 构建输出目录",
  },
  {
    id: "generated-nuxt",
    enabled: true,
    pattern: "**/.nuxt/**",
    decision: "excluded",
    reason: "Nuxt 构建输出目录",
  },
  {
    id: "generated-pycache",
    enabled: true,
    pattern: "**/__pycache__/**",
    decision: "excluded",
    reason: "Python 字节码缓存目录",
  },
  {
    id: "generated-obj",
    enabled: true,
    pattern: "**/obj/**",
    decision: "excluded",
    reason: ".NET 中间构建目录",
  },
  {
    id: "bin-debug",
    enabled: true,
    pattern: "bin/Debug/**",
    decision: "excluded",
    reason: ".NET Debug 构建输出目录",
    caseSensitive: false,
  },
  {
    id: "bin-release",
    enabled: true,
    pattern: "bin/Release/**",
    decision: "excluded",
    reason: ".NET Release 构建输出目录",
    caseSensitive: false,
  },
  {
    id: "bin-review",
    enabled: true,
    pattern: "bin/*{,/**}",
    decision: "needsReview",
    reason: "bin 目录下的脚本或产物，需要人工确认",
    caseSensitive: false,
  },
  {
    id: "ext-log",
    enabled: true,
    pattern: "**/?*.log",
    decision: "excluded",
    reason: "日志文件",
    caseSensitive: false,
  },
  {
    id: "ext-tmp",
    enabled: true,
    pattern: "**/?*.tmp",
    decision: "excluded",
    reason: "临时文件",
    caseSensitive: false,
  },
  {
    id: "ext-pyc",
    enabled: true,
    pattern: "**/?*.pyc",
    decision: "excluded",
    reason: "Python 字节码文件",
    caseSensitive: false,
  },
];

const PATH_RULE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/;

export function isConfigurableCommitSelectionDecision(
  value: unknown,
): value is ConfigurableCommitSelectionDecision {
  return (
    value === "recommended" || value === "needsReview" || value === "excluded"
  );
}

export function isCommitSelectionStatusKey(
  value: unknown,
): value is CommitSelectionStatusKey {
  return (
    typeof value === "string" &&
    (configurableCommitSelectionStatusKeys as readonly string[]).includes(value)
  );
}

export function isValidCommitSelectionPathRuleId(id: string): boolean {
  return PATH_RULE_ID_PATTERN.test(id);
}

/**
 * 规范化 glob pattern：去首尾空白、去掉开头的 "./"、折叠重复的 "/"。
 * 不做其他改写，保持用户表达式语义。
 */
export function normalizeCommitSelectionPattern(pattern: string): string {
  let normalized = pattern.trim().replace(/\/{2,}/g, "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return normalized;
}

/**
 * 校验 glob pattern 是否符合固定方言：相对仓库根、统一 "/" 分隔、支持 "**"。
 * 返回错误文案；合法时返回 undefined。
 */
export function validateCommitSelectionPattern(
  pattern: unknown,
): string | undefined {
  if (typeof pattern !== "string" || !pattern.trim()) {
    return "pattern 必须是非空字符串。";
  }
  if (pattern.length > MAX_COMMIT_SELECTION_PATTERN_LENGTH) {
    return `pattern 长度超过 ${MAX_COMMIT_SELECTION_PATTERN_LENGTH} 字符上限。`;
  }
  if (pattern.includes("\\")) {
    return 'pattern 必须使用 "/" 作为路径分隔符，不允许 "\\"。';
  }
  if (pattern.startsWith("/")) {
    return 'pattern 必须相对仓库根，不允许以 "/" 开头。';
  }
  if (WINDOWS_DRIVE_PATTERN.test(pattern)) {
    return "pattern 必须相对仓库根，不允许盘符绝对路径。";
  }
  try {
    // strictBrackets 让不平衡的 []、{}、() 编译期抛错，而不是被静默当作字面量。
    picomatch(pattern, { strictBrackets: true });
  } catch (error) {
    return `pattern 不是合法的 glob 表达式：${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 从 `.svn-workbench.json` 的 raw 对象中提取 commitSelection 层原始配置。
 * 未知字段原样保留在 raw 中（由统一读写层负责写回合并不丢失），这里只读。
 */
export function extractCommitSelectionLayerConfig(raw: unknown): {
  layer?: unknown;
  warnings: string[];
} {
  if (!isRecord(raw)) {
    return { warnings: [] };
  }
  const value = raw.commitSelection;
  if (value === undefined) {
    return { warnings: [] };
  }
  if (!isRecord(value)) {
    return { warnings: ["commitSelection 必须是 JSON 对象，已忽略该层配置。"] };
  }
  return { layer: value, warnings: [] };
}

/**
 * 把单层原始配置（用户/工作区/仓库任一层）解析并校验为类型化配置。
 * 出现任何错误时整层无效（config 为 undefined），由 resolver 回退到更低优先级层。
 */
export function validateCommitSelectionLayerConfig(
  raw: unknown,
  layerLabel: string,
): CommitSelectionLayerValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return {
      errors: [`${layerLabel} commitSelection 必须是 JSON 对象。`],
      warnings,
    };
  }

  const config: CommitSelectionLayerConfig = {};

  if (raw.version !== undefined) {
    if (raw.version === COMMIT_SELECTION_CONFIG_VERSION) {
      config.version = COMMIT_SELECTION_CONFIG_VERSION;
    } else {
      errors.push(
        `${layerLabel} commitSelection.version 仅支持 ${COMMIT_SELECTION_CONFIG_VERSION}，实际为 ${JSON.stringify(raw.version)}。`,
      );
    }
  }

  if (raw.statusRules !== undefined) {
    if (!isRecord(raw.statusRules)) {
      errors.push(
        `${layerLabel} commitSelection.statusRules 必须是 JSON 对象。`,
      );
    } else {
      const statusRules: CommitSelectionLayerConfig["statusRules"] = {};
      for (const [key, value] of Object.entries(raw.statusRules)) {
        if (!isCommitSelectionStatusKey(key)) {
          if (
            (blockedCommitSelectionStatuses as readonly string[]).includes(
              key,
            ) ||
            (
              forcedExcludedCommitSelectionStatuses as readonly string[]
            ).includes(key)
          ) {
            warnings.push(
              `${layerLabel} commitSelection.statusRules.${key} 属于不可覆盖的安全状态，配置不生效。`,
            );
          } else {
            warnings.push(
              `${layerLabel} commitSelection.statusRules 包含未识别的状态键 "${key}"，已忽略。`,
            );
          }
          continue;
        }
        if (value === "blocked") {
          errors.push(
            `${layerLabel} commitSelection.statusRules.${key} 不允许配置为 blocked。`,
          );
          continue;
        }
        if (!isConfigurableCommitSelectionDecision(value)) {
          errors.push(
            `${layerLabel} commitSelection.statusRules.${key} 的决策值无效：${JSON.stringify(value)}。`,
          );
          continue;
        }
        statusRules[key] = value;
      }
      config.statusRules = statusRules;
    }
  }

  if (raw.pathRules !== undefined) {
    if (!Array.isArray(raw.pathRules)) {
      errors.push(`${layerLabel} commitSelection.pathRules 必须是数组。`);
    } else if (raw.pathRules.length > MAX_COMMIT_SELECTION_PATH_RULES) {
      errors.push(
        `${layerLabel} commitSelection.pathRules 数量超过 ${MAX_COMMIT_SELECTION_PATH_RULES} 条上限。`,
      );
    } else {
      const pathRules: CommitSelectionPathRule[] = [];
      const seenIds = new Set<string>();
      raw.pathRules.forEach((item, index) => {
        const label = `${layerLabel} commitSelection.pathRules[${index}]`;
        if (!isRecord(item)) {
          errors.push(`${label} 必须是 JSON 对象。`);
          return;
        }
        const id = typeof item.id === "string" ? item.id : "";
        if (!isValidCommitSelectionPathRuleId(id)) {
          errors.push(
            `${label} 的规则 ID 无效：${JSON.stringify(item.id)}（需匹配 ${PATH_RULE_ID_PATTERN.source}）。`,
          );
          return;
        }
        if (seenIds.has(id)) {
          errors.push(`${label} 的规则 ID "${id}" 在本层重复。`);
          return;
        }
        seenIds.add(id);

        const patternError = validateCommitSelectionPattern(item.pattern);
        if (patternError) {
          errors.push(`${label} ${patternError}`);
          return;
        }
        const decision = item.decision;
        if (decision === "blocked") {
          errors.push(`${label} 不允许配置为 blocked。`);
          return;
        }
        if (!isConfigurableCommitSelectionDecision(decision)) {
          errors.push(`${label} 的决策值无效：${JSON.stringify(decision)}。`);
          return;
        }
        if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
          errors.push(`${label} 的 enabled 必须是布尔值。`);
          return;
        }
        if (
          item.caseSensitive !== undefined &&
          typeof item.caseSensitive !== "boolean"
        ) {
          errors.push(`${label} 的 caseSensitive 必须是布尔值。`);
          return;
        }
        if (item.reason !== undefined && typeof item.reason !== "string") {
          errors.push(`${label} 的 reason 必须是字符串。`);
          return;
        }
        pathRules.push({
          id,
          enabled: item.enabled ?? true,
          pattern: item.pattern as string,
          decision,
          reason: typeof item.reason === "string" ? item.reason : "",
          ...(item.caseSensitive !== undefined
            ? { caseSensitive: item.caseSensitive }
            : {}),
        });
      });
      config.pathRules = pathRules;
    }
  }

  if (errors.length > 0) {
    return { errors, warnings };
  }
  return { config, errors, warnings };
}

/**
 * 遮蔽检测：被前面更宽规则永久遮蔽的规则产生警告（不阻止保存）。
 * 只检测两种明确关系：规范化 pattern 完全重复、以及明显的目录前缀包含
 * （前面的 `a/b/**` 覆盖后面的 `a/b/...`）。大小写敏感性不同视为不包含，
 * 避免误报。启发式保守实现，宁缺毋滥。
 */
export function detectShadowedCommitSelectionPathRules(
  rules: ResolvedCommitSelectionPathRule[],
): string[] {
  const warnings: string[] = [];
  const enabled = rules.filter((rule) => rule.enabled);
  for (let later = 1; later < enabled.length; later += 1) {
    for (let earlier = 0; earlier < later; earlier += 1) {
      if (shadowsRule(enabled[earlier], enabled[later])) {
        warnings.push(
          `规则 "${enabled[later].id}" 被前面的规则 "${enabled[earlier].id}" 遮蔽，永远不会命中。`,
        );
        break;
      }
    }
  }
  return warnings;
}

function shadowsRule(
  earlier: ResolvedCommitSelectionPathRule,
  later: ResolvedCommitSelectionPathRule,
): boolean {
  // 前面规则大小写敏感而后面不敏感时，后面规则覆盖更多路径，不算被遮蔽。
  const earlierSensitive = earlier.caseSensitive !== false;
  const laterSensitive = later.caseSensitive !== false;
  if (earlierSensitive && !laterSensitive) {
    return false;
  }

  const earlierPattern = earlier.normalizedPattern;
  const laterPattern = later.normalizedPattern;
  if (earlierPattern === laterPattern && earlierSensitive === laterSensitive) {
    return true;
  }

  if (!earlierPattern.endsWith("/**")) {
    return false;
  }
  const prefix = earlierPattern.slice(0, -"/**".length);
  // 段内带单 "*" 的前缀不做包含推断（如 foo*/**），保持启发式保守。
  const hasSegmentWildcard = prefix
    .split("/")
    .some((segment) => segment.includes("*") && segment !== "**");
  if (!prefix || hasSegmentWildcard) {
    return false;
  }
  return laterPattern === prefix || laterPattern.startsWith(`${prefix}/`);
}
