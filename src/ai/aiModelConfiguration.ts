import * as vscode from "vscode";
import { AiProviderConfig } from "./aiProvider";

export const AI_API_KEY_SECRET_KEY = "svnWorkbench.ai.apiKey";

export type AiUsageScenario =
  | "commitSelection"
  | "conflictAdvice"
  | "commitMessage"
  | "commitSplit"
  | "teamRules"
  | "conflictMerge";

export type AiProviderPresetId =
  | "deepseek"
  | "qwenDashscope"
  | "zhipuCoding"
  | "zhipuGeneral"
  | "kimi"
  | "custom";

export interface AiProviderPreset {
  id: AiProviderPresetId;
  label: string;
  baseUrl: string;
  model: string;
  description: string;
}

export interface StoredAiConfiguration {
  providerPreset: AiProviderPresetId;
  baseUrl: string;
  model: string;
  scenarioModels: Partial<Record<AiUsageScenario, string>>;
  hasSecretApiKey: boolean;
  hasLegacyApiKey: boolean;
  includeCommitHistory: boolean;
  historyLimit: number;
}

export interface AiConfigurationInput {
  providerPreset: AiProviderPresetId;
  baseUrl: string;
  model: string;
  scenarioModels?: Partial<Record<AiUsageScenario, string>>;
  apiKey?: string;
  clearApiKey?: boolean;
  includeCommitHistory?: boolean;
  historyLimit?: number;
}

export interface AiConfigurationValidation {
  valid: boolean;
  issues: string[];
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    description: "DeepSeek 的 OpenAI 兼容接口。",
  },
  {
    id: "qwenDashscope",
    label: "通义千问 DashScope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    description:
      "阿里云百炼的 OpenAI 兼容接口；部分账号需要使用对应地域的接口地址。",
  },
  {
    id: "zhipuCoding",
    label: "智谱 GLM Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    model: "glm-5.2",
    description: "面向 GLM Coding Plan API 密钥的智谱编码接口。",
  },
  {
    id: "zhipuGeneral",
    label: "智谱 GLM 通用 API",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7",
    description: "面向余额或资源包 API 密钥的智谱通用 OpenAI 兼容接口。",
  },
  {
    id: "kimi",
    label: "Kimi / Moonshot",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-latest",
    description: "Moonshot 的 OpenAI 兼容接口。",
  },
  {
    id: "custom",
    label: "自定义 OpenAI 兼容接口",
    baseUrl: "",
    model: "",
    description: "使用任意支持 /chat/completions 的接口。",
  },
];

export const AI_USAGE_SCENARIOS: Array<{
  id: AiUsageScenario;
  label: string;
  description: string;
}> = [
  {
    id: "commitSelection",
    label: "提交文件筛选",
    description: "用于判断哪些文件建议提交、排除或需要人工确认。",
  },
  {
    id: "conflictAdvice",
    label: "冲突处理建议",
    description:
      "用于分析基础版本、我的版本、对方版本和工作副本内容，并给出决策建议。",
  },
  {
    id: "commitMessage",
    label: "提交说明生成",
    description: "根据变更统计、团队规则和可选的脱敏历史摘要生成提交说明。",
  },
  {
    id: "commitSplit",
    label: "拆分提交建议",
    description: "用于根据当前候选文件建议拆成几个更清晰的 SVN 提交。",
  },
  {
    id: "teamRules",
    label: "团队规则推荐",
    description: "用于根据仓库结构和团队习惯推荐提交前缀、模块和工单号规则。",
  },
  {
    id: "conflictMerge",
    label: "冲突候选合并",
    description: "用于分析三方冲突；内嵌编辑器负责生成并保存工作副本内容。",
  },
];

export function getAiProviderPreset(id: string | undefined): AiProviderPreset {
  return (
    AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ??
    AI_PROVIDER_PRESETS[0]
  );
}

