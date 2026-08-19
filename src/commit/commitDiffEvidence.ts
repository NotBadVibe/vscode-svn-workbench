/**
 * v0.0.11 有证据的提交说明 —— 受限差异证据域服务（纯逻辑，无 IO）。
 *
 * 负责（规划 §4、§8、§9）：
 * - 动作级外发回执（AnalysisReceipt）：任务、项目、模型、数据类型、
 *   文件数、字符总预算、单文件预算、是否含历史；
 * - 逐文件差异覆盖率（DiffCoverageState / CommitDiffCoverage）：分析、
 *   截断、二进制、读取失败、预算外五种状态；
 * - 敏感信息扫描与脱敏（scanSensitiveContent）：凭据、令牌、私钥、
 *   连接串在模型调用前先行处理；
 * - 预算裁剪（buildCommitDiffFragment / applyDiffBudget）：单文件与
 *   总字符预算，超预算文件只记 coverage 不外发内容；
 * - candidate / hunk identity（hashText / splitDiffHunks）：
 *   不透明 candidateId、逐文件差异 hash、逐差异块 hunkId；
 * - 证据引用校验（validateEvidenceReferences）：模型引用必须落在回执
 *   允许的文件与差异块集合，虚构、范围外、无法定位的引用丢弃并计因；
 * - 时效绑定（isCommitDraftEvidenceStale）：scope / 候选 / 工作副本
 *   revision 变化后旧证据引用不得继续采用。
 *
 * 不负责：SVN 命令执行（见 commitDiffCollector.ts）、模型调用、UI。
 */

export const COMMIT_DRAFT_TASK = "commit-draft" as const;
/** v0.0.12 批次 A：变更解读回执任务标识。 */
export const UNDERSTAND_CHANGES_TASK = "understand-changes" as const;
/** v0.0.12 批次 B：语义拆分回执任务标识。 */
export const CHANGELIST_SPLIT_TASK = "changelist-split" as const;
/** v0.0.12 批次 C：冲突意图解释回执任务标识。 */
export const CONFLICT_INTERPRET_TASK = "conflict-interpret" as const;

/** 动作级外发回执的任务类型（commit-draft / understand-changes / changelist-split / conflict-interpret）。 */
export type AnalysisTask =
  | typeof COMMIT_DRAFT_TASK
  | typeof UNDERSTAND_CHANGES_TASK
  | typeof CHANGELIST_SPLIT_TASK
  | typeof CONFLICT_INTERPRET_TASK;

/** 逐文件差异分析状态（规划 §6：覆盖率、截断、二进制、读取失败与预算外）。 */
export type DiffCoverageState =
  "analyzed" | "truncated" | "binary" | "readFailed" | "budgetExcluded";

export interface DiffFileCoverage {
  /** 不透明候选身份（hashText 生成，不暴露本地路径）。 */
  candidateId: string;
  /** 项目内路径（回执允许集合中的展示键，非本地绝对路径）。 */
  projectRelativePath: string;
  status: string;
  state: DiffCoverageState;
  /** 逐文件差异 hash（发送内容的确定性指纹）。 */
  diffHash: string;
  /** 实际发送的字符数（budgetExcluded/readFailed/binary 为 0）。 */
  charCount: number;
  /** 已识别的差异块数量。 */
  hunkCount: number;
  /** 中文原因（读取失败、预算外等）。 */
  reason?: string;
}

export interface DiffCoverageSummary {
  total: number;
  analyzed: number;
  truncated: number;
  binary: number;
  readFailed: number;
  budgetExcluded: number;
}

/** v0.0.11 §8 动作级外发回执（建议建立可供 v0.0.12 复用的基础类型）。 */
export interface AnalysisReceipt {
  task: AnalysisTask;
  projectId: string;
  model: string;
  dataTypes: string[];
  files: number;
  totalBudget: number;
  perFileBudget: number;
  historyIncluded: boolean;
}

export interface DiffHunkIdentity {
  /** 不透明差异块身份：candidateId + @@ 头 + 块内容 hash，模型无法伪造。 */
  hunkId: string;
  /** @@ -a,b +c,d @@ 头，用于界面展示。 */
  header: string;
}

/** 受限差异发送单元：经脱敏、裁剪、预算限制后的差异片段。 */
export interface CommitDiffFragment {
  candidateId: string;
  projectRelativePath: string;
  status: string;
  /** 发送内容的确定性指纹（绑定用）。 */
  diffHash: string;
  /** 脱敏后的差异正文（截断到单文件预算）。 */
  content: string;
  hunks: DiffHunkIdentity[];
  truncated: boolean;
  binary: boolean;
}

