/**
 * v0.1.3 V013-C 确定性核验清单纯领域逻辑（纯函数，不含业务语义）。
 * 职责：对已保存工作副本的文本做 7 项确定性检查，输出 pass/block 与中文原因。
 * 明确边界：业务逻辑/测试是否正确等不可自动核验的仅以 manualChecks 标「需人工确认」，
 * 不混入确定性 issues，不自动执行任何命令（AI/规则的验证命令仅展示/复制）。
 * 纯计算（不含 SVN 子进程重新采集，SVN 状态由调用方预采），保存成功到核验反馈 ≤300ms。
 */

import { parseConflictRegions } from "./conflictDiffModel";
import { CONFLICT_COMPLETION_TOKEN_TTL_MS } from "./conflictCompletionModel";

/** 核验检查项 ID（7 项） */
export type VerificationCheckId =
  | "marker"
  | "fileType"
  | "scope"
  | "diskHash"
  | "svnStatus"
  | "preview"
  | "draft";

/** 单项核验结果（每项返回 pass/block + 中文 reason） */
export interface VerificationIssue {
  /** 检查项标识 */
  id: VerificationCheckId;
  /** 是否通过（true=pass，false=block） */
  pass: boolean;
  /** 中文原因说明 */
  reason: string;
}

/** 需人工确认项（不混入确定性 issues） */
export interface ManualCheck {
  /** 标识 */
  id: string;
  /** 固定标注「需人工确认」 */
  label: string;
  /** 中文说明 */
  description: string;
}

/** 确定性核验结果 */
export interface VerificationResult {
  /** 是否全部通过（任一失败则为 false） */
  pass: boolean;
  /** 7 项确定性问题列表（中文 reason） */
  issues: VerificationIssue[];
  /** 需人工确认清单（独立于 issues） */
  manualChecks: ManualCheck[];
  /** 核验时间戳 */
  checkedAt: number;
}

/** 文件类型/编码判定（复用 validateDiffEditTarget 判定结果的抽象） */
export interface VerificationFileMeta {
  /** 是否为普通文件 */
  isRegularFile: boolean;
  /** 是否可写 */
  isWritable: boolean;
  /** 是否为可解码文本（非二进制、UTF-8 合法） */
  isDecodableText: boolean;
  /** 可选：守卫返回的中文细节（用于 reason 透传） */
  detail?: string;
}

/** 归属/范围判定 */
export interface VerificationScopeMeta {
  /** 是否仍在原 operation scope 内 */
  inScope: boolean;
  /** 是否仍在原 working copy 内 */
  inWorkingCopy: boolean;
  /** 是否仍在原 repository 内（UUID 一致） */
  inRepository: boolean;
  /** 可选细节 */
  detail?: string;
}

/** SVN 状态判定（调用方预采，不在此重新采集） */
export interface VerificationSvnMeta {
  /** 是否仍为冲突状态 */
  isConflicted: boolean;
  /** 是否仍允许对当前冲突执行 resolve */
  canResolve: boolean;
  /** 可选细节 */
  detail?: string;
}

/** 预览/token 新鲜度 */
export interface VerificationPreviewMeta {
  /** token 签发时间（毫秒时间戳）；缺失视为过期 */
  tokenIssuedAt?: number;
  /** 当前时间（毫秒时间戳） */
  now: number;
  /** 可选 TTL，默认复用 CONFLICT_COMPLETION_TOKEN_TTL_MS（15 分钟） */
  ttlMs?: number;
  /** 是否存在有效预览（无预览视为过期） */
  hasPreview?: boolean;
}

/** 草稿状态 */
export interface VerificationDraftMeta {
  /** 是否存在未保存输入（true=脏） */
  hasUnsavedInput: boolean;
}

/** 确定性核验输入（纯数据，调用方预采） */
export interface DeterministicVerificationInput {
  /** 当前工作文本（用于 marker 检查） */
  workingText: string;
  /** 文件类型/编码事实（复用 validateDiffEditTarget 结果） */
  fileMeta: VerificationFileMeta;
  /** 归属范围事实 */
  scopeMeta: VerificationScopeMeta;
  /** 磁盘内容 hash（当前） */
  diskHash: string;
  /** 最近保存成功内容的 hash */
  savedHash: string;
  /** SVN 状态事实（预采） */
  svnMeta: VerificationSvnMeta;
  /** 预览/token 事实 */
  previewMeta: VerificationPreviewMeta;
  /** 草稿状态 */
  draftMeta: VerificationDraftMeta;
  /** 可选：核验时间戳（默认取 previewMeta.now） */
  checkedAt?: number;
}

