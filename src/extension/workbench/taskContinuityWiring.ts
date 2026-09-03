import type { CommitCandidate } from "../../commit/commitCandidateCollector";
import type {
  ChangesSnapshot,
  ContinuityRestoreView,
  WorkbenchFileView,
} from "../../protocol/workbenchProtocol";
import type { PathIdentityKey } from "../../scope/pathBrands";
import { createScopedFileKey } from "../../scope/projectIdentity";
import type { PathSemantics } from "../../scope/pathIdentity";
import {
  isSamePathIdentity,
  normalizePathIdentity,
} from "../../scope/pathIdentity";
import type { WorkbenchSession } from "./workbenchSession";
import {
  invalidateContinuity,
  isStaleSnapshot,
  reduceOnNavigate,
  resolveActiveFileFallback,
  resolveScrollAnchor,
  restoreAgainstSnapshot,
  type ContinuityInvalidateEvent,
  type ContinuitySnapshotEntry,
  type TaskContinuityContext,
} from "./taskContinuity";

/**
 * v0.1.4 V014-C1：连续上下文 Host 接线 helper（Changes → Diff → Changes）。
 *
 * 本文件只放“可独立测试的纯业务逻辑”，避免继续膨胀 WorkbenchController：
 * - 身份键解析器：createScopedFileKey（与文件视图 selectionKey 同源）；
 * - 重建迁移（scope 只缩不扩、项目切换/失效丢弃、新会话重锚）；
 * - 快照恢复载荷装配（合法交集、邻项回退、滚动锚、草稿保守）。
 *
 * 安全语义：
 * - resolveKey 与视图 selectionKey 同源，不自创第二套身份；
 * - 范围扩大/跨仓库一律拒绝并丢弃上下文；
 * - continuity 数据绝不进入日志/URI（本文件无任何日志与 URI 构造）。
 */

/** 身份键解析器：与 buildWorkbenchFileViews 的 selectionKey 同源。 */
export function continuityResolveKey(
  repositoryRoot: string,
  semantics: PathSemantics,
): (absolutePath: string) => PathIdentityKey {
  return (absolutePath: string) =>
    createScopedFileKey(repositoryRoot, absolutePath, semantics) ??
    normalizePathIdentity(absolutePath, semantics);
}

/** 旧会话是否切了项目（任一侧缺项目根视为未切换，由调用方另行处理）。 */
export function isContinuityProjectSwitch(
  previous: WorkbenchSession,
  next: WorkbenchSession,
  semantics: PathSemantics,
): boolean {
  const current = previous.scope.project?.projectRoot;
  const incoming = next.scope.project?.projectRoot;
  if (current === undefined || incoming === undefined) {
    return false;
  }
  return !isSamePathIdentity(current, incoming, semantics);
}

/**
 * open() 重建会话时的连续上下文迁移（V014-C1 (b)/(c)/(d)）。
 * - 目标非 changes：不携带（返回 undefined，调用方清空）；
 * - 无旧上下文或旧上下文已标记失效：不携带；
 * - 项目切换：强失效，不携带；
 * - reduceOnNavigate 拒绝（跨仓库/范围扩大）：不携带；
 * - 成功：迁移后把 originSessionId 重锚到新会话（新快照归属新会话，
 *   否则 restoreAgainstSnapshot 会把本次恢复误判为延迟旧快照而 stale）。
 */
export function migrateContinuityForReopen(
  previous: WorkbenchSession | undefined,
  next: WorkbenchSession,
  semantics: PathSemantics,
): TaskContinuityContext | undefined {
  if (next.moduleId !== "changes") {
    return undefined;
  }
  const context = previous?.taskContinuity;
  if (!context || context.invalidatedReason !== undefined) {
    return undefined;
  }
  if (previous && isContinuityProjectSwitch(previous, next, semantics)) {
    return undefined;
  }
  const migrated = reduceOnNavigate(
    context,
    {
      moduleId: next.moduleId,
      taskId: next.taskId,
      scopeHash: next.scopeHash,
      repositoryRoot: next.scope.repositoryRoot,
      repositoryUuid: next.repositoryUuid,
      roots: next.scope.roots.map((root) => root.absolutePath),
    },
    semantics,
  );
  if (!migrated.ok) {
    return undefined;
  }
  return { ...migrated.context, originSessionId: next.sessionId };
}

/**
 * 会话级失效标记（V014-C1 (d)）：选择/筛选变化等事件发生时调用。
 * 强失效（项目切换/窗口关闭/快照过期）会清空选择与锚点；调用方在迁移时
 * 统一丢弃已标记失效的上下文，不再下发 continuityRestore。
 */
export function noteContinuityEvent(
  session: WorkbenchSession,
  event: ContinuityInvalidateEvent,
): void {
  if (!session.taskContinuity) {
    return;
  }
  session.taskContinuity = invalidateContinuity(session.taskContinuity, event);
}

/** 恢复装配的最小候选投影（blocked/external 由调用方按权威候选判定）。 */
export interface ContinuityRestoreCandidate {
  absolutePath: string;
  selection: CommitCandidate["selection"];
  status: CommitCandidate["status"];
}

export interface BuildContinuityRestoreInput {
  context: TaskContinuityContext;
  /** 最新权威候选（本次快照同一批采集，不另行重采）。 */
  candidates: readonly ContinuityRestoreCandidate[];
  /** 本次快照文件视图（提供 selectionKey 顺序 = 展示顺序）。 */
  files: readonly WorkbenchFileView[];
  /** 新会话 id（延迟旧快照判定 stale 用）。 */
  sessionId: string;
  /** 新会话仓库 UUID。 */
  repositoryUuid: string;
  /** 范围是否包含外部引用（scope.includeExternals）。 */
  includeExternals: boolean;
  /** 目标会话当前提交草稿（非空即视为用户更新编辑，不下发旧草稿）。 */
  currentDraftMessage: string;
  /** 载荷生成时间（缺省为当前时间；测试可注入固定值）。 */
  restoredAt?: string;
}

