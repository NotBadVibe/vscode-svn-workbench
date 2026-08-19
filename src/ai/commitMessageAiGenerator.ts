import { CommitCandidate } from "../commit/commitCandidateCollector";
import { CommitDiffSummary } from "../commit/commitDiffSummary";
import {
  type AnalysisReceipt,
  type CommitDiffFragment,
  type DiffCoverageSummary,
  type EvidenceReference,
} from "../commit/commitDiffEvidence";
import { OperationScope } from "../scope/operationScope";
import { normalizePathIdentity as normalizePathKey } from "../scope/pathIdentity";
import { nativePathSemantics } from "../scope/nativePathSemantics";
import {
  AiCommitMessageClaim,
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
  /** v0.0.12 批次 B：变更解读中仍有效的会话内确认事实。 */
  userConfirmations?: string[];
  /** v0.0.11 §2 生成输入模式；缺省仅文件信息。 */
  diffMode?: "metadata-only" | "limited-diff";
  /** v0.0.11 §3 动作级外发回执（limited-diff 时携带）。 */
  receipt?: AnalysisReceipt;
  /** v0.0.11 §2.2 受限差异片段（limited-diff 时携带）。 */
  diffs?: CommitDiffFragment[];
  /** v0.0.11 §6 差异覆盖率（limited-diff 时携带）。 */
  coverage?: DiffCoverageSummary;
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
    userConfirmations:
      options.userConfirmations && options.userConfirmations.length > 0
        ? options.userConfirmations
        : undefined,
    // v0.0.11：受限差异输入模式（用户确认后）携带回执、覆盖率与脱敏差异正文。
    diffMode: options.diffMode,
    receipt: options.receipt,
    coverage: options.coverage,
    diffs:
      options.diffMode === "limited-diff" && options.diffs
        ? options.diffs.map((fragment) => ({
            candidateId: fragment.candidateId,
            projectRelativePath: fragment.projectRelativePath,
            content: fragment.content,
            hunks: fragment.hunks.map((hunk) => ({
              hunkId: hunk.hunkId,
              header: hunk.header,
            })),
            truncated: fragment.truncated,
            binary: fragment.binary,
          }))
        : undefined,
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

  // v0.0.11 §2.2 受限差异模式：模型能看到脱敏差异正文，可生成
  // 每条陈述关联 Host 可校验证据（candidateId + hunkId + 项目内路径）
  // 的具体说明。本地回退同样生成证据结构，由 Host 重新校验。
  if (request.diffMode === "limited-diff" && (request.diffs?.length ?? 0) > 0) {
    return createEvidenceCommitMessageResult(request);
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

/**
 * v0.0.11 受限差异模式的本地回退：基于脱敏差异正文生成“对象 + 变化 + 结果”
 * 的具体说明，每条陈述关联真实差异块证据（候选 + hunk + 项目内路径），
 * 供 Host 重新校验后展示。不虚构工单号，不覆盖用户草稿。
 */
function createEvidenceCommitMessageResult(
  request: AiCommitMessageRequest,
): AiCommitMessageResult {
  const fragments = request.diffs ?? [];
  const analyzed = fragments.filter((fragment) => fragment.hunks.length > 0);
  const primary = analyzed[0];
  const claims: AiCommitMessageClaim[] = [];

  const title =
    analyzed.length > 0
      ? `变更：${primary.projectRelativePath} 等 ${analyzed.length} 个文件的行为调整`
      : createFallbackTitle(request);

  // §5：逐条声明是正文与聚合证据的唯一来源——正文由 claims 逐条渲染，
  // 聚合证据 = 各 confirmed 声明的证据引用（每个差异块一条）。
  for (const fragment of analyzed.slice(0, 3)) {
    const hunk = fragment.hunks[0];
    if (!hunk) continue;
    claims.push({
      text: `${fragment.projectRelativePath}：${fragment.truncated ? "截断" : ""}修改了 ${fragment.hunks.length} 处差异块，具体行为见证据。`,
      status: "confirmed",
      evidence: [
        {
          candidateId: fragment.candidateId,
          hunkId: hunk.hunkId,
          projectRelativePath: fragment.projectRelativePath,
        },
      ],
    });
  }

  const unknownCount = request.selectedFileCount - analyzed.length;
  if (unknownCount > 0) {
    // §5：仅文件信息/截断/二进制/读取失败的项无法证明具体行为，标记待确认。
    claims.push({
      text: `另有 ${unknownCount} 个文件仅文件信息，无法判断具体行为（截断/二进制/读取失败或预算外）。`,
      status: "toConfirm",
    });
  }
  const conventionWarnings = getConventionWarnings(request);
  const claimsLines = claims.map((claim) => `- ${claim.text}`);
  const evidence = claims.flatMap((claim) => claim.evidence ?? []);

  return {
    message: [
      title,
      "",
      claimsLines.length > 0 ? claimsLines.join("\n") : "无法判断具体改动。",
    ].join("\n"),
    summary: `基于受限差异生成提交说明：已分析 ${analyzed.length} 个文件，${unknownCount} 个文件仅文件信息。`,
    warnings: [
      ...(fragments.some((fragment) => fragment.truncated)
        ? ["部分差异超过预算已截断，具体行为以证据为准。"]
        : []),
      ...conventionWarnings,
    ],
    evidence,
    // §5 逐条声明注解层：本地回退为每条已证实/待确认陈述标记状态。
    ...(claims.length > 0 ? { claims } : {}),
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

  const evidence = normalizeEvidenceReferences(value.evidence, warnings);
  const claims = normalizeCommitMessageClaims(value.claims, warnings);

  // v0.0.11 §4/§5：证据与声明结构校验——畸形条目丢弃并计入警告；引用是否
  // 真实有效（候选/路径/hunk/时效）由 Host 经 validateEvidenceReferences /
  // validateCommitMessageClaims 重新校验，这里不做信任假设。
  // 输入未携带证据/声明字段时返回不带对应字段的对象（保持 v0.0.9 契约）。
  return evidence.length > 0 || claims.length > 0
    ? {
        message,
        summary: summary || "AI 已生成提交说明草稿。",
        warnings,
        ...(evidence.length > 0 ? { evidence } : {}),
        ...(claims.length > 0 ? { claims } : {}),
      }
    : { message, summary: summary || "AI 已生成提交说明草稿。", warnings };
}

/**
 * 规范化模型返回的逐条声明：text 非空字符串、status 在枚举内；
 * 每条声明的证据引用经证据规范化处理；畸形条目丢弃并追加警告。
 */
function normalizeCommitMessageClaims(
  value: unknown,
  warnings: string[],
): AiCommitMessageClaim[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnings.push("模型返回的逐条声明结构无效，已忽略。");
    }
    return [];
  }
  const normalized: AiCommitMessageClaim[] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (typeof raw.text !== "string" || raw.text.trim() === "") {
      dropped += 1;
      continue;
    }
    if (
      raw.status !== "confirmed" &&
      raw.status !== "inferred" &&
      raw.status !== "toConfirm"
    ) {
      dropped += 1;
      continue;
    }
    const evidence = normalizeEvidenceReferences(raw.evidence, warnings);
    normalized.push({
      text: raw.text.trim(),
      status: raw.status,
      ...(evidence.length > 0 ? { evidence } : {}),
    });
  }
  if (dropped > 0) {
    warnings.push(`模型返回 ${dropped} 条结构无效的逐条声明，已忽略。`);
  }
  return normalized;
}