/** 不可自动核验的人工确认清单（固定，不含确定性 issues） */
export const MANUAL_CHECKS: readonly ManualCheck[] = [
  {
    id: "business-logic",
    label: "需人工确认",
    description: "业务逻辑是否正确需人工确认",
  },
  {
    id: "test-correctness",
    label: "需人工确认",
    description: "测试是否覆盖变更且通过需人工确认",
  },
  {
    id: "visual-ux",
    label: "需人工确认",
    description: "界面与交互是否符合预期需人工确认",
  },
] as const;

/**
 * 逐项核验辅助：构造单项 pass/block 结果。
 * 中文 reason 必须明确说明通过/阻断原因。
 */
function issue(
  id: VerificationCheckId,
  pass: boolean,
  reason: string,
): VerificationIssue {
  return { id, pass, reason };
}

/** 检查 1：工作文本不含可识别冲突 marker（用 parseConflictRegions） */
function checkMarker(workingText: string): VerificationIssue {
  // fail-closed：非字符串视为阻断
  if (typeof workingText !== "string") {
    return issue(
      "marker",
      false,
      "无法读取工作文本，视为存在冲突标记残留（fail-closed）",
    );
  }
  const parsed = parseConflictRegions(workingText);
  if (parsed.error) {
    return issue(
      "marker",
      false,
      `检测到冲突标记解析错误（${parsed.error.message}），需先完成合并`,
    );
  }
  if (parsed.regions.length > 0) {
    return issue("marker", false, "检测到冲突标记残留，需先完成合并");
  }
  return issue("marker", true, "未检测到冲突标记");
}

/** 检查 2：文件仍为普通、可写、可解码文本 */
function checkFileType(
  meta: VerificationFileMeta | undefined,
): VerificationIssue {
  if (!meta) {
    return issue(
      "fileType",
      false,
      "文件类型信息缺失，拒绝核验（fail-closed）",
    );
  }
  if (!meta.isRegularFile) {
    return issue(
      "fileType",
      false,
      meta.detail
        ? `文件不是普通文件：${meta.detail}`
        : "文件不是普通文件，需为普通可写文本文件",
    );
  }
  if (!meta.isWritable) {
    return issue("fileType", false, "文件不可写，无法继续核验");
  }
  if (!meta.isDecodableText) {
    return issue(
      "fileType",
      false,
      meta.detail
        ? `文件不是可解码文本：${meta.detail}`
        : "文件不是可解码文本（可能为二进制或非 UTF-8）",
    );
  }
  return issue("fileType", true, "文件为普通、可写、可解码文本");
}

/** 检查 3：文件仍在原 repository/working copy/operation scope */
function checkScope(
  meta: VerificationScopeMeta | undefined,
): VerificationIssue {
  if (!meta) {
    return issue("scope", false, "归属信息缺失，拒绝核验（fail-closed）");
  }
  if (!meta.inRepository) {
    return issue(
      "scope",
      false,
      meta.detail ? `文件已不在原仓库：${meta.detail}` : "文件已不在原仓库",
    );
  }
  if (!meta.inWorkingCopy) {
    return issue(
      "scope",
      false,
      meta.detail
        ? `文件已不在原工作副本：${meta.detail}`
        : "文件已不在原工作副本",
    );
  }
  if (!meta.inScope) {
    return issue(
      "scope",
      false,
      meta.detail
        ? `文件已移出原操作范围：${meta.detail}`
        : "文件已移出原操作范围",
    );
  }
  return issue("scope", true, "文件仍在原仓库、工作副本与操作范围内");
}

/** 检查 4：磁盘内容 hash == 最近保存成功内容 */
function checkDiskHash(
  diskHash: unknown,
  savedHash: unknown,
): VerificationIssue {
  if (typeof diskHash !== "string" || typeof savedHash !== "string") {
    return issue(
      "diskHash",
      false,
      "磁盘 hash 信息缺失，拒绝核验（fail-closed）",
    );
  }
  if (diskHash !== savedHash) {
    return issue(
      "diskHash",
      false,
      "磁盘内容已变化，与最近保存不一致，需重新保存",
    );
  }
  return issue("diskHash", true, "磁盘内容与最近保存一致");
}

/** 检查 5：SVN 状态仍是允许 Resolve 的当前冲突 */
function checkSvnStatus(
  meta: VerificationSvnMeta | undefined,
): VerificationIssue {
  if (!meta) {
    return issue(
      "svnStatus",
      false,
      "SVN 状态信息缺失，拒绝核验（fail-closed）",
    );
  }
  if (!meta.isConflicted) {
    return issue(
      "svnStatus",
      false,
      meta.detail
        ? `SVN 状态已变化：${meta.detail}`
        : "文件已不是冲突状态，无法标记解决",
    );
  }
  if (!meta.canResolve) {
    return issue(
      "svnStatus",
      false,
      meta.detail
        ? `当前冲突不允许标记解决：${meta.detail}`
        : "当前冲突不允许标记解决",
    );
  }
  return issue("svnStatus", true, "SVN 状态仍为可标记解决的冲突");
}