export function normalizeAiBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function validateAiProviderConfig(
  config: Partial<AiProviderConfig>,
): AiConfigurationValidation {
  const issues: string[] = [];
  if (!normalizeAiBaseUrl(config.baseUrl ?? "")) {
    issues.push("请填写 AI 接口地址（Base URL）。");
  }
  if (!(config.model ?? "").trim()) {
    issues.push("请填写 AI 模型名称。");
  }
  if (!(config.apiKey ?? "").trim()) {
    issues.push("请填写 AI API 密钥。");
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function getScenarioModel(
  defaultModel: string,
  scenarioModels: Partial<Record<AiUsageScenario, string>> | undefined,
  scenario?: AiUsageScenario,
): string {
  if (!scenario) {
    return defaultModel.trim();
  }

  return (scenarioModels?.[scenario]?.trim() || defaultModel).trim();
}

export async function readStoredAiConfiguration(
  context: vscode.ExtensionContext,
): Promise<StoredAiConfiguration> {
  const configuration = vscode.workspace.getConfiguration("svnWorkbench.ai");
  const providerPreset = getAiProviderPreset(
    configuration.get<string>("providerPreset"),
  ).id;
  const preset = getAiProviderPreset(providerPreset);
  const baseUrl = configuration.get<string>("baseUrl") || preset.baseUrl;
  const model = configuration.get<string>("model") || preset.model;
  const scenarioModels = readScenarioModels(
    configuration.get<Record<string, string>>("scenarioModels"),
  );
  const secretApiKey = await context.secrets.get(AI_API_KEY_SECRET_KEY);
  const legacyApiKey = configuration.get<string>("apiKey") ?? "";
  const includeCommitHistory = configuration.get<boolean>(
    "includeCommitHistory",
    false,
  );
  const historyLimit = Math.min(
    20,
    Math.max(1, configuration.get<number>("historyLimit", 10)),
  );

  return {
    providerPreset,
    baseUrl,
    model,
    scenarioModels,
    hasSecretApiKey: Boolean(secretApiKey),
    hasLegacyApiKey: legacyApiKey.trim().length > 0,
    includeCommitHistory,
    historyLimit,
  };
}

export async function saveAiConfiguration(
  context: vscode.ExtensionContext,
  input: AiConfigurationInput,
): Promise<StoredAiConfiguration> {
  const configuration = vscode.workspace.getConfiguration("svnWorkbench.ai");
  await configuration.update(
    "providerPreset",
    input.providerPreset,
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "baseUrl",
    normalizeAiBaseUrl(input.baseUrl),
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "model",
    input.model.trim(),
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "scenarioModels",
    cleanScenarioModels(input.scenarioModels),
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "includeCommitHistory",
    input.includeCommitHistory === true,
    vscode.ConfigurationTarget.Global,
  );
  await configuration.update(
    "historyLimit",
    Math.min(20, Math.max(1, Math.round(input.historyLimit ?? 10))),
    vscode.ConfigurationTarget.Global,
  );

  if (input.clearApiKey) {
    await context.secrets.delete(AI_API_KEY_SECRET_KEY);
  } else if (input.apiKey?.trim()) {
    await context.secrets.store(AI_API_KEY_SECRET_KEY, input.apiKey.trim());
  }

  return readStoredAiConfiguration(context);
}

export async function resolveAiProviderConfig(
  context: vscode.ExtensionContext,
  scenario?: AiUsageScenario,
): Promise<AiProviderConfig> {
  const configuration = vscode.workspace.getConfiguration("svnWorkbench.ai");
  const stored = await readStoredAiConfiguration(context);
  const secretApiKey = await context.secrets.get(AI_API_KEY_SECRET_KEY);
  const legacyApiKey = configuration.get<string>("apiKey") ?? "";
  const providerConfig: AiProviderConfig = {
    baseUrl: normalizeAiBaseUrl(stored.baseUrl),
    model: getScenarioModel(stored.model, stored.scenarioModels, scenario),
    apiKey: (secretApiKey || legacyApiKey).trim(),
  };
  const validation = validateAiProviderConfig(providerConfig);
  if (!validation.valid) {
    throw new Error(
      `AI 提供方尚未配置。请执行“SVN：AI 配置模型”。${validation.issues.join(" ")}`,
    );
  }
  return providerConfig;
}

function readScenarioModels(
  value: Record<string, string> | undefined,
): Partial<Record<AiUsageScenario, string>> {
  return cleanScenarioModels(value);
}

function cleanScenarioModels(
  value:
    | Partial<Record<AiUsageScenario, string>>
    | Record<string, string>
    | undefined,
): Partial<Record<AiUsageScenario, string>> {
  const result: Partial<Record<AiUsageScenario, string>> = {};
  if (!value) {
    return result;
  }

  for (const scenario of AI_USAGE_SCENARIOS) {
    const model = value[scenario.id]?.trim();
    if (model) {
      result[scenario.id] = model;
    }
  }
  return result;
}
