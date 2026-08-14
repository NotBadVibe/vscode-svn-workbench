import * as path from "node:path";
import {
  AiCommitConventionHint,
  AiCommitSplitFileContext,
  AiCommitSplitRequest,
  AiCommitSplitResult,
  AiCommitSplitSuggestion,
} from "./aiProvider";
import { CommitCandidate } from "../commit/commitCandidateCollector";
import { inferCommitCandidateModuleGroup } from "../commit/commitCandidateGrouping";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";

const MAX_FILES_IN_COMMIT_SPLIT_REQUEST = 120;

export function buildCommitSplitAiRequest(
  scope: OperationScope,
  candidates: CommitCandidate[],
  selectedPaths: string[],
  options: { convention?: AiCommitConventionHint } = {},
): AiCommitSplitRequest {
  const selected = new Set(
    selectedPaths.map((filePath) => normalizePathKey(filePath)),
  );
  const files = candidates
    .filter((candidate) =>
      selected.has(normalizePathKey(candidate.absolutePath)),
    )
    .filter(
      (candidate) =>
        candidate.selection !== "excluded" && candidate.selection !== "blocked",
    )
    .map(toCommitSplitFileContext)
    .sort((left, right) => left.path.localeCompare(right.path));
  const limitedFiles = files.slice(0, MAX_FILES_IN_COMMIT_SPLIT_REQUEST);

  return {
    scope: scope.roots.map((root) => root.relativePath).join(", ") || ".",
    selectedFileCount: files.length,
    omittedFileCount: Math.max(files.length - limitedFiles.length, 0),
    files: limitedFiles,
    locale: "zh-CN",
    policy: {
      userFinalDecision: true,
      noAutoCommit: true,
      onlyUseProvidedFiles: true,
    },
    convention: options.convention,
  };
}

export function createLocalCommitSplitResult(
  request: AiCommitSplitRequest,
): AiCommitSplitResult {
  if (request.selectedFileCount === 0) {
    return {
      splits: [],
      warnings: ["当前没有可拆分的已选文件，请先选择需要提交的文件。"],
    };
  }

  const groups = groupFilesForSplit(request.files);
  const splits = groups.map((files, index) =>
    createLocalSplitSuggestion(request, files, index),
  );
  return {
    splits,
    warnings: [
      ...(request.omittedFileCount > 0
        ? [
            `文件较多，拆分建议只分析前 ${MAX_FILES_IN_COMMIT_SPLIT_REQUEST} 个文件。`,
          ]
        : []),
      ...(splits.length <= 1 ? ["当前文件范围较集中，暂不建议强行拆分。"] : []),
    ],
  };
}

export function normalizeCommitSplitResult(
  value: Partial<AiCommitSplitResult>,
): AiCommitSplitResult {
  return {
    splits: Array.isArray(value.splits)
      ? value.splits
          .map(normalizeSplitSuggestion)
          .filter((item) => item.paths.length > 0)
      : [],
    warnings: normalizeStringList(value.warnings),
  };
}

export function validateCommitSplitResult(
  scope: OperationScope,
  result: AiCommitSplitResult,
  allowedPaths: string[],
): AiCommitSplitResult {
  const allowed = new Set(
    allowedPaths.map((filePath) => normalizePathKey(filePath)),
  );
  const used = new Set<string>();
  const splits = result.splits
    .map((split, index) => {
      const paths = split.paths
        .map((filePath) => toAbsolutePath(scope, filePath))
        .filter((filePath) => isPathInScope(scope, filePath))
        .filter((filePath) => allowed.has(normalizePathKey(filePath)))
        .filter((filePath) => {
          const key = normalizePathKey(filePath);
          if (used.has(key)) {
            return false;
          }
          used.add(key);
          return true;
        });

      return {
        ...split,
        id: split.id || `split-${index + 1}`,
        paths,
      };
    })
    .filter((split) => split.paths.length > 0);

  return {
    splits,
    warnings: result.warnings,
  };
}

function toCommitSplitFileContext(
  candidate: CommitCandidate,
): AiCommitSplitFileContext {
  return {
    path: candidate.relativePath,
    status: candidate.status,
    fileType: candidate.fileType,
    templateGroup: candidate.templateGroup,
    moduleGroup: inferCommitCandidateModuleGroup(candidate.relativePath),
    reason: candidate.reason,
  };
}

function groupFilesForSplit(
  files: AiCommitSplitFileContext[],
): AiCommitSplitFileContext[][] {
  const byModule = groupBy(files, (file) => file.moduleGroup);
  if (byModule.size > 1) {
    return [...byModule.values()];
  }

  const byTemplate = groupBy(files, (file) => file.templateGroup);
  return byTemplate.size > 1 ? [...byTemplate.values()] : [files];
}