/** v0.0.11 §8 证据引用：candidateId + 可选 hunkId + 项目内路径。 */
export interface EvidenceReference {
  candidateId: string;
  hunkId?: string;
  projectRelativePath: string;
}

export interface EvidenceValidation {
  valid: EvidenceReference[];
  invalid: Array<{ reference: EvidenceReference; reason: string }>;
}

/** v0.0.11 §5 声明级状态：已证实 / 推断 / 待确认（不用 confidence）。 */
export type ClaimStatus = "confirmed" | "inferred" | "toConfirm";

/** 模型返回的逐条声明（可选注解层，不替代 message）。 */
export interface CommitMessageClaim {
  text: string;
  status: ClaimStatus;
  evidence?: EvidenceReference[];
}

/** Host 校验后的声明：证据只保留有效引用，无效引用带原因展示。 */
export interface ValidatedCommitMessageClaim {
  text: string;
  status: ClaimStatus;
  /** 模型标 confirmed 但无有效 Host 证据，由 Host 强制降级。 */
  downgraded: boolean;
  evidence: EvidenceReference[];
  invalidEvidence: Array<{ reference: EvidenceReference; reason: string }>;
}

/**
 * v0.0.11 §5 声明逐条校验与强制降级：
 * - 每条声明的证据引用经 validateEvidenceReferences 校验；
 * - 模型标为 confirmed 但没有任何有效 Host 证据的声明，强制降级为
 *   toConfirm（无法证明的内容需要用户确认），并计入降级数供警告；
 * - inferred / toConfirm 不因有证据而升级；
 * - 无效引用保留并附原因展示，不静默丢弃。
 */
export function validateCommitMessageClaims(
  claims: CommitMessageClaim[],
  fragments: CommitDiffFragment[],
): { claims: ValidatedCommitMessageClaim[]; downgradeCount: number } {
  let downgradeCount = 0;
  const validated = claims.map((claim) => {
    const checked = validateEvidenceReferences(claim.evidence ?? [], fragments);
    let status = claim.status;
    let downgraded = false;
    if (status === "confirmed" && checked.valid.length === 0) {
      status = "toConfirm";
      downgraded = true;
      downgradeCount += 1;
    }
    return {
      text: claim.text,
      status,
      downgraded,
      evidence: checked.valid,
      invalidEvidence: checked.invalid,
    };
  });
  return { claims: validated, downgradeCount };
}

export interface CommitDiffCollectionResult {
  fragments: CommitDiffFragment[];
  coverage: DiffFileCoverage[];
  summary: DiffCoverageSummary;
  /** 工作副本 revision（结果时效绑定之一）。 */
  revision?: string;
  excludedCount: number;
}

export interface SensitiveMatch {
  kind: string;
  start: number;
  end: number;
}

export interface SensitiveScanResult {
  matches: SensitiveMatch[];
  redacted: string;
}

/** 敏感信息识别模式（凭据、令牌、私钥、连接串）。规则先于模型调用运行。 */
const SENSITIVE_PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  {
    kind: "api-key",
    pattern:
      /\b(sk-[A-Za-z0-9_-]{16,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9_\-.]{8,}|AKIA[0-9A-Z]{16})\b/gi,
  },
  {
    kind: "token",
    pattern:
      /\b(gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{4,})\b/g,
  },
  {
    kind: "password",
    pattern: /\b(password|passwd|pwd)\s*[:=]\s*[^\s,;]{6,}/gi,
  },
  {
    kind: "secret",
    pattern:
      /\b(secret|client_secret|access_key|private_key|auth_token)\s*[:=]\s*[^\s,;]{6,}/gi,
  },
  {
    kind: "private-key",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    kind: "connection-string",
    pattern:
      /\b(mongodb(\+srv)?|postgres(ql)?|mysql|redis|amqp|jdbc|ftp):\/\/[^\s"']+/gi,
  },
];

const REDACTION_MARKER = "[已脱敏]";

/** 确定性短哈希（fnv-1a 32 位 → 8 位十六进制）。用于 candidate/hunk/diff 身份。 */
export function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** 不透明候选身份：规范绝对路径的确定性短哈希，不暴露本地路径。 */
export function buildCandidateId(
  workingCopyRoot: string,
  absolutePath: string,
): string {
  return hashText(`${workingCopyRoot}\u0000${absolutePath}`);
}

