/**
 * 团队提交规范纯规则（V025-R47）。
 *
 * 本模块只包含纯数据与纯函数：配置类型、默认值、配置校验、提交说明校验、
 * 示例骨架与示例即时校验。不依赖 VS Code API、不做 I/O、不发起模型请求，
 * 可被 Host（权威校验）与 Webview Mock（测试替身）共同引用。
 * Webview 生产代码不得直接引用本模块做展示判断——示例结论一律由 Host
 * 经 `settings/preview-team-sample` 下发，避免出现第二套前端规则解释器。
 */

export interface CommitConventionConfig {
  enabled: boolean;
  requiredIssueId: boolean;
  issueIdPattern: string;
  requiredModule: boolean;
  allowedModules: string[];
  requiredPrefix: boolean;
  allowedPrefixes: string[];
}

export interface CommitConventionValidation {
  valid: boolean;
  issues: string[];
}

export interface CommitConventionEditorInput {
  enabled: boolean;
  requiredIssueId: boolean;
  issueIdPattern: string;
  requiredModule: boolean;
  allowedModulesText: string;
  requiredPrefix: boolean;
  allowedPrefixesText: string;
}

export const defaultCommitConventionConfig: CommitConventionConfig = {
  enabled: false,
  requiredIssueId: false,
  issueIdPattern: "[A-Z]+-\\d+|#\\d+",
  requiredModule: false,
  allowedModules: ["order", "user", "config", "docs"],
  requiredPrefix: false,
  allowedPrefixes: [
    "feat",
    "fix",
    "config",
    "docs",
    "refactor",
    "test",
    "chore",
  ],
};

/** 提交说明样例运行预算：与提交页提交说明上限一致，平台无关。 */
export const COMMIT_CONVENTION_SAMPLE_MAX_LENGTH = 2000;

export type CommitConventionSampleRuleId = "prefix" | "module" | "issueId";

export interface CommitConventionSampleRuleResult {
  rule: CommitConventionSampleRuleId;
  label: string;
  required: boolean;
  passed: boolean;
  message: string;
}

export interface CommitConventionSamplePreview {
  valid: boolean;
  configIssues: string[];
  budgetIssue?: string;
  ruleResults: CommitConventionSampleRuleResult[];
  skeleton: string;
}

export function normalizePattern(value: string): string {
  return value.trim() || defaultCommitConventionConfig.issueIdPattern;
}

export function normalizeTextList(value: string): string[] {
  return normalizeStringList(value.split(/[\n,，;；]+/g));
}

