import * as fs from "node:fs";
import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { SvnStatus, SvnStatusItem } from "../svn/svnTypes";
import { parseStatusXml } from "../svn/parsers/statusXmlParser";
import {
  GeneratedFileDecision,
  classifyGeneratedFile,
} from "./generatedFilePolicy";

export type CommitCandidateSelection =
  "selected" | "needsReview" | "excluded" | "blocked";
export type CommitTemplateGroup =
  "frontend" | "backend" | "document" | "config" | "asset" | "other";

export interface CommitCandidate {
  absolutePath: string;
  relativePath: string;
  status: SvnStatus;
  propStatus?: SvnStatus;
  fileType: string;
  templateGroup: CommitTemplateGroup;
  generatedDecision: GeneratedFileDecision;
  selection: CommitCandidateSelection;
  reason: string;
}

export interface CommitCandidateSummary {
  total: number;
  selected: number;
  needsReview: number;
  excluded: number;
  blocked: number;
  statuses: Record<string, number>;
  fileTypes: string[];
  templateGroups: CommitTemplateGroup[];
}

export async function collectCommitCandidates(
  svnPath: string,
  scope: OperationScope,
): Promise<CommitCandidate[]> {
  const byPath = new Map<string, CommitCandidate>();

  for (const root of scope.roots) {
    const result = await runSvnCommand(
      svnPath,
      ["status", "--xml", root.absolutePath],
      scope.repositoryRoot,
    );
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || `无法采集 ${root.absolutePath} 的 SVN 状态。`,
      );
    }

    for (const item of parseStatusXml(result.stdout, scope.repositoryRoot)) {
      if (!isPathInScope(scope, item.absolutePath)) {
        continue;
      }

      const key = normalizePathKey(item.absolutePath);
      if (!byPath.has(key)) {
        byPath.set(key, toCommitCandidate(item));
      }
    }
  }

  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function summarizeCommitCandidates(
  candidates: CommitCandidate[],
): CommitCandidateSummary {
  const statuses: Record<string, number> = {};
  const fileTypes = new Set<string>();
  const templateGroups = new Set<CommitTemplateGroup>();
  let selected = 0;
  let needsReview = 0;
  let excluded = 0;
  let blocked = 0;

  for (const candidate of candidates) {
    statuses[candidate.status] = (statuses[candidate.status] ?? 0) + 1;
    fileTypes.add(candidate.fileType);
    templateGroups.add(candidate.templateGroup);

    switch (candidate.selection) {
      case "selected":
        selected += 1;
        break;
      case "needsReview":
        needsReview += 1;
        break;
      case "excluded":
        excluded += 1;
        break;
      case "blocked":
        blocked += 1;
        break;
    }
  }

  return {
    total: candidates.length,
    selected,
    needsReview,
    excluded,
    blocked,
    statuses,
    fileTypes: [...fileTypes].sort(),
    templateGroups: [...templateGroups].sort(),
  };
}

function toCommitCandidate(item: SvnStatusItem): CommitCandidate {
  const generatedDecision = classifyGeneratedFile(item.relativePath);
  const fileType = inferFileType(item.absolutePath);
  const templateGroup = inferTemplateGroup(item.relativePath, fileType);
  const selection = inferSelection(item.status, generatedDecision);

  return {
    absolutePath: path.resolve(item.absolutePath),
    relativePath: normalizeRelativePath(item.relativePath),
    status: item.status,
    propStatus: item.propStatus,
    fileType,
    templateGroup,
    generatedDecision,
    selection,
    reason: getSelectionReason(item.status, generatedDecision, selection),
  };
}

function inferSelection(
  status: SvnStatus,
  generatedDecision: GeneratedFileDecision,
): CommitCandidateSelection {
  if (
    status === "conflicted" ||
    status === "obstructed" ||
    status === "incomplete"
  ) {
    return "blocked";
  }

  if (
    generatedDecision === "exclude" ||
    status === "ignored" ||
    status === "external" ||
    status === "normal"
  ) {
    return "excluded";
  }

  if (
    generatedDecision === "review" ||
    status === "missing" ||
    status === "unversioned" ||
    status === "unknown"
  ) {
    return "needsReview";
  }

  return "selected";
}

function getSelectionReason(
  status: SvnStatus,
  generatedDecision: GeneratedFileDecision,
  selection: CommitCandidateSelection,
): string {
  if (selection === "blocked") {
    return "需要先处理冲突或异常状态";
  }

  if (generatedDecision === "exclude") {
    return "命中生成物规则，默认排除";
  }

  if (generatedDecision === "review") {
    return "可能是脚本或特殊产物，需要人工确认";
  }

  if (status === "missing") {
    return "本地缺失文件，需要确认是否作为删除提交";
  }

  if (status === "unversioned") {
    return "未版本控制文件，需要确认是否加入 SVN";
  }

  if (selection === "selected") {
    return "常规可提交变更";
  }

  return "默认不进入提交";
}

function inferFileType(absolutePath: string): string {
  try {
    if (
      fs.existsSync(absolutePath) &&
      fs.statSync(absolutePath).isDirectory()
    ) {
      return "folder";
    }
  } catch {
    return "unknown";
  }

  const extension = path
    .extname(absolutePath)
    .replace(".", "")
    .toLocaleLowerCase();
  return extension || "no-ext";
}

function inferTemplateGroup(
  relativePath: string,
  fileType: string,
): CommitTemplateGroup {
  const normalized = relativePath.split(path.sep).join("/").toLocaleLowerCase();
  if (
    normalized.startsWith("docs/") ||
    fileType === "md" ||
    fileType === "txt"
  ) {
    return "document";
  }
  if (
    ["vue", "tsx", "ts", "jsx", "js", "scss", "css", "html"].includes(fileType)
  ) {
    return "frontend";
  }
  if (["java", "kt", "cs", "go", "py", "php", "rb"].includes(fileType)) {
    return "backend";
  }
  if (
    ["json", "yml", "yaml", "toml", "ini", "xml", "config"].includes(fileType)
  ) {
    return "config";
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"].includes(fileType)) {
    return "asset";
  }
  return "other";
}

function normalizePathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLocaleLowerCase() : resolved;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
