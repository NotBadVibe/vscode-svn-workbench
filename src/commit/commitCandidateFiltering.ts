import { CommitSelectionAiDecision } from "../ai/commitSelectionExplanation";
import {
  SVN_WORKBENCH_CONFIG_FILE,
  describeSvnWorkbenchConfigError,
  parseSvnWorkbenchConfigContent,
  readSvnWorkbenchConfig,
} from "../config/svnWorkbenchConfig";
import {
  CommitCandidate,
  CommitTemplateGroup,
} from "./commitCandidateCollector";

export interface CommitCandidateFilterOptions {
  search?: string;
  status?: string;
  fileType?: string;
  templateGroup?: CommitTemplateGroup | "all";
  hideGenerated?: boolean;
  aiDecision?: CommitSelectionAiDecision | "all";
  getAiDecision?: (candidate: CommitCandidate) => CommitSelectionAiDecision;
}

export type BuiltInCommitCandidateFilterPresetId =
  | "all"
  | "frontend"
  | "backend"
  | "config"
  | "document"
  | "asset"
  | "aiRecommended";

export type CommitCandidateFilterPresetId =
  BuiltInCommitCandidateFilterPresetId | string;

export interface CommitCandidateFilterPreset {
  id: CommitCandidateFilterPresetId;
  label: string;
  description: string;
  filters: CommitCandidateFilterOptions;
}

export interface CommitCandidateFilterPresetMatchSummary {
  id: string;
  label: string;
  total: number;
  selectable: number;
}

export interface RepositoryCommitCandidateFilterPresetResolution {
  configPath: string;
  presets: CommitCandidateFilterPreset[];
  warnings: string[];
}

const builtInFilterPresets: CommitCandidateFilterPreset[] = [
  {
    id: "all",
    label: "全部可见候选",
    description: "清空路径、状态、类型、模板和 AI 建议筛选，继续隐藏生成物。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "all",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "frontend",
    label: "前端代码",
    description: "按前端模板预设筛选，适合 Vue、TS、JS、CSS 等前端变更。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "frontend",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "backend",
    label: "后端代码",
    description: "按后端模板预设筛选，适合 Java、Go、Python、C# 等后端变更。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "backend",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "config",
    label: "配置文件",
    description: "按配置模板预设筛选，适合 json、yaml、xml、ini 等配置变更。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "config",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "document",
    label: "文档说明",
    description: "按文档模板预设筛选，适合 md、txt 和 docs 目录变更。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "document",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "asset",
    label: "资源文件",
    description: "按资源模板预设筛选，适合图片、图标和静态资源变更。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "asset",
      hideGenerated: true,
      aiDecision: "all",
    },
  },
  {
    id: "aiRecommended",
    label: "AI 推荐",
    description: "只看 AI 推荐提交的候选文件，适合先运行 AI 筛选后快速确认。",
    filters: {
      search: "",
      status: "all",
      fileType: "all",
      templateGroup: "all",
      hideGenerated: true,
      aiDecision: "recommended",
    },
  },
];

export function getCommitCandidateFilterPresets(
  repositoryPresets: CommitCandidateFilterPreset[] = [],
): CommitCandidateFilterPreset[] {
  const presets = builtInFilterPresets.map((preset) => ({
    ...preset,
    filters: { ...preset.filters },
  }));
  const knownIds = new Set(presets.map((preset) => preset.id));
  for (const preset of repositoryPresets) {
    if (knownIds.has(preset.id)) {
      continue;
    }
    knownIds.add(preset.id);
    presets.push({
      ...preset,
      filters: { ...preset.filters },
    });
  }
  return presets;
}

export function resolveCommitCandidateFilterPreset(
  id: string,
  repositoryPresets: CommitCandidateFilterPreset[] = [],
): CommitCandidateFilterPreset | undefined {
  const preset = getCommitCandidateFilterPresets(repositoryPresets).find(
    (item) => item.id === id,
  );
  return preset
    ? {
        ...preset,
        filters: { ...preset.filters },
      }
    : undefined;
}

export async function readRepositoryCommitCandidateFilterPresets(
  repositoryRoot: string,
): Promise<RepositoryCommitCandidateFilterPresetResolution> {
  const result = await readSvnWorkbenchConfig(repositoryRoot);
  if (result.readError !== undefined) {
    return {
      configPath: result.configPath,
      presets: [],
      warnings: [
        `读取 ${SVN_WORKBENCH_CONFIG_FILE} 提交候选筛选预设失败：${describeSvnWorkbenchConfigError(result.readError)}`,
      ],
    };
  }

  if (!result.exists) {
    return {
      configPath: result.configPath,
      presets: [],
      warnings: [],
    };
  }

  const parsed = result.raw
    ? extractRepositoryCommitCandidateFilterPresets(result.raw)
    : { presets: [], warnings: result.warnings };
  return {
    configPath: result.configPath,
    ...parsed,
  };
}

export function parseRepositoryCommitCandidateFilterPresets(content: string): {
  presets: CommitCandidateFilterPreset[];
  warnings: string[];
} {
  const parsed = parseSvnWorkbenchConfigContent(content);
  if (!parsed.raw) {
    return { presets: [], warnings: parsed.warnings };
  }

  return extractRepositoryCommitCandidateFilterPresets(parsed.raw);
}

