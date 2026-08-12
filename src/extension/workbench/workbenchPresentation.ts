import * as path from "node:path";
import {
  AI_PROVIDER_PRESETS,
  AI_USAGE_SCENARIOS,
  readStoredAiConfiguration,
  type AiProviderPresetId,
  type AiUsageScenario,
} from "../../ai/aiModelConfiguration";
import {
  buildCommitConventionConfigFromEditorInput,
  type CommitConventionConfig,
} from "../../commit/commitConvention";
import {
  defaultWorkbenchTask,
  isWorkbenchTaskForModule,
  type AgentSnapshot,
  type WorkbenchModuleId,
  type WorkbenchScopeView,
  type WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";
import type { OperationScope } from "../../scope/operationScope";

export function toScopeView(scope: OperationScope): WorkbenchScopeView {
  return {
    repositoryName: path.basename(scope.repositoryRoot) || "SVN 仓库",
    roots: scope.roots.map((root) => ({
      kind: root.kind,
      relativePath: normalizeRelative(root.relativePath),
    })),
    source:
      scope.source === "editorFile"
        ? "editor"
        : scope.source === "scmSelection"
          ? "scm"
          : scope.source === "commandPalette"
            ? "commandPalette"
            : "explorer",
  };
}

export function getModuleTitle(
  moduleId: WorkbenchModuleId,
  taskId: WorkbenchTaskId,
): string {
  const taskTitles: Record<WorkbenchTaskId, string> = {
    "changes/overview": "工作副本修改",
    "commit/compose": "提交当前范围",
    "diff/working": "查看本地修改",
    "history/revisions": "历史记录",
    "conflicts/resolve": "冲突处理",
    "changelists/manage": "变更集",
    "ai-review/review": "AI 变更审查",
    "impact/analyze": "影响与测试",
    "agent/plan": "AI 任务代理",
    "repository/update": "更新当前范围",
    "repository/recovery": "清理与恢复工作副本",
    "repository/browse": "浏览 SVN 仓库",
    "repository/branch": "创建 SVN 分支",
    "repository/tag": "创建 SVN 标签",
    "repository/switch": "切换工作副本",
    "repository/relocate": "重定位仓库地址",
    "repository/merge": "合并到工作副本",
    "repository/patch-shelf": "补丁与本地搁置",
    "repository/release-notes": "生成发布说明",
    "repository/properties": "SVN 属性",
    "settings/ai": "AI 模型设置",
    "settings/team": "团队提交规范",
    "settings/svn": "SVN 安全设置",
    "settings/selection": "提交选择规则",
    "diagnostics/environment": "环境诊断",
    "diagnostics/acceptance": "验收清单",
  };
  const task = isWorkbenchTaskForModule(taskId, moduleId)
    ? taskId
    : defaultWorkbenchTask(moduleId);
  return `SVN · ${taskTitles[task]}`;
}

export function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/") || ".";
}

export function inferLanguage(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const aliases: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    svelte: "svelte",
    py: "python",
    java: "java",
    xml: "xml",
    html: "html",
    css: "css",
  };
  return aliases[extension] ?? (extension || "text");
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function asStringAllowEmpty(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

export function asRevision(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+$/.test(value) ? value : undefined;
}

export function asRevisionArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === "string" && /^\d+$/.test(item),
  );
}

export function toAiConfigurationInput(data: Record<string, unknown>) {
  const providerPreset = asString(data.providerPreset);
  if (
    !providerPreset ||
    !AI_PROVIDER_PRESETS.some((item) => item.id === providerPreset)
  ) {
    throw new Error("AI 供应商预设无效。");
  }
  const scenarioModels: Partial<Record<AiUsageScenario, string>> = {};
  if (isRecord(data.scenarioModels)) {
    for (const scenario of AI_USAGE_SCENARIOS) {
      const value = asStringAllowEmpty(
        data.scenarioModels[scenario.id],
      )?.trim();
      if (value) scenarioModels[scenario.id] = value;
    }
  }
  return {
    providerPreset: providerPreset as AiProviderPresetId,
    baseUrl: asStringAllowEmpty(data.baseUrl) ?? "",
    model: asStringAllowEmpty(data.model) ?? "",
    scenarioModels,
    apiKey: asStringAllowEmpty(data.apiKey),
    clearApiKey: data.clearApiKey === true,
    includeCommitHistory: data.includeCommitHistory === true,
    historyLimit:
      typeof data.historyLimit === "number"
        ? data.historyLimit
        : Number(asString(data.historyLimit) ?? 10),
  };
}

export function toTeamConfig(
  data: Record<string, unknown>,
): CommitConventionConfig {
  return buildCommitConventionConfigFromEditorInput({
    enabled: data.enabled === true,
    requiredIssueId: data.requiredIssueId === true,
    issueIdPattern: asStringAllowEmpty(data.issueIdPattern) ?? "",
    requiredModule: data.requiredModule === true,
    allowedModulesText: asStringAllowEmpty(data.allowedModulesText) ?? "",
    requiredPrefix: data.requiredPrefix === true,
    allowedPrefixesText: asStringAllowEmpty(data.allowedPrefixesText) ?? "",
  });
}

export function aiConventionToTeamConfig(value: {
  enabled: boolean;
  requiredIssueId: boolean;
  issueIdPattern: string;
  requiredModule: boolean;
  allowedModules: string[];
  requiredPrefix: boolean;
  allowedPrefixes: string[];
}): CommitConventionConfig {
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildScenarioModelMap(
  stored: Awaited<ReturnType<typeof readStoredAiConfiguration>>,
): Partial<Record<AiUsageScenario, string>> {
  return Object.fromEntries(
    AI_USAGE_SCENARIOS.map((scenario) => [
      scenario.id,
      stored.scenarioModels[scenario.id] || stored.model,
    ]),
  );
}

export function quoteRelative(value: string): string {
  return `"${normalizeRelative(value).replace(/"/g, '\\"')}"`;
}

export function emptyAgentSnapshot(): AgentSnapshot {
  return {
    kind: "agent",
    status: "idle",
    objective: "",
    steps: [],
    guardrails: [
      "只访问当前右键范围",
      "每一步都需要显式批准",
      "不自动修改文件、不自动提交",
      "状态变化后计划立即失效",
    ],
  };
}
