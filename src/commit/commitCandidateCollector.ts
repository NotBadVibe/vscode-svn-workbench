import * as fs from "node:fs";
import * as path from "node:path";
import { OperationScope } from "../scope/operationScope";
import { isPathInScope } from "../scope/pathBoundaryGuard";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import { runSvnCommand } from "../svn/svnCommandRunner";
import { SvnStatus, SvnStatusItem } from "../svn/svnTypes";
import { parseStatusXml } from "../svn/parsers/statusXmlParser";
import { GeneratedFileDecision } from "./generatedFilePolicy";
import {
  CommitSelectionDecision,
  CommitSelectionExplanation,
  ResolvedCommitSelectionPathRule,
} from "./commitSelectionRules";
import {
  CommitSelectionEvaluator,
  EffectiveCommitSelectionRules,
  createCommitSelectionEvaluator,
  getBuiltinCommitSelectionEvaluator,
  toCommitCandidateSelectionValue,
} from "./commitSelectionRuleEvaluator";

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
  /** 本地规则结论（决策 + 结构化解释 + 是否安全锁定），随候选透传给 AI 请求与校验。 */
  evaluation: CommitSelectionExplanation;
}

export interface CollectCommitCandidatesOptions {
  /**
   * 有效提交选择规则（通常由 commitSelectionRuleService 按仓库解析）。
   * 缺省使用内置默认规则，与 v0.0.2 无配置行为一致；调用方不传时结果不变。
   */
  rules?: EffectiveCommitSelectionRules;
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
  options: CollectCommitCandidatesOptions = {},
): Promise<CommitCandidate[]> {
  const byPath = new Map<string, CommitCandidate>();
  // 同一次采集共享一个评估器：传入有效规则时按规则编译，缺省回退内置默认单例。
  const evaluator = options.rules
    ? createCommitSelectionEvaluator(options.rules)
    : getBuiltinCommitSelectionEvaluator();

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
      if (!isPathInScope(scope, item.absolutePath, nativePathSemantics)) {
        continue;
      }

      const key = normalizePathKey(item.absolutePath, nativePathSemantics);
      if (!byPath.has(key)) {
        byPath.set(key, toCommitCandidate(item, evaluator));
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

function toCommitCandidate(
  item: SvnStatusItem,
  evaluator: CommitSelectionEvaluator,
): CommitCandidate {
  const relativePath = normalizeRelativePath(item.relativePath);
  // 经由有效规则评估（无配置时与 v0.0.2 一致；仅属性变化修正为推荐，
  // 见 commitSelectionRuleEvaluator.ts 与 docs/releases/v0.0.3/README.md）。
  const evaluation = evaluator.evaluate({
    relativePath,
    status: item.status,
    propStatus: item.propStatus,
  });
  // generatedDecision 只反映路径规则命中（与状态无关），保持 v0.0.2 语义。
  const matchedRule = evaluator.matchPath(relativePath);
  const generatedDecision = toGeneratedFileDecision(matchedRule?.decision);
  const fileType = inferFileType(item.absolutePath);
  const templateGroup = inferTemplateGroup(relativePath, fileType);
  const selection = toCommitCandidateSelectionValue(evaluation.decision);

  return {
    absolutePath: path.resolve(item.absolutePath),
    relativePath,
    status: item.status,
    propStatus: item.propStatus,
    fileType,
    templateGroup,
    generatedDecision,
    selection,
    reason: getSelectionReason(item.status, evaluation, matchedRule),
    evaluation,
  };
}

function toGeneratedFileDecision(
  pathRuleDecision: CommitSelectionDecision | undefined,
): GeneratedFileDecision {
  if (pathRuleDecision === "excluded") {
    return "exclude";
  }
  if (pathRuleDecision === "needsReview") {
    return "review";
  }
  return "include";
}

function getSelectionReason(
  status: SvnStatus,
  evaluation: CommitSelectionExplanation,
  matchedRule?: ResolvedCommitSelectionPathRule,
): string {
  if (evaluation.decision === "blocked") {
    return "需要先处理冲突或异常状态";
  }

  if (evaluation.reasonKey === "pathRule") {
    // 自定义规则优先展示配置的原因说明；内置规则保持 v0.0.2 原文。
    if (matchedRule && matchedRule.source !== "builtin") {
      const customReason = matchedRule.reason.trim();
      if (customReason) {
        return customReason;
      }
      if (evaluation.decision === "excluded") {
        return `命中路径规则 ${matchedRule.id}，默认排除`;
      }
      if (evaluation.decision === "needsReview") {
        return `命中路径规则 ${matchedRule.id}，需要人工确认`;
      }
      return `命中路径规则 ${matchedRule.id}，推荐提交`;
    }
    if (evaluation.decision === "excluded") {
      return "命中生成物规则，默认排除";
    }
    if (evaluation.decision === "needsReview") {
      return "可能是脚本或特殊产物，需要人工确认";
    }
  }

  if (status === "missing" && evaluation.decision === "needsReview") {
    return "本地缺失文件，需要确认是否作为删除提交";
  }

  if (status === "unversioned" && evaluation.decision === "needsReview") {
    return "未版本控制文件，需要确认是否加入 SVN";
  }

  if (evaluation.decision === "recommended") {
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

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}
