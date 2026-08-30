/**
 * v0.1.3 V013-A 冲突完成状态机（纯领域模型，纯函数）。
 * 不读 DOM / 不依赖 VS Code / 不改协议 / 不改 Svelte。
 *
 * 状态枚举与 §3 一一对应：
 * draft-clean →(edit/action) draft-dirty →(checkpoint) draft-checkpointed
 * draft-dirty/checkpointed →(save preview+token) save-ready →(atomic write+authoritative reload) working-saved
 * working-saved →(deterministic checks) verification-pass | verification-blocked
 * verification-pass →(resolve preview+intent) resolve-ready →(Host revalidation+svn resolve) resolved
 * resolved →(refresh) next-conflict | all-resolved
 * 总计 11 态。派生 label/primaryAction/blockingIssues 由 phase 纯映射，UI 只消费。
 * 非文本冲突（tree/property/binary）走独立分支，不与文本 verification-pass 混用。
 * 任一 scope/revision/repositoryUUID/fileIdentity/hash/token 变化 → preview/token 失效并回到可恢复状态（草稿保留）。
 */

import type { ConflictFileIdentity, ContentHash } from "./conflictDiffModel";

/* ============================== 常量 ============================== */

/** token TTL 与 DiffEdit 一致：15 分钟 */
export const CONFLICT_COMPLETION_TOKEN_TTL_MS = 15 * 60 * 1000;

/* ============================== 冲突类型 ============================== */

export type ConflictKind = "text" | "tree" | "property" | "binary";

/* ============================== 阶段 ============================== */

export type ConflictCompletionPhase =
  | "draft-clean"
  | "draft-dirty"
  | "draft-checkpointed"
  | "save-ready"
  | "working-saved"
  | "verification-pass"
  | "verification-blocked"
  | "resolve-ready"
  | "resolved"
  | "next-conflict"
  | "all-resolved";

/** 所有合法阶段（便于校验） */
export const ALL_PHASES: readonly ConflictCompletionPhase[] = [
  "draft-clean",
  "draft-dirty",
  "draft-checkpointed",
  "save-ready",
  "working-saved",
  "verification-pass",
  "verification-blocked",
  "resolve-ready",
  "resolved",
  "next-conflict",
  "all-resolved",
] as const;

/* ============================== 状态 ============================== */

export interface ConflictCompletionState {
  /** 文件身份（ConflictFileIdentity） */
  fileIdentity: ConflictFileIdentity;
  /** 当前阶段 */
  phase: ConflictCompletionPhase;
  /** 冲突种类（决定分支） */
  conflictKind: ConflictKind;
  /** 身份快照 */
  scopeHash: string;
  workingCopyRevision: string;
  repositoryUuid: string;
  draftRevision: number;
  workingHash: ContentHash;
  draftHash: ContentHash;
  baseHash: ContentHash;
  diskHash: ContentHash;
  /** 预览/编辑 token（save / resolve 阶段有效） */
  previewToken?: string;
  editToken?: string;
  tokenIssuedAt?: number;

  // ----- 派生（纯映射，UI 只消费） -----
  /** 与 phase 同义的状态标识 */
  status: ConflictCompletionPhase;
  /** 中文标签（phase → 中文） */
  label: string;
  /** 原因说明 */
  reason: string;
  /** 主操作文案（术语复用 terminology，不自造同义词） */
  primaryAction: string;
  /** 阻止性问题（verification-blocked / token 失效等） */
  blockingIssues: string[];
  /** 是否为非文本分支 */
  nonTextBranch: boolean;
  /** 核验阻塞详情（verification-blocked 时） */
  verificationIssues: string[];
}

/* ============================== 拒绝（复用 MergeModelRejection 风格，fail-closed） ============================== */

export type ConflictCompletionRejectionCode =
  | "stale-identity"
  | "stale-revision"
  | "token-expired"
  | "token-invalid"
  | "preview-stale"
  | "invalid-transition"
  | "phase-mismatch"
  | "non-text-branch-violation"
  | "invalid-input";

export interface ConflictCompletionRejection {
  ok: false;
  code: ConflictCompletionRejectionCode;
  message: string;
}

export interface ConflictCompletionSuccess {
  ok: true;
  state: ConflictCompletionState;
}

export type ConflictCompletionResult =
  ConflictCompletionSuccess | ConflictCompletionRejection;

/* ============================== 事件 ============================== */