export interface BuildContinuityRestoreResult {
  /** 恢复视图；undefined 表示无可下发（失效/stale/无合法项时保持现状）。 */
  view: ContinuityRestoreView | undefined;
  /** 快照是否过期（旧 sessionId）：调用方必须丢弃上下文。 */
  stale: boolean;
}

/**
 * 按最新候选装配 continuityRestore（V014-C1 (b)）。
 * - 上下文已标记失效：不下发；
 * - restore stale：不下发，调用方丢弃上下文；
 * - 选择=合法交集（blocked/external/跨仓库/消失逐项剔除并播报）；
 * - 活动文件消失时回退最近合法邻项并播报“原文件状态已变化”；
 * - 滚动以身份锚为主、像素为辅；
 * - 草稿保守：目标会话已有更新草稿时不下发旧草稿。
 */
export function buildContinuityRestore(
  input: BuildContinuityRestoreInput,
  semantics: PathSemantics,
): BuildContinuityRestoreResult {
  const { context } = input;
  if (context.invalidatedReason !== undefined) {
    return { view: undefined, stale: false };
  }
  const resolveKey = continuityResolveKey(
    context.originRepositoryRoot,
    semantics,
  );
  const entries: ContinuitySnapshotEntry[] = input.candidates.map(
    (candidate) => ({
      key: resolveKey(candidate.absolutePath),
      path: candidate.absolutePath,
      repositoryUuid: input.repositoryUuid,
      blocked: candidate.selection === "blocked",
      external: candidate.status === "external",
    }),
  );
  const restore = restoreAgainstSnapshot(context, {
    entries,
    sessionId: input.sessionId,
    includeExternals: input.includeExternals,
  });
  if (restore.stale) {
    return { view: undefined, stale: true };
  }
  const keptSet = new Set<string>(restore.keptKeys.map((key) => key as string));
  const isLegal = (key: PathIdentityKey): boolean => keptSet.has(key as string);
  const orderedKeys = input.files.map((file) => file.selectionKey);
  const fallback = resolveActiveFileFallback(
    context.activeFileKey,
    orderedKeys,
    isLegal,
  );
  const anchorKey =
    context.scrollAnchorKey && isLegal(context.scrollAnchorKey)
      ? context.scrollAnchorKey
      : fallback.fallbackKey;
  const scroll = resolveScrollAnchor(
    anchorKey,
    orderedKeys,
    context.scrollAssistPixels,
  );
  const notices: string[] = [];
  if (fallback.changed && fallback.notice) {
    notices.push(fallback.notice);
  }
  if (restore.removedEntries.length > 0) {
    notices.push(
      `已按最新快照保留 ${restore.keptKeys.length} 个选择，移除 ${restore.removedEntries.length} 个失效项。`,
    );
  }
  // 草稿保守：目标会话已有用户编辑（非空草稿）时不下发旧草稿；
  // 旧草稿本身为空时也无需下发。
  const previousDraft = context.commitDraft.message;
  const commitDraft =
    previousDraft.trim() !== "" && input.currentDraftMessage.trim() === ""
      ? previousDraft
      : undefined;
  const view: ContinuityRestoreView = {
    contextVersion: context.contextVersion,
    originModule: context.originModule,
    changesView: toRestoreChangesView(context),
    selectedKeys: [...restore.keptKeys],
    ...(fallback.fallbackKey ? { activeFileKey: fallback.fallbackKey } : {}),
    ...(scroll.targetKey ? { scrollAnchorKey: scroll.targetKey } : {}),
    ...(context.scrollAssistPixels !== undefined
      ? { scrollAssistPixels: context.scrollAssistPixels }
      : {}),
    ...(commitDraft !== undefined ? { commitDraft } : {}),
    removedEntries: restore.removedEntries.map((entry) => ({
      key: entry.key,
      path: entry.path,
      reason: entry.reason,
      message: entry.message,
    })),
    notices,
    restoredAt: input.restoredAt ?? new Date().toISOString(),
  };
  return { view, stale: false };
}

/**
 * A 模型视图偏好 → 协议恢复视图。
 * C1 的 Host 没有 Webview 实时视图通道（filter/sort/density/onlySelected
 * 均为 Webview 内存 $state），只能透传创建时可得的偏好；未知项缺省，
 * Webview 按现状展示（C2 消费时回填）。
 */
function toRestoreChangesView(
  context: TaskContinuityContext,
): ContinuityRestoreView["changesView"] {
  const source = context.changesView;
  const sort =
    source.sortField !== undefined
      ? `${source.sortField}:${source.sortDirection ?? "asc"}`
      : undefined;
  return {
    ...(source.filter !== undefined ? { query: source.filter } : {}),
    ...(sort !== undefined ? { sort } : {}),
    ...(source.density !== undefined ? { density: source.density } : {}),
    ...(source.onlySelected !== undefined
      ? { onlySelected: source.onlySelected }
      : {}),
  };
}

/** 快照是否应跳过恢复（非 changes 快照不挂载恢复载荷）。 */
export function shouldAttachContinuityRestore(
  snapshot: ChangesSnapshot,
  session: WorkbenchSession,
): boolean {
  return (
    snapshot.kind === "changes" &&
    session.moduleId === "changes" &&
    session.taskContinuity !== undefined &&
    snapshot.continuityRestore === undefined
  );
}

/** 供单测复用的 stale 判定透传（旧 sessionId 的延迟快照一律忽略）。 */
export { isStaleSnapshot };