function extractRepositoryCommitCandidateFilterPresets(
  raw: Record<string, unknown>,
): {
  presets: CommitCandidateFilterPreset[];
  warnings: string[];
} {
  const value = raw.commitCandidateFilterPresets;
  if (value === undefined) {
    return {
      presets: [],
      warnings: [],
    };
  }
  if (!Array.isArray(value)) {
    return {
      presets: [],
      warnings: ["commitCandidateFilterPresets 必须是数组。"],
    };
  }

  const knownIds = new Set(builtInFilterPresets.map((preset) => preset.id));
  const presets: CommitCandidateFilterPreset[] = [];
  const warnings: string[] = [];
  value.forEach((item, index) => {
    const normalized = normalizeRepositoryPreset(item, index, warnings);
    if (!normalized) {
      return;
    }
    if (
      knownIds.has(normalized.id) ||
      presets.some((preset) => preset.id === normalized.id)
    ) {
      warnings.push(
        `commitCandidateFilterPresets[${index}] 的 id "${normalized.id}" 已存在，已跳过。`,
      );
      return;
    }
    presets.push(normalized);
  });

  return { presets, warnings };
}

export function filterCommitCandidates(
  candidates: CommitCandidate[],
  options: CommitCandidateFilterOptions = {},
): CommitCandidate[] {
  const search = options.search?.trim().toLocaleLowerCase() ?? "";
  const status = options.status ?? "all";
  const fileType = options.fileType ?? "all";
  const templateGroup = options.templateGroup ?? "all";
  const aiDecision = options.aiDecision ?? "all";

  return candidates.filter((candidate) => {
    if (
      search &&
      !candidate.relativePath.toLocaleLowerCase().includes(search)
    ) {
      return false;
    }
    if (status !== "all" && candidate.status !== status) {
      return false;
    }
    if (fileType !== "all" && candidate.fileType !== fileType) {
      return false;
    }
    if (templateGroup !== "all" && candidate.templateGroup !== templateGroup) {
      return false;
    }
    if (options.hideGenerated && candidate.generatedDecision === "exclude") {
      return false;
    }
    const candidateAiDecision = options.getAiDecision?.(candidate) ?? "none";
    if (aiDecision !== "all" && candidateAiDecision !== aiDecision) {
      return false;
    }
    return true;
  });
}

export function getSelectableCommitCandidatePaths(
  candidates: CommitCandidate[],
): string[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.selection !== "excluded" && candidate.selection !== "blocked",
    )
    .map((candidate) => candidate.absolutePath);
}

export function summarizeCommitCandidateFilterPresetMatches(
  candidates: CommitCandidate[],
  presets: CommitCandidateFilterPreset[],
  getAiDecision?: (candidate: CommitCandidate) => CommitSelectionAiDecision,
): CommitCandidateFilterPresetMatchSummary[] {
  return presets.map((preset) => {
    const matches = filterCommitCandidates(candidates, {
      ...preset.filters,
      getAiDecision,
    });
    return {
      id: preset.id,
      label: preset.label,
      total: matches.length,
      selectable: getSelectableCommitCandidatePaths(matches).length,
    };
  });
}

function normalizeRepositoryPreset(
  value: unknown,
  index: number,
  warnings: string[],
): CommitCandidateFilterPreset | undefined {
  if (!isRecord(value)) {
    warnings.push(
      `commitCandidateFilterPresets[${index}] 必须是对象，已跳过。`,
    );
    return undefined;
  }

  const id = normalizePresetId(value.id);
  const label = typeof value.label === "string" ? value.label.trim() : "";
  if (!id) {
    warnings.push(
      `commitCandidateFilterPresets[${index}] 缺少有效 id，已跳过。`,
    );
    return undefined;
  }
  if (!label) {
    warnings.push(
      `commitCandidateFilterPresets[${index}] 缺少有效 label，已跳过。`,
    );
    return undefined;
  }
  if (!isRecord(value.filters)) {
    warnings.push(
      `commitCandidateFilterPresets[${index}] 缺少 filters 对象，已跳过。`,
    );
    return undefined;
  }

  return {
    id,
    label,
    description:
      typeof value.description === "string" && value.description.trim()
        ? value.description.trim()
        : "仓库自定义筛选预设。",
    filters: normalizeRepositoryPresetFilters(value.filters),
  };
}

function normalizeRepositoryPresetFilters(
  value: Record<string, unknown>,
): CommitCandidateFilterOptions {
  return {
    search: typeof value.search === "string" ? value.search.trim() : "",
    status:
      typeof value.status === "string" && value.status.trim()
        ? value.status.trim()
        : "all",
    fileType:
      typeof value.fileType === "string" && value.fileType.trim()
        ? value.fileType.trim()
        : "all",
    templateGroup: normalizeTemplateGroup(value.templateGroup),
    hideGenerated:
      typeof value.hideGenerated === "boolean" ? value.hideGenerated : true,
    aiDecision: normalizeAiDecision(value.aiDecision),
  };
}

function normalizePresetId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(id)) {
    return undefined;
  }
  return id;
}

function normalizeTemplateGroup(value: unknown): CommitTemplateGroup | "all" {
  return typeof value === "string" && isTemplateGroup(value) ? value : "all";
}

function normalizeAiDecision(
  value: unknown,
): CommitSelectionAiDecision | "all" {
  return typeof value === "string" && isAiDecision(value) ? value : "all";
}

function isTemplateGroup(value: string): value is CommitTemplateGroup | "all" {
  return [
    "all",
    "frontend",
    "backend",
    "document",
    "config",
    "asset",
    "other",
  ].includes(value);
}

function isAiDecision(
  value: string,
): value is CommitSelectionAiDecision | "all" {
  return [
    "all",
    "recommended",
    "needsReview",
    "excluded",
    "blocked",
    "none",
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