/** 检查 6：保存/Resolve preview 未过期（token 新鲜度） */
function checkPreview(
  meta: VerificationPreviewMeta | undefined,
): VerificationIssue {
  if (!meta) {
    return issue("preview", false, "预览信息缺失，视为已过期（fail-closed）");
  }
  const ttl = meta.ttlMs ?? CONFLICT_COMPLETION_TOKEN_TTL_MS;
  if (meta.hasPreview === false) {
    return issue(
      "preview",
      false,
      "保存/解决预览不存在或已失效，需重新生成预览",
    );
  }
  if (meta.tokenIssuedAt === undefined || meta.tokenIssuedAt === null) {
    return issue("preview", false, "预览令牌缺失或已过期，需重新生成预览");
  }
  if (typeof meta.now !== "number" || Number.isNaN(meta.now)) {
    return issue(
      "preview",
      false,
      "预览时间信息异常，视为已过期（fail-closed）",
    );
  }
  if (meta.now - meta.tokenIssuedAt > ttl) {
    return issue("preview", false, "保存/解决预览已过期，需重新生成预览");
  }
  return issue("preview", true, "保存/解决预览在有效期内");
}

/** 检查 7：当前草稿无未保存输入（draft clean） */
function checkDraft(
  meta: VerificationDraftMeta | undefined,
): VerificationIssue {
  if (!meta) {
    return issue("draft", false, "草稿状态缺失，拒绝核验（fail-closed）");
  }
  if (meta.hasUnsavedInput) {
    return issue("draft", false, "存在未保存的草稿输入，需先保存");
  }
  return issue("draft", true, "草稿无未保存输入");
}

/**
 * 确定性核验主函数（纯函数，≤300ms 纯计算）。
 * 逐项执行 7 项检查，任一失败则整体 pass=false。
 * 输出不含业务语义，仅确定性 issues + 独立 manualChecks。
 */
export function runDeterministicVerification(
  input: DeterministicVerificationInput,
): VerificationResult {
  const checkedAt =
    (input as DeterministicVerificationInput | undefined)?.checkedAt ??
    (input as DeterministicVerificationInput | undefined)?.previewMeta?.now ??
    Date.now();

  // fail-closed：输入缺失直接阻断
  if (
    !input ||
    typeof (input as DeterministicVerificationInput).workingText !== "string"
  ) {
    const blocked: VerificationIssue[] = [
      issue(
        "marker",
        false,
        "核验输入缺失或工作文本异常，拒绝通过（fail-closed）",
      ),
      // 其余项仍尽力给出明细，避免吞掉信息
      checkFileType(input?.fileMeta),
      checkScope(input?.scopeMeta),
      checkDiskHash(input?.diskHash as string, input?.savedHash as string),
      checkSvnStatus(input?.svnMeta),
      checkPreview(input?.previewMeta),
      checkDraft(input?.draftMeta),
    ];
    return {
      pass: false,
      issues: blocked,
      manualChecks: [...MANUAL_CHECKS],
      checkedAt,
    };
  }

  const issues: VerificationIssue[] = [
    checkMarker(input.workingText),
    checkFileType(input.fileMeta),
    checkScope(input.scopeMeta),
    checkDiskHash(input.diskHash, input.savedHash),
    checkSvnStatus(input.svnMeta),
    checkPreview(input.previewMeta),
    checkDraft(input.draftMeta),
  ];

  const pass = issues.every((i) => i.pass);

  return {
    pass,
    issues,
    manualChecks: [...MANUAL_CHECKS],
    checkedAt,
  };
}

/**
 * 把确定性核验结果转为 V013-A 状态机的 verificationRun 事件。
 * pass → verification-pass / blocked → verification-blocked
 * issues 转为中文原因字符串数组，仅透传未通过项的 reason。
 */
export function verificationToCompletionEvent(result: VerificationResult): {
  type: "verificationRun";
  result: "pass" | "blocked";
  issues?: string[];
} {
  if (result.pass) {
    return { type: "verificationRun", result: "pass" };
  }
  const reasons = result.issues.filter((i) => !i.pass).map((i) => i.reason);
  return {
    type: "verificationRun",
    result: "blocked",
    issues: reasons.length > 0 ? reasons : ["核验未通过"],
  };
}
