import type { PathIdentityKey } from "../../scope/pathBrands";
import type { PathSemantics } from "../../scope/pathIdentity";
import { isSameOrDescendantPath } from "../../scope/pathIdentity";
import type {
  WorkbenchModuleId,
  WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";
import type { WorkbenchSession } from "./workbenchSession";

/**
 * v0.1.4 V014-A：连续任务上下文纯模型（Changes → Diff → Commit）。
 *
 * 本文件是纯逻辑层：不依赖 vscode API、不触碰控制器与 Webview 流程，
 * 只描述“从哪个模块/任务/范围来、选中了什么、看到哪、草稿是什么、
 * 从 Diff 回到哪里、上下文是否过期”。接线（Host 读写、Webview 恢复）
 * 属于后续 V014-C/E，本文件不得直接读写会话单例或发送消息。
 *
 * 安全语义（与 v0.1.4 规划 §3 对齐）：
 * - 路由只能保持或缩小 scope，禁止扩大；
 * - blocked/external/跨仓库/冲突一律 fail-closed（剔除并给出原因）；
 * - Webview 不生成 identity：key 一律是 PathIdentityKey 语义，
 *   由 Host 侧经 normalizePathIdentity 生成后传入；
 * - AI 与本任务无关，本文件不引用任何模型结果。
 */

/** 上下文初始版本：createContinuityContext 固定签发 1。 */
export const TASK_CONTINUITY_INITIAL_VERSION = 1 as const;

/** Changes 列表视图偏好快照（只记界面偏好，不记可写操作身份）。 */
export interface ContinuityChangesView {
  /** 筛选文本或筛选预设名（界面偏好，Host 不据此校验范围）。 */
  filter?: string;
  /** 排序字段（与 Webview listPreferences 对齐，纯展示）。 */
  sortField?: string;
  /** 排序方向（纯展示）。 */
  sortDirection?: "asc" | "desc";
  /** 列表密度（纯展示）。 */
  density?: "comfortable" | "compact";
  /** 是否只看已选项（纯展示，不改变真实操作范围）。 */
  onlySelected?: boolean;
}

/**
 * 提交草稿引用（只引用，不复制 CommitSessionState 全部）。
 * message 是用户已填草稿原文；draftRevision 是 Host 侧草稿版本号，
 * 每次用户编辑/采用建议/套用模板后递增，用于脏草稿守卫判定。
 */
export interface ContinuityCommitDraftRef {
  message: string;
  draftRevision: number;
}

/** Diff 目标与返回动作：看完 Diff 后回到哪个模块继续任务。 */
export interface ContinuityDiffTarget {
  /** Diff 目标摘要（targetFile 或修订比较的 Host 侧标识）。 */
  targetKey: string;
  /** 返回动作：默认回到本地修改，Commit 交接阶段可回到提交。 */
  returnAction: "back-to-changes" | "back-to-commit" | "close";
}

/**
 * 连续任务上下文：记录在既有 Host session 之上的跨模块任务状态。
 * 字段全部可 JSON 序列化；key 语义为 PathIdentityKey（由 Host 生成）。
 */
export interface TaskContinuityContext {
  /** 来源模块（如 changes）。 */
  originModule: WorkbenchModuleId;
  /** 来源任务（如 changes/overview）。 */
  originTask: WorkbenchTaskId;
  /** 来源操作范围哈希（hashOperationScope，与 session.scopeHash 同源）。 */
  originScopeHash: string;
  /** 来源会话 id：延迟快照携带旧 id 时必须判定 stale 并忽略。 */
  originSessionId: string;
  /** 来源仓库根（绝对路径原文，用于收缩判定，不展示 identity 键）。 */
  originRepositoryRoot: string;
  /** 来源仓库 UUID：目标仓库不一致即跨仓库拒绝。 */
  originRepositoryUuid: string;
  /** 来源范围根路径原文集合（收缩判定的“允许上限”）。 */
  originRoots: string[];
  /** 已选中的身份键集合（顺序保留进入时的选择顺序）。 */
  selectedKeys: PathIdentityKey[];
  /** 权威 path 映射：key → 绝对路径原文（展示与恢复用原文，不用键）。 */
  pathByKey: Record<string, string>;
  /** 当前活动文件（焦点行/活动行对应的身份键）。 */
  activeFileKey?: PathIdentityKey;
  /** Changes 列表视图偏好（filter/sort/density/only-selected）。 */
  changesView: ContinuityChangesView;
  /**
   * 滚动锚点：身份键锚，恢复时优先定位该文件所在行；
   * 禁止把绝对像素作为唯一恢复依据。
   */
  scrollAnchorKey?: PathIdentityKey;
  /** 像素辅助值：仅在锚点失效时做就近钳制，不得单独决定位置。 */
  scrollAssistPixels?: number;
  /** 当前提交草稿引用（message + draftRevision）。 */
  commitDraft: ContinuityCommitDraftRef;
  /** Diff 目标与返回动作（仅经由 Diff 时设置）。 */
  diffTarget?: ContinuityDiffTarget;
  /** 上下文版本：创建为 1，每次迁移/失效后递增。 */
  contextVersion: number;
  /** 失效原因：未失效时缺省；失效后记录中文原因。 */
  invalidatedReason?: string;
}

/** createContinuityContext 的可选输入（Host 侧权威值）。 */
export interface CreateContinuityOptions {
  /**
   * 身份键解析器：Host 侧用 normalizePathIdentity 实现。
   * 缺省为原文直转（仅测试/无语义环境使用，生产必须传入）。
   */
  resolveKey?: (absolutePath: string) => PathIdentityKey;
  /** Changes 视图偏好（Webview 侧 listPreferences 的只读投影）。 */
  changesView?: ContinuityChangesView;
  /** 提交草稿版本号（Host 侧维护，缺省 0 表示无版本追踪）。 */
  draftRevision?: number;
  /** Diff 返回动作（缺省 back-to-changes）。 */
  diffReturnAction?: ContinuityDiffTarget["returnAction"];
  /** 滚动像素辅助值（仅辅助，缺省不记录）。 */
  scrollAssistPixels?: number;
}

/**
 * a) 从 WorkbenchSession 派生初始上下文。
 * 选择来源：session.selectedPaths 优先，其次 commitState.selectedPaths；
 * 活动文件：session.targetFile；滚动锚默认等于活动文件。
 */
export function createContinuityContext(
  session: WorkbenchSession,
  options: CreateContinuityOptions = {},
): TaskContinuityContext {
  const resolveKey =
    options.resolveKey ?? ((value: string) => value as PathIdentityKey);
  const selectedPaths =
    session.selectedPaths ?? session.commitState?.selectedPaths ?? [];
  const selectedKeys: PathIdentityKey[] = [];
  const pathByKey: Record<string, string> = {};
  for (const absolutePath of selectedPaths) {
    const key = resolveKey(absolutePath);
    if (!selectedKeys.includes(key)) {
      selectedKeys.push(key);
    }
    pathByKey[key as string] = absolutePath;
  }
  const activeFileKey = session.targetFile
    ? resolveKey(session.targetFile)
    : undefined;
  if (session.targetFile && activeFileKey) {
    pathByKey[activeFileKey as string] ??= session.targetFile;
  }
  const diffTarget = session.targetFile
    ? {
        targetKey: activeFileKey as string,
        returnAction: options.diffReturnAction ?? "back-to-changes",
      }
    : session.revisionCompare
      ? {
          targetKey: [...session.revisionCompare.revisions].sort().join("..."),
          returnAction: options.diffReturnAction ?? "back-to-changes",
        }
      : undefined;
  return {
    originModule: session.moduleId,
    originTask: session.taskId,
    originScopeHash: session.scopeHash,
    originSessionId: session.sessionId,
    originRepositoryRoot: session.scope.repositoryRoot,
    originRepositoryUuid: session.repositoryUuid,
    originRoots: session.scope.roots.map((root) => root.absolutePath),
    selectedKeys,
    pathByKey,
    activeFileKey,
    changesView: { ...(options.changesView ?? {}) },
    scrollAnchorKey: activeFileKey,
    ...(options.scrollAssistPixels !== undefined
      ? { scrollAssistPixels: options.scrollAssistPixels }
      : {}),
    commitDraft: {
      message: session.commitState?.message ?? "",
      draftRevision: options.draftRevision ?? 0,
    },
    ...(diffTarget ? { diffTarget } : {}),
    contextVersion: TASK_CONTINUITY_INITIAL_VERSION,
  };
}

/** 路由目标（Host 侧新会话的权威范围摘要）。 */
export interface ContinuityNavigateTarget {
  moduleId: WorkbenchModuleId;
  taskId: WorkbenchTaskId;
  scopeHash: string;
  repositoryRoot: string;
  repositoryUuid: string;
  roots: string[];
}

export type ReduceOnNavigateResult =
  | {
      ok: true;
      /** 迁移后的上下文（模块/任务/范围已更新，版本 +1）。 */
      context: TaskContinuityContext;
      /** 目标范围是否为来源范围的真子集（收缩成功）。 */
      shrunk: boolean;
    }
  | {
      ok: false;
      /** 拒绝原因：跨仓库或范围扩大（中文）。 */
      reason: string;
      /** 拒绝码（测试与 Host 分支用，稳定英文）。 */
      code: "cross-repository" | "scope-expand-rejected";
    };

/**
 * b) 路由离开/进入时迁移上下文。
 * 规则：仓库 UUID 不一致即跨仓库拒绝；目标任一根不在来源根之内
 * （非相等、非后代）即范围扩大拒绝；相等或真子集则迁移成功，
 * 真子集额外标记 shrunk（收缩成功语义）。
 */
export function reduceOnNavigate(
  context: TaskContinuityContext,
  target: ContinuityNavigateTarget,
  semantics: PathSemantics,
): ReduceOnNavigateResult {
  if (target.repositoryUuid !== context.originRepositoryUuid) {
    return {
      ok: false,
      reason: "目标仓库与来源仓库不一致，已拒绝跨仓库迁移上下文。",
      code: "cross-repository",
    };
  }
  const insideSource = (candidate: string): boolean =>
    context.originRoots.some((root) =>
      isSameOrDescendantPath(candidate, root, semantics),
    );
  if (!target.roots.every(insideSource)) {
    return {
      ok: false,
      reason: "目标范围超出来源范围，只允许保持或缩小，不允许扩大。",
      code: "scope-expand-rejected",
    };
  }
  const normalize = (values: string[]): string[] =>
    values.map((value) =>
      semantics.platform === "win32" ? value.toLowerCase() : value,
    );
  const sourceSet = new Set(normalize(context.originRoots));
  const shrunk =
    target.roots.length < context.originRoots.length ||
    target.roots.some((root) => !sourceSet.has(normalize([root])[0]));
  return {
    ok: true,
    shrunk,
    context: {
      ...context,
      originModule: target.moduleId,
      originTask: target.taskId,
      originScopeHash: target.scopeHash,
      originRepositoryRoot: target.repositoryRoot,
      originRoots: [...target.roots],
      contextVersion: context.contextVersion + 1,
      invalidatedReason: undefined,
    },
  };
}

/** 最新候选快照中的单项（Host 侧权威采集的合法性投影）。 */
export interface ContinuitySnapshotEntry {
  key: PathIdentityKey;
  /** 绝对路径原文（用于移除播报与恢复展示）。 */
  path: string;
  /** 条目所属仓库 UUID：与上下文不一致即跨仓库剔除。 */
  repositoryUuid: string;
  /** 本地阻止项（conflicted/blocked/obstructed 等，不可覆盖）。 */
  blocked?: boolean;
  /** 外部引用（includeExternals=false 时默认剔除）。 */
  external?: boolean;
}

/** 逐项移除原因码（稳定英文，展示层另配中文文案）。 */
export type ContinuityRemovalReason =
  "disappeared" | "blocked" | "cross-repository" | "external";

export interface ContinuityRemovedEntry {
  key: PathIdentityKey;
  path: string;
  reason: ContinuityRemovalReason;
  /** 中文移除原因（直接可播报）。 */
  message: string;
}

export interface RestoreAgainstSnapshotResult {
  /** 保留的合法交集（保持原选择顺序）。 */
  keptKeys: PathIdentityKey[];
  /** 逐项移除清单（含原因，调用方负责播报）。 */
  removedEntries: ContinuityRemovedEntry[];
  /** 快照是否过期（旧 sessionId）：过期时调用方必须忽略本次结果。 */
  stale: boolean;
}

function removalMessage(reason: ContinuityRemovalReason): string {
  switch (reason) {
    case "disappeared":
      return "文件已不在最新快照中，可能已被删除、移走或状态变化，已从选择中移除。";
    case "blocked":
      return "文件处于不可提交的阻止状态（冲突或校验未通过），已从选择中移除。";
    case "cross-repository":
      return "文件属于其他仓库，不能与当前仓库合并操作，已从选择中移除。";
    case "external":
      return "文件是外部引用，当前范围不包含外部引用，已从选择中移除。";
  }
}

/**
 * c) 返回时按最新候选快照计算合法交集。
 * 语义：只保留“过去已选 ∩ 现在合法”；消失/blocked/跨仓库/external
 * 逐项剔除并给出原因；快照中新出现的文件绝不因过去“全选/曾选择”
 * 自动加入（本函数只输出交集，从不并入快照独有项）。
 */
export function restoreAgainstSnapshot(
  context: TaskContinuityContext,
  snapshot: {
    entries: ContinuitySnapshotEntry[];
    sessionId: string;
    includeExternals?: boolean;
  },
): RestoreAgainstSnapshotResult {
  if (isStaleSnapshot(snapshot.sessionId, context.originSessionId)) {
    return { keptKeys: [], removedEntries: [], stale: true };
  }
  const byKey = new Map<string, ContinuitySnapshotEntry>();
  for (const entry of snapshot.entries) {
    byKey.set(entry.key as string, entry);
  }
  const keptKeys: PathIdentityKey[] = [];
  const removedEntries: ContinuityRemovedEntry[] = [];
  const remove = (
    key: PathIdentityKey,
    path: string,
    reason: ContinuityRemovalReason,
  ): void => {
    removedEntries.push({ key, path, reason, message: removalMessage(reason) });
  };
  for (const key of context.selectedKeys) {
    const entry = byKey.get(key as string);
    if (!entry) {
      remove(
        key,
        context.pathByKey[key as string] ?? (key as string),
        "disappeared",
      );
      continue;
    }
    if (entry.repositoryUuid !== context.originRepositoryUuid) {
      remove(key, entry.path, "cross-repository");
      continue;
    }
    if (entry.blocked) {
      remove(key, entry.path, "blocked");
      continue;
    }
    if (entry.external && !snapshot.includeExternals) {
      remove(key, entry.path, "external");
      continue;
    }
    keptKeys.push(key);
  }
  return { keptKeys, removedEntries, stale: false };
}

export interface ActiveFileFallbackResult {
  /** 回退后的活动文件；无任何合法项时缺省。 */
  fallbackKey?: PathIdentityKey;
  /** 原活动文件是否已变化（消失或非法）。 */
  changed: boolean;
  /** 变化时的中文播报（未变化时缺省）。 */
  notice?: string;
}

/**
 * d) 活动文件回退：目标消失时恢复最近合法邻项。
 * 邻项定义：在调用方给定的展示顺序中与原位置最近的合法项
 * （优先后一项，再前一项）；变化时必须标注“原文件状态已变化”。
 */
export function resolveActiveFileFallback(
  activeKey: PathIdentityKey | undefined,
  orderedKeys: readonly PathIdentityKey[],
  isLegal: (key: PathIdentityKey) => boolean,
): ActiveFileFallbackResult {
  if (activeKey && orderedKeys.includes(activeKey) && isLegal(activeKey)) {
    return { fallbackKey: activeKey, changed: false };
  }
  if (!activeKey) {
    const first = orderedKeys.find((key) => isLegal(key));
    return first
      ? {
          fallbackKey: first,
          changed: true,
          notice: "原文件状态已变化，已定位到最近的合法文件。",
        }
      : {
          changed: true,
          notice: "原文件状态已变化，当前没有可定位的合法文件。",
        };
  }
  const anchorIndex = orderedKeys.indexOf(activeKey);
  const candidates: PathIdentityKey[] = [];
  if (anchorIndex >= 0) {
    for (let offset = 1; offset < orderedKeys.length; offset += 1) {
      const after = orderedKeys[anchorIndex + offset];
      const before = orderedKeys[anchorIndex - offset];
      if (after) candidates.push(after);
      if (before) candidates.push(before);
    }
  } else {
    candidates.push(...orderedKeys);
  }
  const fallback = candidates.find((key) => isLegal(key));
  return fallback
    ? {
        fallbackKey: fallback,
        changed: true,
        notice: "原文件状态已变化，已定位到最近的合法文件。",
      }
    : { changed: true, notice: "原文件状态已变化，当前没有可定位的合法文件。" };
}

/** 失效事件（调用方：Host 会话生命周期；本函数只做纯判定）。 */
export type ContinuityInvalidateEvent =
  | "filter-change"
  | "selection-change"
  | "project-switch"
  | "window-close"
  | "snapshot-expired";

/**
 * e) 失效规则：任何事件都递增 contextVersion 并记录中文原因；
 * 项目切换/窗口关闭/快照过期属于强失效，额外清空选择、活动文件
 * 与滚动锚（旧上下文不得再用于恢复）；筛选/选择变化属于弱失效，
 * 只标记原因，保留选择供调用方重新计算交集。
 */
export function invalidateContinuity(
  context: TaskContinuityContext,
  event: ContinuityInvalidateEvent,
): TaskContinuityContext {
  const messages: Record<ContinuityInvalidateEvent, string> = {
    "filter-change": "筛选条件已变化，旧选择与滚动位置待按最新快照复核。",
    "selection-change": "选择已变化，旧交集结果已失效，请按最新快照重新计算。",
    "project-switch":
      "已切换项目，旧任务上下文已失效，不再恢复旧选择与草稿定位。",
    "window-close": "窗口已关闭，旧任务上下文已失效。",
    "snapshot-expired": "快照已过期，旧任务上下文已失效，请重新采集后再恢复。",
  };
  const strong =
    event === "project-switch" ||
    event === "window-close" ||
    event === "snapshot-expired";
  return {
    ...context,
    selectedKeys: strong ? [] : [...context.selectedKeys],
    activeFileKey: strong ? undefined : context.activeFileKey,
    scrollAnchorKey: strong ? undefined : context.scrollAnchorKey,
    contextVersion: context.contextVersion + 1,
    invalidatedReason: messages[event],
  };
}

/**
 * f) 延迟快照过期判定：携带旧 sessionId 的快照一律判定为 stale，
 * 调用方必须忽略，不得覆盖新上下文。
 */
export function isStaleSnapshot(
  snapshotSessionId: string,
  currentSessionId: string,
): boolean {
  return snapshotSessionId !== currentSessionId;
}

export interface ScrollAnchorResult {
  /** 恢复目标身份键；列表为空时缺省。 */
  targetKey?: PathIdentityKey;
  /** 恢复目标在展示顺序中的下标；列表为空时为 -1。 */
  targetIndex: number;
  /** 是否动用了像素辅助（锚点命中时恒为 false）。 */
  usedPixelFallback: boolean;
}

/**
 * g) 滚动恢复：以 scrollAnchorKey 为主；锚点命中直接定位，
 * 锚点失效时把像素辅助值钳制到合法下标区间（仅辅助，不单独定位）。
 */
export function resolveScrollAnchor(
  anchorKey: PathIdentityKey | undefined,
  orderedKeys: readonly PathIdentityKey[],
  assistPixels?: number,
): ScrollAnchorResult {
  if (orderedKeys.length === 0) {
    return { targetIndex: -1, usedPixelFallback: false };
  }
  if (anchorKey) {
    const index = orderedKeys.indexOf(anchorKey);
    if (index >= 0) {
      return {
        targetKey: anchorKey,
        targetIndex: index,
        usedPixelFallback: false,
      };
    }
  }
  if (assistPixels !== undefined && Number.isFinite(assistPixels)) {
    const clamped = Math.min(
      Math.max(Math.round(assistPixels), 0),
      orderedKeys.length - 1,
    );
    const targetKey = orderedKeys[clamped];
    return { targetKey, targetIndex: clamped, usedPixelFallback: true };
  }
  const fallback = orderedKeys[0];
  return { targetKey: fallback, targetIndex: 0, usedPixelFallback: false };
}

/** 脏草稿守卫决策（纯判定，不做任何 UI）。 */
export type DirtyDraftGuardDecision = "allow" | "require-confirm";

/**
 * 脏草稿守卫纯判定：同模块单例窗口加载新目标前，若存在未提交的
 * 草稿（有正文且版本号与已提交版本不一致），必须先要求用户确认，
 * 不得静默丢弃或覆盖；其他情况直接放行。
 */
export function checkDirtyDraftGuard(input: {
  sameModule: boolean;
  loadingNewTarget: boolean;
  draftMessage: string;
  draftRevision: number;
  committedRevision?: number;
}): DirtyDraftGuardDecision {
  if (!input.sameModule || !input.loadingNewTarget) {
    return "allow";
  }
  if (input.draftMessage.trim() === "") {
    return "allow";
  }
  if (
    input.committedRevision !== undefined &&
    input.draftRevision === input.committedRevision
  ) {
    return "allow";
  }
  return "require-confirm";
}