export type ConflictCompletionEvent =
  | { type: "edit"; draftHash?: ContentHash }
  | { type: "checkpointed" }
  | {
      type: "saveRequested";
      previewToken: string;
      editToken: string;
      tokenIssuedAt: number;
    }
  | { type: "saved" }
  | {
      type: "verificationRun";
      result: "pass" | "blocked";
      issues?: string[];
    }
  | {
      type: "previewRefreshed";
      previewToken: string;
      tokenIssuedAt: number;
    }
  | { type: "resolved"; hasNextConflict?: boolean }
  | { type: "invalidation"; change: InvalidationChange };

/* ============================== 失效输入（8 种） ============================== */

export type InvalidationKind =
  | "scopeChanged"
  | "revisionChanged"
  | "repoChanged"
  | "fileMoved"
  | "diskChanged"
  | "baseChanged"
  | "tokenExpired"
  | "previewStale";

export interface InvalidationChange {
  kind: InvalidationKind;
  /** 发生变化时的当前时间（用于 tokenExpired 判定） */
  now?: number;
}

/* ============================== 内部：派生映射 ============================== */

function isNonText(kind: ConflictKind): boolean {
  return kind !== "text";
}

function labelForPhase(
  phase: ConflictCompletionPhase,
  nonText: boolean,
): string {
  // 复用 terminology 术语：编辑 / 保存工作副本 / 核验 / 标记解决 / 下一个
  switch (phase) {
    case "draft-clean":
      return "草稿已就绪";
    case "draft-dirty":
      return "草稿已修改";
    case "draft-checkpointed":
      return "检查点已保存";
    case "save-ready":
      return "已就绪可保存工作副本";
    case "working-saved":
      return "已保存工作副本";
    case "verification-pass":
      return nonText ? "已核验（非文本）" : "已通过核验";
    case "verification-blocked":
      return "核验未通过";
    case "resolve-ready":
      return "已就绪可标记解决";
    case "resolved":
      return "已标记解决";
    case "next-conflict":
      return "前往下一个冲突";
    case "all-resolved":
      return "全部已解决";
    default:
      return phase;
  }
}

function reasonForPhase(
  phase: ConflictCompletionPhase,
  nonText: boolean,
): string {
  switch (phase) {
    case "draft-clean":
      return "草稿与工作副本一致，等待编辑";
    case "draft-dirty":
      return "检测到未保存的编辑，需先保存检查点或保存工作副本";
    case "draft-checkpointed":
      return "检查点已保存至内存，可保存到工作副本";
    case "save-ready":
      return "已生成保存预览与令牌，可执行原子写入";
    case "working-saved":
      return "已写入工作副本，等待确定性核验";
    case "verification-pass":
      return nonText
        ? "非文本冲突已完成核验分支"
        : "确定性核验已通过，可生成解决预览";
    case "verification-blocked":
      return "确定性核验发现阻止性问题，需先处理";
    case "resolve-ready":
      return "已生成解决预览与意图，可请求标记解决";
    case "resolved":
      return "已完成 svn resolve，需刷新冲突列表";
    case "next-conflict":
      return "存在下一个冲突，继续处理";
    case "all-resolved":
      return "所有冲突已解决";
    default:
      return "";
  }
}

function primaryActionForPhase(phase: ConflictCompletionPhase): string {
  // 术语复用：编辑 / 保存工作副本 / 核验 / 标记解决 / 下一个
  switch (phase) {
    case "draft-clean":
      return "编辑";
    case "draft-dirty":
      return "保存工作副本";
    case "draft-checkpointed":
      return "保存工作副本";
    case "save-ready":
      return "保存工作副本";
    case "working-saved":
      return "核验";
    case "verification-pass":
      return "标记解决";
    case "verification-blocked":
      return "编辑";
    case "resolve-ready":
      return "标记解决";
    case "resolved":
      return "刷新";
    case "next-conflict":
      return "下一个";
    case "all-resolved":
      return "完成";
    default:
      return "编辑";
  }
}

function blockingIssuesForPhase(
  phase: ConflictCompletionPhase,
  verificationIssues: string[],
): string[] {
  if (phase === "verification-blocked") {
    return verificationIssues.length > 0
      ? [...verificationIssues]
      : ["核验未通过"];
  }
  if (phase === "save-ready" || phase === "resolve-ready") {
    return [];
  }
  return [];
}

