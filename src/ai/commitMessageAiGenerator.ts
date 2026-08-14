import { CommitCandidate } from "../commit/commitCandidateCollector";
import { CommitDiffSummary } from "../commit/commitDiffSummary";
import { OperationScope } from "../scope/operationScope";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import {
  AiCommitMessageFileContext,
  AiCommitMessageRequest,
  AiCommitMessageResult,
} from "./aiProvider";

const MAX_FILES_IN_COMMIT_MESSAGE_REQUEST = 80;

export interface CommitMessageAiRequestOptions {
  mode?: "draft" | "completeTemplate";
  templateId?: string;
  templateLabel?: string;
  currentMessage?: string;
  convention?: AiCommitMessageRequest["convention"];
  recentHistory?: AiCommitMessageRequest["recentHistory"];
}

export function buildCommitMessageAiRequest(
  scope: OperationScope,
  candidates: CommitCandidate[],
  selectedPaths: string[],
  diffSummaries: CommitDiffSummary[] = [],
  options: CommitMessageAiRequestOptions = {},
): AiCommitMessageRequest {
  const selected = new Set(
    selectedPaths.map((filePath) =>
      normalizePathKey(filePath, nativePathSemantics),
    ),
  );
  const diffByPath = new Map(
    diffSummaries.map((summary) => [
      normalizePathKey(summary.absolutePath, nativePathSemantics),
      summary,
    ]),
  );
  const files = candidates
    .filter((candidate) =>
      selected.has(
        normalizePathKey(candidate.absolutePath, nativePathSemantics),
      ),
    )
    .map((candidate) =>
      toCommitMessageFileContext(
        candidate,
        diffByPath.get(
          normalizePathKey(candidate.absolutePath, nativePathSemantics),
        ),
      ),
    )
    .sort((left, right) => left.path.localeCompare(right.path));
  const limitedFiles = files.slice(0, MAX_FILES_IN_COMMIT_MESSAGE_REQUEST);

  return {
    scope: scope.roots.map((root) => root.relativePath).join(", ") || ".",
    selectedFileCount: files.length,
    omittedFileCount: Math.max(files.length - limitedFiles.length, 0),
    files: limitedFiles,
    locale: "zh-CN",
    mode: options.mode,
    templateId: options.templateId,
    templateLabel: options.templateLabel,
    currentMessage: options.currentMessage,
    convention: options.convention,
    recentHistory: options.recentHistory?.slice(0, 20),
  };
}

export function createMockCommitMessageResult(
  request: AiCommitMessageRequest,
): AiCommitMessageResult {
  if (request.selectedFileCount === 0) {
    return {
      message: "",
      summary: "当前没有勾选文件，无法生成提交说明。",
      warnings: ["请先选择需要提交的文件。"],
    };
  }

  if (request.mode === "completeTemplate" && request.currentMessage?.trim()) {
    const message = completeCommitMessageTemplate(
      request.currentMessage,
      request,
    );
    return {
      message,
      summary: "已基于当前模板补全空字段，并保留用户已填写内容。",
      warnings:
        request.omittedFileCount > 0
          ? ["文件较多，AI 请求只包含前 80 个文件。"]
          : [],
    };
  }

  const statuses = countBy(request.files.map((file) => file.status));
  const groups = countBy(request.files.map((file) => file.templateGroup));
  const mainGroups = Object.entries(groups)
    .sort((left, right) => right[1] - left[1])
    .map(([group]) => group)
    .slice(0, 3)
    .join(", ");
  const statusText = Object.entries(statuses)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([status, count]) => `${status} ${count}`)
    .join(", ");
  const totalAdded = request.files.reduce(
    (sum, file) => sum + (file.diff?.addedLines ?? 0),
    0,
  );
  const totalDeleted = request.files.reduce(
    (sum, file) => sum + (file.diff?.deletedLines ?? 0),
    0,
  );
  const samplePaths = request.files
    .slice(0, 5)
    .map((file) => {
      const diffText = file.diff
        ? ` (+${file.diff.addedLines}/-${file.diff.deletedLines})`
        : "";
      return `- ${file.path}${diffText}`;
    })
    .join("\n");
  const omittedText =
    request.omittedFileCount > 0
      ? `\n- 另有 ${request.omittedFileCount} 个文件未展示给 AI`
      : "";
  const conventionWarnings = getConventionWarnings(request);

  return {
    message: [
      createFallbackTitle(request),
      "",
      `范围：${request.scope}`,
      `影响：${mainGroups || "未识别"}，共 ${request.selectedFileCount} 个文件`,
      `状态：${statusText}`,
      "",
      "文件：",
      samplePaths + omittedText,
    ].join("\n"),
    summary: `基于 ${request.selectedFileCount} 个已选文件生成本地提交说明草稿。变更量：+${totalAdded} / -${totalDeleted}`,
    warnings: [
      ...(request.omittedFileCount > 0
        ? ["文件较多，AI 请求只包含前 80 个文件。"]
        : []),
      ...conventionWarnings,
    ],
  };
}

export function mergeCommitMessagePreservingUserContent(
  currentMessage: string,
  generatedMessage: string,
): string {
  if (!currentMessage.trim()) {
    return generatedMessage.trim();
  }

  const generatedByField = new Map<string, string>();
  for (const line of normalizeLines(generatedMessage)) {
    const parsed = parseFieldLine(line);
    if (parsed?.value) {
      generatedByField.set(parsed.key, parsed.value);
    }
  }

  return normalizeLines(currentMessage)
    .map((line) => {
      const parsed = parseFieldLine(line);
      if (!parsed || parsed.value.trim()) {
        return line;
      }

      const generatedValue =
        generatedByField.get(parsed.key) ??
        createFieldFallback(parsed.label, currentMessage);
      return generatedValue ? `${parsed.prefix}${generatedValue}` : line;
    })
    .join("\n")
    .trim();
}