export function buildAnalysisReceipt(input: {
  task?: AnalysisTask;
  projectId: string;
  model: string;
  files: number;
  totalBudget: number;
  perFileBudget: number;
  historyIncluded: boolean;
  dataTypes?: string[];
}): AnalysisReceipt {
  return {
    task: input.task ?? COMMIT_DRAFT_TASK,
    projectId: input.projectId,
    model: input.model,
    dataTypes:
      input.dataTypes && input.dataTypes.length > 0
        ? [...input.dataTypes]
        : ["路径、状态、差异片段"],
    files: input.files,
    totalBudget: input.totalBudget,
    perFileBudget: input.perFileBudget,
    historyIncluded: input.historyIncluded,
  };
}

/** 敏感信息扫描与脱敏：返回命中清单与替换为 [已脱敏] 后的文本。 */
export function scanSensitiveContent(text: string): SensitiveScanResult {
  // 逐模式扫描并收集命中（先收集后统一脱敏，避免交叉替换）。
  const spans: Array<{ start: number; end: number; kind: string }> = [];
  for (const { kind, pattern } of SENSITIVE_PATTERNS) {
    const clone = new RegExp(
      pattern.source,
      pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
    );
    let match: RegExpExecArray | null;
    while ((match = clone.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      spans.push({ start, end, kind });
      if (clone.lastIndex === match.index) {
        clone.lastIndex += 1;
      }
    }
  }

  // 按位置排序并合并重叠区间（相邻命中之间保留原文）。
  spans.sort((left, right) => left.start - right.start || right.end - left.end);
  const merged: SensitiveMatch[] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }

  let redacted = text;
  for (let index = merged.length - 1; index >= 0; index -= 1) {
    const span = merged[index];
    redacted =
      redacted.slice(0, span.start) +
      REDACTION_MARKER +
      redacted.slice(span.end);
  }

  return { matches: merged, redacted };
}

/** 拆分统一差异文本的差异块：hunkId = hash(candidateId + 头 + 块内容)。 */
export function splitDiffHunks(
  content: string,
  candidateId: string,
): DiffHunkIdentity[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const hunks: DiffHunkIdentity[] = [];
  let header: string | undefined;
  let body: string[] = [];

  const flush = (): void => {
    if (header !== undefined) {
      const bodyText = body.join("\n");
      hunks.push({
        header,
        hunkId: hashText(`${candidateId}\u0000${header}\u0000${bodyText}`),
      });
    }
    header = undefined;
    body = [];
  };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      header = line;
    } else if (header !== undefined) {
      body.push(line);
    }
  }
  flush();

  return hunks;
}

/**
 * 由单个文件的原始差异文本构建受限差异发送片段与 coverage。
 * - readError → readFailed（不外发内容）；
 * - binary → binary（不外发内容）；
 * - 超单文件预算 → 截断到 perFileBudget，标记 truncated。
 */
export function buildCommitDiffFragment(input: {
  candidateId: string;
  projectRelativePath: string;
  status: string;
  rawContent: string;
  perFileBudget: number;
  binary: boolean;
  readError?: string;
}): { fragment?: CommitDiffFragment; coverage: DiffFileCoverage } {
  const base = {
    candidateId: input.candidateId,
    projectRelativePath: input.projectRelativePath,
    status: input.status,
  };

  if (input.readError) {
    return {
      coverage: {
        ...base,
        state: "readFailed",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: input.readError,
      },
    };
  }

  if (input.binary) {
    return {
      coverage: {
        ...base,
        state: "binary",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: "二进制内容不发送差异正文",
      },
    };
  }

  const scan = scanSensitiveContent(input.rawContent);
  const truncated = scan.redacted.length > input.perFileBudget;
  const content = truncated
    ? scan.redacted.slice(0, input.perFileBudget)
    : scan.redacted;
  const hunks = splitDiffHunks(content, input.candidateId);
  const diffHash = hashText(content);

  return {
    fragment: {
      candidateId: input.candidateId,
      projectRelativePath: input.projectRelativePath,
      status: input.status,
      diffHash,
      content,
      hunks,
      truncated,
      binary: false,
    },
    coverage: {
      ...base,
      state: truncated ? "truncated" : "analyzed",
      diffHash,
      charCount: content.length,
      hunkCount: hunks.length,
      reason: truncated
        ? `差异超过单文件预算，已截断到 ${input.perFileBudget} 字符`
        : undefined,
    },
  };
}

/**
 * 总字符预算裁剪：累计发送字符数超过 totalBudget 后，剩余文件标记
 * budgetExcluded，不发送差异正文（coverage 保留、界面可见）。
 */