function deriveFields(
  phase: ConflictCompletionPhase,
  kind: ConflictKind,
  verificationIssues: string[],
): Pick<
  ConflictCompletionState,
  | "status"
  | "label"
  | "reason"
  | "primaryAction"
  | "blockingIssues"
  | "nonTextBranch"
> {
  const nonText = isNonText(kind);
  return {
    status: phase,
    label: labelForPhase(phase, nonText),
    reason: reasonForPhase(phase, nonText),
    primaryAction: primaryActionForPhase(phase),
    blockingIssues: blockingIssuesForPhase(phase, verificationIssues),
    nonTextBranch: nonText,
  };
}

/** 统一构造状态（纯函数，自动填充派生字段） */
function buildState(
  base: Omit<
    ConflictCompletionState,
    | "status"
    | "label"
    | "reason"
    | "primaryAction"
    | "blockingIssues"
    | "nonTextBranch"
    | "verificationIssues"
  > & { verificationIssues?: string[] },
): ConflictCompletionState {
  const issues = base.verificationIssues ?? [];
  const derived = deriveFields(base.phase, base.conflictKind, issues);
  return {
    ...base,
    verificationIssues: issues,
    ...derived,
  };
}

/* ============================== 工具 ============================== */

function reject(
  code: ConflictCompletionRejectionCode,
  message: string,
): ConflictCompletionRejection {
  return { ok: false, code, message };
}

function isTokenExpired(issuedAt: number | undefined, now: number): boolean {
  if (issuedAt === undefined) return true;
  return now - issuedAt > CONFLICT_COMPLETION_TOKEN_TTL_MS;
}

function hasValidToken(state: ConflictCompletionState, now: number): boolean {
  if (
    !state.previewToken ||
    !state.editToken ||
    state.tokenIssuedAt === undefined
  )
    return false;
  return !isTokenExpired(state.tokenIssuedAt, now);
}

/* ============================== derivePhase ============================== */

export interface DerivePhaseInput {
  /** 是否有草稿（draftHash 与 workingHash 区分） */
  draftHash: ContentHash;
  workingHash: ContentHash;
  baseHash: ContentHash;
  diskHash: ContentHash;
  /** 草稿版本 */
  draftRevision: number;
  /** 脏标记 */
  hasUnsavedEdit?: boolean;
  /** 是否已做 checkpoint */
  hasCheckpoint?: boolean;
  /** 是否已生成保存预览 */
  hasSavePreview?: boolean;
  /** preview/edit token 有效性 */
  previewToken?: string;
  editToken?: string;
  tokenIssuedAt?: number;
  now?: number;
  /** 是否已保存到工作副本（draftHash === diskHash） */
  isSavedToWorkingCopy?: boolean;
  /** 核验结果 */
  verificationResult?: "pass" | "blocked" | "pending";
  verificationIssues?: string[];
  /** 是否已生成解决预览 */
  hasResolvePreview?: boolean;
  /** 是否已 resolve */
  isResolved?: boolean;
  /** 是否还有下一个冲突 */
  hasNextConflict?: boolean;
  /** 冲突种类 */
  conflictKind?: ConflictKind;
  /** 当前是否已 resolve 阶段之后 */
  phaseHint?: ConflictCompletionPhase;
}

export function derivePhase(input: DerivePhaseInput): ConflictCompletionPhase {
  const kind: ConflictKind = input.conflictKind ?? "text";
  const nonText = isNonText(kind);
  const now = input.now ?? Date.now();
  const tokenValid =
    !!input.previewToken &&
    !!input.editToken &&
    input.tokenIssuedAt !== undefined &&
    !isTokenExpired(input.tokenIssuedAt, now);

  // 终态优先
  if (input.isResolved) {
    if (input.hasNextConflict === true) return "next-conflict";
    if (input.hasNextConflict === false) return "all-resolved";
    return "resolved";
  }
  // 已生成解决预览 → resolve-ready（非文本也允许）
  if (input.hasResolvePreview && tokenValid) {
    // 文本分支要求 verification-pass 才可 resolve-ready；非文本允许 working-saved 直达
    if (nonText) return "resolve-ready";
    if (input.verificationResult === "pass") return "resolve-ready";
    // 文本但未通过核验，不应进入 resolve-ready
    if (input.verificationResult === "blocked") return "verification-blocked";
  }
  // 核验结果
  if (input.verificationResult === "blocked") return "verification-blocked";
  if (input.verificationResult === "pass") {
    if (nonText) {
      // 非文本不与文本 verification-pass 混用，走独立 blocked 分支或保持 working-saved
      return "verification-blocked";
    }
    return "verification-pass";
  }
  // 已保存到工作副本
  if (input.isSavedToWorkingCopy) return "working-saved";
  // 保存预览就绪
  if (input.hasSavePreview && tokenValid) return "save-ready";
  // checkpoint
  if (input.hasCheckpoint) return "draft-checkpointed";
  // 脏草稿
  if (input.hasUnsavedEdit) return "draft-dirty";
  // hash 区分
  if (input.draftHash !== input.workingHash) return "draft-dirty";
  return "draft-clean";
}