function createLocalSplitSuggestion(
  request: AiCommitSplitRequest,
  files: AiCommitSplitFileContext[],
  index: number,
): AiCommitSplitSuggestion {
  const moduleGroup = mostCommon(files.map((file) => file.moduleGroup));
  const templateGroup = mostCommon(files.map((file) => file.templateGroup));
  const label = moduleGroup === "repository-root" ? templateGroup : moduleGroup;
  const statusText = summarizeCounts(files.map((file) => file.status));
  const title = `拆分 ${index + 1}: ${label}`;
  const risks = inferSplitRisks(files);

  return {
    id: `split-${index + 1}`,
    title,
    summary: `${label}，${files.length} 个文件，状态：${statusText}`,
    message: createSplitCommitMessage(
      request.convention,
      label,
      templateGroup,
      files,
    ),
    paths: files.map((file) => file.path),
    reason: `按 ${moduleGroup === "repository-root" ? "文件预设" : "业务模块"} 聚合，便于提交说明聚焦。`,
    risks,
  };
}

function createSplitCommitMessage(
  convention: AiCommitConventionHint | undefined,
  label: string,
  templateGroup: string,
  files: AiCommitSplitFileContext[],
): string {
  const title = `整理 ${label} 相关变更`;
  const prefix = inferCommitPrefix(convention, templateGroup);
  const moduleName = inferCommitModule(convention, label);
  const firstLine = formatCommitTitle(prefix, moduleName, title);
  const samplePaths = files
    .slice(0, 6)
    .map((file) => `- ${file.path}`)
    .join("\n");

  return [
    firstLine,
    "",
    `范围：${label}，${files.length} 个文件`,
    `影响：${templateGroup}`,
    "",
    "文件：",
    samplePaths,
  ].join("\n");
}

function inferCommitPrefix(
  convention: AiCommitConventionHint | undefined,
  templateGroup: string,
): string | undefined {
  if (!convention?.enabled || !convention.requiredPrefix) {
    return undefined;
  }

  const preferred: Record<string, string> = {
    frontend: "feat",
    backend: "feat",
    config: "config",
    document: "docs",
    asset: "chore",
    other: "chore",
  };
  const value = preferred[templateGroup] ?? "chore";
  return convention.allowedPrefixes.includes(value)
    ? value
    : convention.allowedPrefixes[0];
}

function inferCommitModule(
  convention: AiCommitConventionHint | undefined,
  label: string,
): string | undefined {
  if (!convention?.enabled || !convention.requiredModule) {
    return undefined;
  }

  const lastPart = label.split("/").filter(Boolean).pop();
  return lastPart && convention.allowedModules.includes(lastPart)
    ? lastPart
    : convention.allowedModules[0];
}

function formatCommitTitle(
  prefix: string | undefined,
  moduleName: string | undefined,
  title: string,
): string {
  if (prefix && moduleName) {
    return `${prefix}(${moduleName}): ${title}`;
  }
  if (prefix) {
    return `${prefix}: ${title}`;
  }
  if (moduleName) {
    return `变更(${moduleName})：${title}`;
  }
  return `变更：${title}`;
}

function inferSplitRisks(files: AiCommitSplitFileContext[]): string[] {
  const risks: string[] = [];
  if (files.some((file) => file.status === "missing")) {
    risks.push("包含删除/缺失文件，提交前需确认是否为预期删除。");
  }
  if (
    files.some(
      (file) => file.status === "unversioned" || file.status === "unknown",
    )
  ) {
    risks.push("包含未版本控制文件，提交前需确认是否需要 svn add。");
  }
  if (
    files.some((file) => ["dll", "exe", "zip", "jar"].includes(file.fileType))
  ) {
    risks.push("包含二进制或产物类文件，建议确认来源。");
  }
  return risks;
}

function normalizeSplitSuggestion(value: unknown): AiCommitSplitSuggestion {
  const raw = value as Partial<AiCommitSplitSuggestion>;
  return {
    id: typeof raw.id === "string" ? raw.id.trim() : "",
    title: typeof raw.title === "string" ? raw.title.trim() : "拆分建议",
    summary: typeof raw.summary === "string" ? raw.summary.trim() : "",
    message: typeof raw.message === "string" ? raw.message.trim() : "",
    paths: normalizeStringList(raw.paths),
    reason:
      typeof raw.reason === "string" ? raw.reason.trim() : "AI 建议拆分。",
    risks: normalizeStringList(raw.risks),
  };
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    result.set(key, [...(result.get(key) ?? []), item]);
  }
  return result;
}

function mostCommon(values: string[]): string {
  return (
    Object.entries(
      values.reduce<Record<string, number>>((result, value) => {
        result[value] = (result[value] ?? 0) + 1;
        return result;
      }, {}),
    ).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "当前范围"
  );
}

function summarizeCounts(values: string[]): string {
  return Object.entries(
    values.reduce<Record<string, number>>((result, value) => {
      result[value] = (result[value] ?? 0) + 1;
      return result;
    }, {}),
  )
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toAbsolutePath(scope: OperationScope, filePath: string): string {
  return path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(scope.repositoryRoot, filePath);
}