/** 规范化模型返回的证据引用：畸形条目丢弃并追加警告，不静默放过。 */
function normalizeEvidenceReferences(
  value: unknown,
  warnings: string[],
): EvidenceReference[] {
  if (!Array.isArray(value)) {
    if (value !== undefined) {
      warnings.push("模型返回的证据引用结构无效，已忽略。");
    }
    return [];
  }
  const normalized: EvidenceReference[] = [];
  let dropped = 0;
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      dropped += 1;
      continue;
    }
    const raw = item as Record<string, unknown>;
    if (
      typeof raw.candidateId !== "string" ||
      raw.candidateId.trim() === "" ||
      typeof raw.projectRelativePath !== "string" ||
      raw.projectRelativePath.trim() === ""
    ) {
      dropped += 1;
      continue;
    }
    const hunkId =
      typeof raw.hunkId === "string" && raw.hunkId.trim() !== ""
        ? raw.hunkId.trim()
        : undefined;
    normalized.push({
      candidateId: raw.candidateId.trim(),
      projectRelativePath: raw.projectRelativePath.trim(),
      ...(hunkId ? { hunkId } : {}),
    });
  }
  if (dropped > 0) {
    warnings.push(`模型返回 ${dropped} 条结构无效的证据引用，已忽略。`);
  }
  return normalized;
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