/* ============================== canTransition ============================== */

const ALLOWED: Record<ConflictCompletionPhase, ConflictCompletionPhase[]> = {
  "draft-clean": ["draft-dirty"],
  "draft-dirty": ["draft-checkpointed", "save-ready"],
  "draft-checkpointed": ["draft-dirty", "save-ready"],
  "save-ready": ["working-saved", "draft-dirty"],
  "working-saved": [
    "verification-pass",
    "verification-blocked",
    "draft-dirty",
    "resolve-ready",
  ],
  "verification-pass": ["resolve-ready", "draft-dirty"],
  "verification-blocked": ["draft-dirty"],
  "resolve-ready": ["resolved", "draft-dirty"],
  resolved: ["next-conflict", "all-resolved"],
  "next-conflict": [],
  "all-resolved": [],
};

export function canTransition(
  from: ConflictCompletionPhase,
  to: ConflictCompletionPhase,
): boolean {
  const allowed = ALLOWED[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/* ============================== transition ============================== */

export function transition(
  state: ConflictCompletionState,
  event: ConflictCompletionEvent,
  now: number = Date.now(),
): ConflictCompletionResult {
  // 非文本分支隔离：文本 verification-pass 仅文本可用
  const nonText = state.nonTextBranch;

  switch (event.type) {
    case "edit": {
      if (
        state.phase === "resolved" ||
        state.phase === "next-conflict" ||
        state.phase === "all-resolved"
      ) {
        return reject("invalid-transition", `阶段 ${state.phase} 不允许编辑`);
      }
      // 编辑后 draftRevision 单调递增，草稿保留
      const nextDraftHash = event.draftHash ?? state.draftHash;
      const next = buildState({
        ...state,
        phase: "draft-dirty",
        draftRevision: state.draftRevision + 1,
        draftHash: nextDraftHash,
        previewToken: undefined,
        editToken: undefined,
        tokenIssuedAt: undefined,
        verificationIssues: [],
      });
      return { ok: true, state: next };
    }
    case "checkpointed": {
      if (state.phase !== "draft-dirty") {
        return reject(
          "phase-mismatch",
          `仅 draft-dirty 可 checkpoint，当前 ${state.phase}`,
        );
      }
      const next = buildState({
        ...state,
        phase: "draft-checkpointed",
      });
      return { ok: true, state: next };
    }
    case "saveRequested": {
      if (
        state.phase !== "draft-dirty" &&
        state.phase !== "draft-checkpointed"
      ) {
        return reject(
          "phase-mismatch",
          `仅 draft-dirty/checkpointed 可请求保存，当前 ${state.phase}`,
        );
      }
      if (
        !event.previewToken ||
        !event.editToken ||
        event.tokenIssuedAt === undefined
      ) {
        return reject("token-invalid", "保存预览令牌缺失");
      }
      if (isTokenExpired(event.tokenIssuedAt, now)) {
        return reject("token-expired", "保存令牌已过期");
      }
      const next = buildState({
        ...state,
        phase: "save-ready",
        previewToken: event.previewToken,
        editToken: event.editToken,
        tokenIssuedAt: event.tokenIssuedAt,
      });
      return { ok: true, state: next };
    }
    case "saved": {
      if (state.phase !== "save-ready") {
        return reject(
          "phase-mismatch",
          `仅 save-ready 可执行保存，当前 ${state.phase}`,
        );
      }
      if (!hasValidToken(state, now)) {
        return reject("token-expired", "保存令牌已过期或缺失，拒绝写入");
      }
      // 原子写入 + authoritative reload：diskHash 与 workingHash 同步为 draftHash，单次消耗 token
      const next = buildState({
        ...state,
        phase: "working-saved",
        workingHash: state.draftHash,
        diskHash: state.draftHash,
        previewToken: undefined,
        editToken: undefined,
        tokenIssuedAt: undefined,
      });
      return { ok: true, state: next };
    }
    case "verificationRun": {
      const expectedFrom = "working-saved";
      // 非文本也可从 working-saved 发起核验，但结果分支不同
      if (state.phase !== expectedFrom) {
        // 允许 verification-pass 阶段重复核验？按图仅 working-saved 触发
        return reject(
          "phase-mismatch",
          `仅 ${expectedFrom} 可执行核验，当前 ${state.phase}`,
        );
      }
      if (event.result === "pass" && nonText) {
        return reject(
          "non-text-branch-violation",
          "非文本冲突不能进入 verification-pass，需走独立分支",
        );
      }
      if (event.result === "pass") {
        const next = buildState({
          ...state,
          phase: "verification-pass",
          verificationIssues: [],
        });
        return { ok: true, state: next };
      } else {
        const next = buildState({
          ...state,
          phase: "verification-blocked",
          verificationIssues: event.issues ?? ["核验发现问题"],
        });
        return { ok: true, state: next };
      }
    }
    case "previewRefreshed": {
      if (!event.previewToken || event.tokenIssuedAt === undefined) {
        return reject("token-invalid", "解决预览令牌缺失");
      }
      if (isTokenExpired(event.tokenIssuedAt, now)) {
        return reject("token-expired", "解决预览令牌已过期");
      }
      // 文本分支：仅 verification-pass 可生成 resolve 预览；非文本：允许 working-saved 直达
      if (nonText) {
        if (
          state.phase !== "working-saved" &&
          state.phase !== "verification-blocked"
        ) {
          return reject(
            "phase-mismatch",
            `非文本分支仅 working-saved 可生成解决预览，当前 ${state.phase}`,
          );
        }
      } else {
        if (state.phase !== "verification-pass") {
          return reject(
            "phase-mismatch",
            `仅 verification-pass 可生成解决预览，当前 ${state.phase}`,
          );
        }
      }
      const next = buildState({
        ...state,
        phase: "resolve-ready",
        previewToken: event.previewToken,
        tokenIssuedAt: event.tokenIssuedAt,
        editToken: state.editToken ?? event.previewToken,
      });
      return { ok: true, state: next };
    }
    case "resolved": {
      // 双重语义：resolve-ready -> resolved；resolved -> next/all
      if (state.phase === "resolve-ready") {
        if (!hasValidToken(state, now)) {
          return reject("token-expired", "解决令牌已过期或缺失，拒绝标记解决");
        }
        const next = buildState({
          ...state,
          phase: "resolved",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
        return { ok: true, state: next };
      }
      if (state.phase === "resolved") {
        if (event.hasNextConflict === true) {
          const next = buildState({ ...state, phase: "next-conflict" });
          return { ok: true, state: next };
        }
        if (event.hasNextConflict === false) {
          const next = buildState({ ...state, phase: "all-resolved" });
          return { ok: true, state: next };
        }
        return reject(
          "invalid-transition",
          "resolved 阶段需指明 hasNextConflict 才能进入下一阶段",
        );
      }
      return reject(
        "phase-mismatch",
        `仅 resolve-ready/resolved 可执行 resolved 事件，当前 ${state.phase}`,
      );
    }
    case "invalidation": {
      // 委托给 invalidate 纯函数
      const next = invalidate(state, event.change, now);
      return { ok: true, state: next };
    }
    default:
      return reject(
        "invalid-input",
        `未知事件类型 ${(event as unknown as { type: string }).type}`,
      );
  }
}

/* ============================== invalidate（失效传播） ============================== */

export function invalidate(
  state: ConflictCompletionState,
  change: InvalidationChange,
  now: number = Date.now(),
): ConflictCompletionState {
  const kind = change.kind;
  // 任一变化 → 对应 preview/token 失效并回到可恢复状态（草稿保留不丢）
  switch (kind) {
    case "scopeChanged":
    case "revisionChanged":
    case "repoChanged":
    case "fileMoved": {
      // 身份级变化：所有 preview/token 失效，回到 draft-dirty（草稿保留）
      if (
        state.phase === "save-ready" ||
        state.phase === "resolve-ready" ||
        state.phase === "working-saved" ||
        state.phase === "verification-pass" ||
        state.phase === "verification-blocked"
      ) {
        return buildState({
          ...state,
          phase: "draft-dirty",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
          verificationIssues: [],
        });
      }
      return buildState({
        ...state,
        previewToken: undefined,
        editToken: undefined,
        tokenIssuedAt: undefined,
        verificationIssues: state.verificationIssues,
        // 已是 draft 阶段则保持
        phase:
          state.phase === "draft-checkpointed" ? "draft-dirty" : state.phase,
      });
    }
    case "diskChanged": {
      // 磁盘变化：working-saved/verification 失效，回到 draft-dirty
      if (
        state.phase === "working-saved" ||
        state.phase === "verification-pass" ||
        state.phase === "verification-blocked" ||
        state.phase === "save-ready" ||
        state.phase === "resolve-ready"
      ) {
        return buildState({
          ...state,
          phase: "draft-dirty",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
          verificationIssues: [],
        });
      }
      return { ...state };
    }
    case "baseChanged": {
      // BASE 变化：核验与解决预览失效
      if (
        state.phase === "verification-pass" ||
        state.phase === "verification-blocked" ||
        state.phase === "resolve-ready" ||
        state.phase === "working-saved"
      ) {
        return buildState({
          ...state,
          phase: "draft-dirty",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
          verificationIssues: [],
        });
      }
      if (state.phase === "save-ready") {
        return buildState({
          ...state,
          phase: "draft-checkpointed",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
      }
      return { ...state };
    }
    case "tokenExpired": {
      const expired = isTokenExpired(state.tokenIssuedAt, now);
      if (!expired) return { ...state };
      if (state.phase === "save-ready") {
        return buildState({
          ...state,
          phase: "draft-checkpointed",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
      }
      if (state.phase === "resolve-ready") {
        // 回到 verification-pass（文本）或 working-saved（非文本），保留草稿
        const fallback: ConflictCompletionPhase = state.nonTextBranch
          ? "working-saved"
          : "verification-pass";
        return buildState({
          ...state,
          phase: fallback,
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
      }
      return buildState({
        ...state,
        previewToken: undefined,
        editToken: undefined,
        tokenIssuedAt: undefined,
      });
    }
    case "previewStale": {
      // 草稿变化导致预览过期
      if (state.phase === "save-ready") {
        return buildState({
          ...state,
          phase: "draft-dirty",
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
      }
      if (state.phase === "resolve-ready") {
        const fallback: ConflictCompletionPhase = state.nonTextBranch
          ? "working-saved"
          : "verification-pass";
        return buildState({
          ...state,
          phase: fallback,
          previewToken: undefined,
          editToken: undefined,
          tokenIssuedAt: undefined,
        });
      }
      return buildState({
        ...state,
        previewToken: undefined,
        editToken: undefined,
        tokenIssuedAt: undefined,
      });
    }
    default:
      return { ...state };
  }
}

/* ============================== 工厂：创建初始状态 ============================== */

export interface CreateConflictCompletionStateInput {
  fileIdentity: ConflictFileIdentity;
  conflictKind?: ConflictKind;
  scopeHash: string;
  workingCopyRevision: string;
  repositoryUuid: string;
  draftRevision?: number;
  workingHash: ContentHash;
  draftHash: ContentHash;
  baseHash: ContentHash;
  diskHash: ContentHash;
}

export function createConflictCompletionState(
  input: CreateConflictCompletionStateInput,
): ConflictCompletionState {
  const kind = input.conflictKind ?? "text";
  const phase: ConflictCompletionPhase =
    input.draftHash !== input.workingHash ? "draft-dirty" : "draft-clean";
  return buildState({
    fileIdentity: input.fileIdentity,
    conflictKind: kind,
    scopeHash: input.scopeHash,
    workingCopyRevision: input.workingCopyRevision,
    repositoryUuid: input.repositoryUuid,
    draftRevision: input.draftRevision ?? 0,
    workingHash: input.workingHash,
    draftHash: input.draftHash,
    baseHash: input.baseHash,
    diskHash: input.diskHash,
    previewToken: undefined,
    editToken: undefined,
    tokenIssuedAt: undefined,
    phase,
  });
}

/* ============================== deriveStepView（ConflictStepBar 数据） ============================== */

export type StepState = "done" | "current" | "blocked" | "pending";

export interface ConflictStepViewItem {
  /** 序号 1-4 */
  index: number;
  /** 阶段 key */
  key: string;
  /** 图标名（不依赖颜色） */
  icon: string;
  /** 中文主文案 */
  label: string;
  /** 中文副文案 */
  description: string;
  /** 状态：已完成/当前/阻止/待处理（不只靠颜色） */
  state: StepState;
}

export interface ConflictStepView {
  steps: ConflictStepViewItem[];
  currentPhase: ConflictCompletionPhase;
  nonTextBranch: boolean;
}

/**
 * 为 ConflictStepBar 输出四阶段数据：
 * 1 检查点已保存（内存） 2 已保存工作副本 3 已通过核验 4 已标记解决
 * 每个项含序号+图标名+中文文案+副文案+当前/已完成/阻止，不只靠颜色。
 */
export function deriveStepView(
  state: ConflictCompletionState,
): ConflictStepView {
  // 阶段顺序权重，用于判定 done/current/pending
  const rank: Record<string, number> = {
    "draft-clean": 0,
    "draft-dirty": 0,
    "draft-checkpointed": 1,
    "save-ready": 1,
    "working-saved": 2,
    "verification-pass": 3,
    "verification-blocked": 2.5,
    "resolve-ready": 3.5,
    resolved: 4,
    "next-conflict": 4,
    "all-resolved": 4,
  };
  const currentRank = rank[state.phase] ?? 0;
  const isBlocked = state.phase === "verification-blocked";

  const defs: {
    key: string;
    phase: ConflictCompletionPhase;
    icon: string;
    label: string;
    description: string;
  }[] = [
    {
      key: "checkpoint",
      phase: "draft-checkpointed",
      icon: "save",
      label: "检查点已保存",
      description: "草稿已保存至内存",
    },
    {
      key: "working",
      phase: "working-saved",
      icon: "desktop-download",
      label: "已保存工作副本",
      description: "已写入工作副本并重新加载",
    },
    {
      key: "verification",
      phase: "verification-pass",
      icon: "check-all",
      label: state.nonTextBranch ? "核验（非文本分支）" : "已通过核验",
      description: state.nonTextBranch
        ? "非文本走独立分支，不混用文本核验"
        : "确定性核验已通过",
    },
    {
      key: "resolved",
      phase: "resolved",
      icon: "pass",
      label: "已标记解决",
      description: "已执行 svn resolve",
    },
  ];

  const steps: ConflictStepViewItem[] = defs.map((def, idx) => {
    const stepRank = idx + 1;
    let stepState: StepState;
    if (isBlocked && def.phase === "verification-pass") {
      stepState = "blocked";
    } else if (currentRank > stepRank || (currentRank === 4 && stepRank <= 4)) {
      // 已完成：当前阶段已超越该步骤
      if (
        state.phase === "resolved" ||
        state.phase === "next-conflict" ||
        state.phase === "all-resolved"
      ) {
        stepState = "done";
      } else if (currentRank > stepRank) {
        stepState = "done";
      } else if (currentRank === stepRank) {
        stepState = "current";
      } else {
        stepState = "pending";
      }
    } else if (currentRank === stepRank) {
      stepState = "current";
    } else {
      stepState = "pending";
    }
    // 精确覆盖：rank 2.5 blocked 场景，verification 步骤 blocked，其后 pending
    if (isBlocked) {
      if (def.key === "verification") stepState = "blocked";
      if (def.key === "resolved") stepState = "pending";
    }
    // draft-clean/dirty 时 checkpoint 前均为 pending
    if (currentRank === 0) stepState = idx === 0 ? "current" : "pending";
    // save-ready 视为 checkpoint 已 done，working 当前
    if (state.phase === "save-ready") {
      if (def.key === "checkpoint") stepState = "done";
      if (def.key === "working") stepState = "current";
    }
    // resolve-ready 视为 verification 已 done，resolved 当前
    if (state.phase === "resolve-ready") {
      if (def.key === "verification") stepState = "done";
      if (def.key === "working") stepState = "done";
      if (def.key === "checkpoint") stepState = "done";
      if (def.key === "resolved") stepState = "current";
    }
    return {
      index: idx + 1,
      key: def.key,
      icon: def.icon,
      label: def.label,
      description: def.description,
      state: stepState,
    };
  });

  return {
    steps,
    currentPhase: state.phase,
    nonTextBranch: state.nonTextBranch,
  };
}