export function normalizeCommitMessageResult(
  value: Partial<AiCommitMessageResult>,
): AiCommitMessageResult {
  const message = typeof value.message === "string" ? value.message.trim() : "";
  const summary =
    typeof value.summary === "string"
      ? value.summary.replace(/\s+/g, " ").trim()
      : "";
  const warnings = Array.isArray(value.warnings)
    ? value.warnings
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  return {
    message,
    summary: summary || "AI 已生成提交说明草稿。",
    warnings,
  };
}

function completeCommitMessageTemplate(
  currentMessage: string,
  request: AiCommitMessageRequest,
): string {
  const generated = createGeneratedTemplateMessage(request);
  return mergeCommitMessagePreservingUserContent(currentMessage, generated);
}

function createGeneratedTemplateMessage(
  request: AiCommitMessageRequest,
): string {
  const totals = getDiffTotals(request);
  const groups = countBy(request.files.map((file) => file.templateGroup));
  const mainGroups =
    Object.entries(groups)
      .sort((left, right) => right[1] - left[1])
      .map(([group]) => group)
      .slice(0, 2)
      .join(", ") || "当前范围";
  const summary = `${request.scope}，${request.selectedFileCount} 个文件，+${totals.added} / -${totals.deleted}`;

  return [
    `需求: 整理 ${mainGroups} 相关变更`,
    `修复: 修正 ${mainGroups} 相关问题`,
    `配置: 调整 ${mainGroups} 相关配置`,
    `文档: 更新 ${mainGroups} 相关说明`,
    `重构: 优化 ${mainGroups} 相关实现`,
    `范围: ${summary}`,
    `原因: 根据本次 SVN 变更整理提交`,
    `影响: 涉及 ${mainGroups}，提交前请确认业务流程`,
    `风险: 低；已按当前勾选文件生成说明`,
  ].join("\n");
}

function createFallbackTitle(request: AiCommitMessageRequest): string {
  const convention = request.convention;
  if (!convention?.enabled) {
    return "变更：整理当前 SVN 提交范围";
  }

  const title = "整理当前 SVN 提交范围";
  const prefix = convention.requiredPrefix
    ? convention.allowedPrefixes[0]
    : undefined;
  const moduleName = convention.requiredModule
    ? convention.allowedModules[0]
    : undefined;
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

function getConventionWarnings(request: AiCommitMessageRequest): string[] {
  const convention = request.convention;
  if (!convention?.enabled) {
    return [];
  }

  const warnings: string[] = [];
  if (convention.requiredIssueId) {
    warnings.push(
      `团队规范要求提交说明包含真实工单号，格式需匹配：${convention.issueIdPattern}。`,
    );
  }
  if (convention.hint) {
    warnings.push(convention.hint);
  }
  return warnings;
}

function createFieldFallback(label: string, currentMessage: string): string {
  const normalized = label.trim();
  if (!normalized) {
    return "";
  }

  if (/范围/.test(normalized)) {
    return "当前勾选的 SVN 提交范围";
  }
  if (/原因/.test(normalized)) {
    return "根据本次变更整理";
  }
  if (/影响/.test(normalized)) {
    return "请结合本次提交内容确认影响范围";
  }
  if (/风险/.test(normalized)) {
    return "低；提交前请确认文件选择无误";
  }
  if (/需求|修复|配置|文档|重构/.test(normalized)) {
    return inferTitleFromMessage(currentMessage);
  }
  return "根据本次变更补充";
}

function inferTitleFromMessage(currentMessage: string): string {
  const firstMeaningfulLine = normalizeLines(currentMessage).find((line) => {
    const parsed = parseFieldLine(line);
    return parsed?.value.trim();
  });
  return firstMeaningfulLine
    ? (parseFieldLine(firstMeaningfulLine)?.value.trim() ?? "整理当前变更")
    : "整理当前变更";
}

function getDiffTotals(request: AiCommitMessageRequest): {
  added: number;
  deleted: number;
} {
  return request.files.reduce(
    (total, file) => ({
      added: total.added + (file.diff?.addedLines ?? 0),
      deleted: total.deleted + (file.diff?.deletedLines ?? 0),
    }),
    { added: 0, deleted: 0 },
  );
}

function toCommitMessageFileContext(
  candidate: CommitCandidate,
  diffSummary: CommitDiffSummary | undefined,
): AiCommitMessageFileContext {
  return {
    path: candidate.relativePath,
    status: candidate.status,
    fileType: candidate.fileType,
    templateGroup: candidate.templateGroup,
    reason: candidate.reason,
    diff: diffSummary
      ? {
          addedLines: diffSummary.addedLines,
          deletedLines: diffSummary.deletedLines,
          hunks: diffSummary.hunks,
          binary: diffSummary.binary,
          truncated: diffSummary.truncated,
          error: diffSummary.error,
        }
      : undefined,
  };
}

function normalizeLines(value: string): string[] {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function parseFieldLine(
  line: string,
): { key: string; label: string; prefix: string; value: string } | undefined {
  const match = /^(\s*([^:：]+)\s*[:：]\s*)(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }

  return {
    key: match[2].trim(),
    label: match[2].trim(),
    prefix: match[1],
    value: match[3],
  };
}

function countBy(values: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}