export function applyDiffBudget(
  fragments: CommitDiffFragment[],
  totalBudget: number,
): { fragments: CommitDiffFragment[]; budgetExcluded: DiffFileCoverage[] } {
  const kept: CommitDiffFragment[] = [];
  const budgetExcluded: DiffFileCoverage[] = [];
  let used = 0;

  for (const fragment of fragments) {
    const nextUsed = used + fragment.content.length;
    if (nextUsed > totalBudget) {
      budgetExcluded.push({
        candidateId: fragment.candidateId,
        projectRelativePath: fragment.projectRelativePath,
        status: fragment.status,
        state: "budgetExcluded",
        diffHash: "",
        charCount: 0,
        hunkCount: 0,
        reason: "超出总字符预算，未发送差异正文",
      });
      continue;
    }
    used = nextUsed;
    kept.push(fragment);
  }

  return { fragments: kept, budgetExcluded };
}

export function buildDiffCoverageSummary(
  coverage: DiffFileCoverage[],
): DiffCoverageSummary {
  const summary: DiffCoverageSummary = {
    total: coverage.length,
    analyzed: 0,
    truncated: 0,
    binary: 0,
    readFailed: 0,
    budgetExcluded: 0,
  };
  for (const item of coverage) {
    summary[item.state] += 1;
  }
  return summary;
}

/** 汇总受限差异采集结果（片段 + 全部覆盖率 + 摘要 + revision）。 */
export function summarizeCommitDiffCollection(input: {
  fragments: CommitDiffFragment[];
  coverage: DiffFileCoverage[];
  revision?: string;
}): CommitDiffCollectionResult {
  return {
    fragments: input.fragments,
    coverage: input.coverage,
    summary: buildDiffCoverageSummary(input.coverage),
    revision: input.revision,
    excludedCount: input.coverage.filter(
      (item) => item.state === "budgetExcluded",
    ).length,
  };
}

/**
 * 证据引用校验（规划 §4、§10.1 AI11-SAFE-02）：模型返回的引用必须落在
 * 回执允许的文件与差异块集合内。虚构、范围外、路径不符或 hunk 无法定位
 * 的引用丢弃并返回中文原因；有效引用进入建议。
 */
export function validateEvidenceReferences(
  references: EvidenceReference[],
  fragments: CommitDiffFragment[],
): EvidenceValidation {
  const allowed = new Map<string, CommitDiffFragment>();
  for (const fragment of fragments) {
    allowed.set(fragment.candidateId, fragment);
  }

  const valid: EvidenceReference[] = [];
  const invalid: Array<{ reference: EvidenceReference; reason: string }> = [];

  for (const reference of references) {
    const fragment = allowed.get(reference.candidateId);
    if (!fragment) {
      invalid.push({
        reference,
        reason: "引用了未授权或范围外文件，已丢弃",
      });
      continue;
    }
    if (fragment.projectRelativePath !== reference.projectRelativePath) {
      invalid.push({
        reference,
        reason: "引用路径与回执允许集合不一致，已丢弃",
      });
      continue;
    }
    if (
      reference.hunkId !== undefined &&
      reference.hunkId !== "" &&
      !fragment.hunks.some((hunk) => hunk.hunkId === reference.hunkId)
    ) {
      invalid.push({
        reference,
        reason: "引用的差异块不在发送集合内或已过期，已丢弃",
      });
      continue;
    }
    valid.push(reference);
  }

  return { valid, invalid };
}

/** 逐文件差异 hash 绑定（建议时效校验用，键为 candidateId）。 */
export function buildDiffHashBinding(
  fragments: CommitDiffFragment[],
): Record<string, string> {
  const binding: Record<string, string> = {};
  for (const fragment of fragments) {
    binding[fragment.candidateId] = fragment.diffHash;
  }
  return binding;
}

/**
 * 建议时效判定（规划 §6）：scope、候选或工作副本 revision 变化后，
 * 旧建议与旧证据引用不得继续采用。
 */
export function isCommitDraftEvidenceStale(input: {
  bindingScopeHash?: string;
  currentScopeHash: string;
  bindingCandidateHash?: string;
  currentCandidateHash: string;
  bindingRevision?: string;
  currentRevision?: string;
}): boolean {
  if (
    input.bindingScopeHash !== undefined &&
    input.bindingScopeHash !== input.currentScopeHash
  ) {
    return true;
  }
  if (
    input.bindingCandidateHash !== undefined &&
    input.bindingCandidateHash !== input.currentCandidateHash
  ) {
    return true;
  }
  if (
    input.bindingRevision !== undefined &&
    input.currentRevision !== undefined &&
    input.bindingRevision !== input.currentRevision
  ) {
    return true;
  }
  return false;
}
