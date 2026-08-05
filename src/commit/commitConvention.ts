import * as vscode from "vscode";
import { AiCommitConventionHint } from "../ai/aiProvider";
import {
  SVN_WORKBENCH_CONFIG_FILE,
  describeSvnWorkbenchConfigError,
  ensureSvnWorkbenchConfigFile,
  mergeSvnWorkbenchConfigContent,
  parseSvnWorkbenchConfigContent,
  readSvnWorkbenchConfig,
  readSvnWorkbenchConfigContent,
  serializeSvnWorkbenchConfig,
  updateSvnWorkbenchConfig,
} from "../config/svnWorkbenchConfig";

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

export interface SvnWorkbenchProjectConfig {
  [key: string]: unknown;
  commitConvention?: Partial<CommitConventionConfig>;
}

export interface ProjectCommitConventionParseResult {
  config?: Partial<CommitConventionConfig>;
  warnings: string[];
}

export interface CommitConventionResolution {
  config: CommitConventionConfig;
  source: "vscodeSettings" | "repository";
  configPath?: string;
  warnings: string[];
}

export interface CommitConventionHintOptions {
  source?: string;
  configPath?: string;
  warnings?: string[];
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

export interface CommitConventionEditState {
  configPath: string;
  config: CommitConventionConfig;
  warnings: string[];
}

export { SVN_WORKBENCH_CONFIG_FILE };

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

export function readCommitConventionConfig(): CommitConventionConfig {
  const config = vscode.workspace.getConfiguration(
    "svnWorkbench.commitConvention",
  );
  return {
    enabled: config.get<boolean>(
      "enabled",
      defaultCommitConventionConfig.enabled,
    ),
    requiredIssueId: config.get<boolean>(
      "requiredIssueId",
      defaultCommitConventionConfig.requiredIssueId,
    ),
    issueIdPattern: normalizePattern(
      config.get<string>(
        "issueIdPattern",
        defaultCommitConventionConfig.issueIdPattern,
      ),
    ),
    requiredModule: config.get<boolean>(
      "requiredModule",
      defaultCommitConventionConfig.requiredModule,
    ),
    allowedModules: normalizeStringList(
      config.get<string[]>(
        "allowedModules",
        defaultCommitConventionConfig.allowedModules,
      ),
    ),
    requiredPrefix: config.get<boolean>(
      "requiredPrefix",
      defaultCommitConventionConfig.requiredPrefix,
    ),
    allowedPrefixes: normalizeStringList(
      config.get<string[]>(
        "allowedPrefixes",
        defaultCommitConventionConfig.allowedPrefixes,
      ),
    ),
  };
}

export async function resolveCommitConventionConfig(
  repositoryRoot?: string,
): Promise<CommitConventionResolution> {
  const userConfig = readCommitConventionConfig();
  if (!repositoryRoot) {
    return {
      config: userConfig,
      source: "vscodeSettings",
      warnings: [],
    };
  }

  const project = await readProjectCommitConventionConfig(repositoryRoot);
  if (!project.config) {
    return {
      config: userConfig,
      source: "vscodeSettings",
      configPath: project.configPath,
      warnings: project.warnings,
    };
  }

  return {
    config: mergeCommitConventionConfig(userConfig, project.config),
    source: "repository",
    configPath: project.configPath,
    warnings: project.warnings,
  };
}

export async function readProjectCommitConventionConfig(
  repositoryRoot: string,
): Promise<{
  config?: Partial<CommitConventionConfig>;
  configPath: string;
  warnings: string[];
}> {
  const result = await readSvnWorkbenchConfig(repositoryRoot);
  if (result.readError !== undefined) {
    return {
      configPath: result.configPath,
      warnings: [
        `读取 ${SVN_WORKBENCH_CONFIG_FILE} 失败：${describeSvnWorkbenchConfigError(result.readError)}`,
      ],
    };
  }

  if (!result.exists) {
    return {
      configPath: result.configPath,
      warnings: [],
    };
  }

  if (!result.raw) {
    return {
      configPath: result.configPath,
      warnings: result.warnings,
    };
  }

  const parsed = extractCommitConventionConfig(result.raw);
  return {
    config: parsed.config,
    configPath: result.configPath,
    warnings: parsed.warnings,
  };
}

export function parseSvnWorkbenchProjectConfig(
  content: string,
): ProjectCommitConventionParseResult {
  const parsed = parseSvnWorkbenchConfigContent(content);
  if (!parsed.raw) {
    return {
      warnings: parsed.warnings,
    };
  }

  return extractCommitConventionConfig(parsed.raw);
}

function extractCommitConventionConfig(
  raw: Record<string, unknown>,
): ProjectCommitConventionParseResult {
  const commitConvention = raw.commitConvention;
  if (commitConvention === undefined) {
    return {
      warnings: [`${SVN_WORKBENCH_CONFIG_FILE} 未配置 commitConvention。`],
    };
  }

  if (!isRecord(commitConvention)) {
    return {
      warnings: ["commitConvention 必须是 JSON 对象。"],
    };
  }

  return {
    config: normalizePartialCommitConventionConfig(commitConvention),
    warnings: [],
  };
}

export function mergeCommitConventionConfig(
  base: CommitConventionConfig,
  override: Partial<CommitConventionConfig>,
): CommitConventionConfig {
  return {
    enabled: override.enabled ?? base.enabled,
    requiredIssueId: override.requiredIssueId ?? base.requiredIssueId,
    issueIdPattern: override.issueIdPattern
      ? normalizePattern(override.issueIdPattern)
      : base.issueIdPattern,
    requiredModule: override.requiredModule ?? base.requiredModule,
    allowedModules: override.allowedModules
      ? normalizeStringList(override.allowedModules)
      : base.allowedModules,
    requiredPrefix: override.requiredPrefix ?? base.requiredPrefix,
    allowedPrefixes: override.allowedPrefixes
      ? normalizeStringList(override.allowedPrefixes)
      : base.allowedPrefixes,
  };
}

export async function readCommitConventionEditState(
  repositoryRoot: string,
): Promise<CommitConventionEditState> {
  const configPath = await ensureSvnWorkbenchProjectConfig(repositoryRoot);
  const content = await readSvnWorkbenchConfigContent(repositoryRoot);
  const parsed = parseSvnWorkbenchProjectConfig(content);
  return {
    configPath,
    config: mergeCommitConventionConfig(
      defaultCommitConventionConfig,
      parsed.config ?? {},
    ),
    warnings: parsed.warnings,
  };
}

export function createDefaultSvnWorkbenchProjectConfig(): SvnWorkbenchProjectConfig {
  return {
    commitConvention: {
      enabled: true,
      requiredPrefix: true,
      allowedPrefixes: defaultCommitConventionConfig.allowedPrefixes,
      requiredModule: true,
      allowedModules: defaultCommitConventionConfig.allowedModules,
      requiredIssueId: true,
      issueIdPattern: defaultCommitConventionConfig.issueIdPattern,
    },
  };
}

export function serializeSvnWorkbenchProjectConfig(
  config: SvnWorkbenchProjectConfig,
): string {
  return serializeSvnWorkbenchConfig(config);
}

export async function ensureSvnWorkbenchProjectConfig(
  repositoryRoot: string,
): Promise<string> {
  return ensureSvnWorkbenchConfigFile(
    repositoryRoot,
    serializeSvnWorkbenchProjectConfig(
      createDefaultSvnWorkbenchProjectConfig(),
    ),
  );
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

export function updateSvnWorkbenchProjectConfigContent(
  content: string,
  commitConvention: CommitConventionConfig,
): { content: string; warnings: string[] } {
  return mergeSvnWorkbenchConfigContent(content, { commitConvention });
}

export async function saveProjectCommitConventionConfig(
  repositoryRoot: string,
  commitConvention: CommitConventionConfig,
): Promise<{ configPath: string; warnings: string[] }> {
  return updateSvnWorkbenchConfig(
    repositoryRoot,
    { commitConvention },
    serializeSvnWorkbenchProjectConfig(
      createDefaultSvnWorkbenchProjectConfig(),
    ),
  );
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

export function buildCommitConventionHint(
  config: CommitConventionConfig,
  options: CommitConventionHintOptions = {},
): string {
  const warnings = options.warnings ?? [];
  if (!config.enabled) {
    return warnings.length > 0
      ? `团队提交规范未启用；配置提醒：${warnings.join("；")}`
      : "";
  }

  const parts = ["团队提交规范已启用"];
  if (options.source) {
    parts.push(`来源：${options.source}`);
  }
  if (config.requiredPrefix) {
    parts.push(`首行前缀：${config.allowedPrefixes.join(", ")}`);
  }
  if (config.requiredModule) {
    parts.push(`模块：${config.allowedModules.join(", ")}`);
  }
  if (config.requiredIssueId) {
    parts.push(`工单号匹配：${config.issueIdPattern}`);
  }
  if (warnings.length > 0) {
    parts.push(`配置提醒：${warnings.join("；")}`);
  }
  return parts.join("；");
}

export function toAiCommitConventionHint(
  config: CommitConventionConfig,
): AiCommitConventionHint | undefined {
  if (!config.enabled) {
    return undefined;
  }

  return {
    enabled: config.enabled,
    requiredIssueId: config.requiredIssueId,
    issueIdPattern: config.issueIdPattern,
    requiredModule: config.requiredModule,
    allowedModules: config.allowedModules,
    requiredPrefix: config.requiredPrefix,
    allowedPrefixes: config.allowedPrefixes,
    hint: buildCommitConventionHint(config),
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

function normalizePartialCommitConventionConfig(
  value: Record<string, unknown>,
): Partial<CommitConventionConfig> {
  const result: Partial<CommitConventionConfig> = {};
  if (typeof value.enabled === "boolean") {
    result.enabled = value.enabled;
  }
  if (typeof value.requiredIssueId === "boolean") {
    result.requiredIssueId = value.requiredIssueId;
  }
  if (typeof value.issueIdPattern === "string") {
    result.issueIdPattern = normalizePattern(value.issueIdPattern);
  }
  if (typeof value.requiredModule === "boolean") {
    result.requiredModule = value.requiredModule;
  }
  if (Array.isArray(value.allowedModules)) {
    result.allowedModules = normalizeStringList(
      value.allowedModules.filter(
        (item): item is string => typeof item === "string",
      ),
    );
  }
  if (typeof value.requiredPrefix === "boolean") {
    result.requiredPrefix = value.requiredPrefix;
  }
  if (Array.isArray(value.allowedPrefixes)) {
    result.allowedPrefixes = normalizeStringList(
      value.allowedPrefixes.filter(
        (item): item is string => typeof item === "string",
      ),
    );
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePattern(value: string): string {
  return value.trim() || defaultCommitConventionConfig.issueIdPattern;
}

function normalizeTextList(value: string): string[] {
  return normalizeStringList(value.split(/[\n,，;；]+/g));
}

function normalizeStringList(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}