export function normalizeStringList(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

export function buildCommitConventionConfigFromEditorInput(
  input: CommitConventionEditorInput,
): CommitConventionConfig {
  return {
    enabled: Boolean(input.enabled),
    requiredIssueId: Boolean(input.requiredIssueId),
    issueIdPattern: normalizePattern(input.issueIdPattern),
    requiredModule: Boolean(input.requiredModule),
    allowedModules: normalizeTextList(input.allowedModulesText),
    requiredPrefix: Boolean(input.requiredPrefix),
    allowedPrefixes: normalizeTextList(input.allowedPrefixesText),
  };
}

export function formatCommitConventionList(values: string[]): string {
  return normalizeStringList(values).join(", ");
}

export function validateCommitConventionConfig(
  config: CommitConventionConfig,
): CommitConventionValidation {
  if (!config.enabled) {
    return { valid: true, issues: [] };
  }

  const issues: string[] = [];
  if (config.requiredPrefix && config.allowedPrefixes.length === 0) {
    issues.push("启用前缀校验时，至少需要填写一个允许前缀。");
  }
  if (config.requiredModule && config.allowedModules.length === 0) {
    issues.push("启用模块校验时，至少需要填写一个允许模块。");
  }
  if (config.requiredIssueId) {
    try {
      new RegExp(config.issueIdPattern);
    } catch {
      issues.push(`工单号正则不合法：${config.issueIdPattern}。`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function validateCommitMessageConvention(
  message: string,
  config: CommitConventionConfig,
): CommitConventionValidation {
  if (!config.enabled) {
    return { valid: true, issues: [] };
  }

  const issues: string[] = [];
  const header = getHeader(message);
  const parsed = parseConventionalHeader(header);

  if (config.requiredPrefix) {
    if (!parsed?.prefix) {
      issues.push(
        `提交说明首行需要使用前缀：${config.allowedPrefixes.join(", ")}。`,
      );
    } else if (
      config.allowedPrefixes.length > 0 &&
      !config.allowedPrefixes.includes(parsed.prefix)
    ) {
      issues.push(
        `提交说明前缀 "${parsed.prefix}" 不在允许范围：${config.allowedPrefixes.join(", ")}。`,
      );
    }
  }

  if (config.requiredModule) {
    if (!parsed?.module) {
      issues.push(
        `提交说明首行需要包含模块，例如 feat(order): 修复订单列表。允许模块：${config.allowedModules.join(", ")}。`,
      );
    } else if (
      config.allowedModules.length > 0 &&
      !config.allowedModules.includes(parsed.module)
    ) {
      issues.push(
        `提交说明模块 "${parsed.module}" 不在允许范围：${config.allowedModules.join(", ")}。`,
      );
    }
  }

  if (
    config.requiredIssueId &&
    !matchesIssueId(message, config.issueIdPattern)
  ) {
    issues.push(
      `提交说明需要包含工单号，格式需匹配：${config.issueIdPattern}。`,
    );
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * V025-R47：按当前团队规则给出提交说明骨架。
 * 只表达前缀/模块结构；要求工单号时给出占位写法并声明不编造真实工单号，
 * 用户需按正则填写真实工单号后才会通过校验。
 */
export function buildCommitConventionSampleSkeleton(
  config: CommitConventionConfig,
): string {
  if (!config.enabled) {
    return "说明改动意图、范围与影响…";
  }
  const prefix =
    config.requiredPrefix && config.allowedPrefixes.length > 0
      ? config.allowedPrefixes[0]
      : "feat";
  const module =
    config.requiredModule && config.allowedModules.length > 0
      ? `(${config.allowedModules[0]})`
      : config.requiredModule
        ? "(示例模块)"
        : "";
  const header = `${prefix}${module}: 示例改动说明`;
  if (!config.requiredIssueId) {
    return header;
  }
  return `${header}\n\n工单号：按 ${config.issueIdPattern} 填写真实工单号，本样例不编造`;
}

/**
 * V025-R47：提交说明样例即时校验。
 * 逐规则结论复用 `validateCommitMessageConvention`（每次只保留一条待验规则，
 * 其余两条关闭），与提交页使用同一权威逻辑；配置级问题复用
 * `validateCommitConventionConfig`；样例超过字符预算即时拒绝。
 */
export function previewCommitConventionSample(
  message: string,
  config: CommitConventionConfig,
): CommitConventionSamplePreview {
  const configIssues = validateCommitConventionConfig(config).issues;
  const budgetIssue =
    message.length > COMMIT_CONVENTION_SAMPLE_MAX_LENGTH
      ? `提交说明样例超过 ${COMMIT_CONVENTION_SAMPLE_MAX_LENGTH} 个字符，已拒绝校验；请缩短后再试。`
      : undefined;
  const ruleResults: CommitConventionSampleRuleResult[] = [
    evaluateSampleRule(message, config, "prefix"),
    evaluateSampleRule(message, config, "module"),
    evaluateSampleRule(message, config, "issueId"),
  ];
  return {
    valid:
      configIssues.length === 0 &&
      budgetIssue === undefined &&
      ruleResults.every((item) => item.passed),
    configIssues,
    ...(budgetIssue === undefined ? {} : { budgetIssue }),
    ruleResults,
    skeleton: buildCommitConventionSampleSkeleton(config),
  };
}

function evaluateSampleRule(
  message: string,
  config: CommitConventionConfig,
  rule: CommitConventionSampleRuleId,
): CommitConventionSampleRuleResult {
  if (rule === "prefix") {
    if (!config.enabled || !config.requiredPrefix) {
      return {
        rule,
        label: "前缀",
        required: false,
        passed: true,
        message: "未启用前缀校验，示例无需满足此前缀要求。",
      };
    }
    const issues = validateCommitMessageConvention(message, {
      ...config,
      requiredModule: false,
      requiredIssueId: false,
    }).issues;
    return {
      rule,
      label: "前缀",
      required: true,
      passed: issues.length === 0,
      message:
        issues.length === 0
          ? `通过：前缀符合允许范围（${config.allowedPrefixes.join(", ")}）。`
          : issues.join("\n"),
    };
  }
  if (rule === "module") {
    if (!config.enabled || !config.requiredModule) {
      return {
        rule,
        label: "模块名",
        required: false,
        passed: true,
        message: "未启用模块校验，示例无需满足此模块要求。",
      };
    }
    const issues = validateCommitMessageConvention(message, {
      ...config,
      requiredPrefix: false,
      requiredIssueId: false,
    }).issues;
    return {
      rule,
      label: "模块名",
      required: true,
      passed: issues.length === 0,
      message:
        issues.length === 0
          ? `通过：模块符合允许范围（${config.allowedModules.join(", ")}）。`
          : issues.join("\n"),
    };
  }
  if (!config.enabled || !config.requiredIssueId) {
    return {
      rule,
      label: "工单号",
      required: false,
      passed: true,
      message: "未启用工单号校验，示例无需满足此工单号要求。",
    };
  }
  const issues = validateCommitMessageConvention(message, {
    ...config,
    requiredPrefix: false,
    requiredModule: false,
  }).issues;
  return {
    rule,
    label: "工单号",
    required: true,
    passed: issues.length === 0,
    message:
      issues.length === 0
        ? "通过：示例包含符合正则的工单号。"
        : issues.join("\n"),
  };
}

function getHeader(message: string): string {
  return (
    message
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function parseConventionalHeader(
  header: string,
): { prefix: string; module?: string } | undefined {
  const match = /^([a-z][a-z0-9-]*)(?:\(([^()]+)\))?\s*[:：]/i.exec(header);
  if (!match) {
    return undefined;
  }

  return {
    prefix: match[1],
    module: match[2]?.trim(),
  };
}

function matchesIssueId(message: string, pattern: string): boolean {
  try {
    return new RegExp(pattern).test(message);
  } catch {
    return false;
  }
}
