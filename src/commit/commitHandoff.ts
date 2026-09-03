/*
 * v0.1.4 V014-E Changes → Commit 交接纯逻辑（无 vscode/SVN 依赖）。
 *
 * 职责：
 * - 交接选择整批复验：用权威候选逐项判定（消失/排除项/阻止项/
 *   跨仓库），全部非法 → rejected（调用方拒绝打开 Commit），部分非法
 *   → shrunk（收缩为合法交集转发，移除项进入 handoff），全合法 →
 *   accepted；
 * - 交接版本：COMMIT_HANDOFF_SELECTION_VERSION，旧版本载荷由 Host 忽略；
 * - 快照挂载决策：selectCommitHandoffForSnapshot（stale 即丢弃）。
 *
 * 安全语义：
 * - 只缩小不扩大：kept 恒为 requested ∩ 合法候选，新文件绝不自动加入；
 * - 只携带项目内相对路径，不暴露本地绝对路径，不构造日志与 URI；
 * - 不写 manualSelectedPaths（交接选择不得虚构成手动选择，由调用方保证）。
 */

import type { CommitHandoffView } from "../protocol/workbenchProtocol";
import type { CommitSelectionCandidateView } from "./commitSelectionValidation";

/** v0.1.4 V014-E 交接选择版本号：版本不匹配的载荷一律忽略。 */
export const COMMIT_HANDOFF_SELECTION_VERSION = 1;

export type CommitHandoffVerdict = "accepted" | "shrunk" | "rejected";

export interface CommitHandoffBuildResult {
  /** 合法交集（去重，保持首次出现顺序）。 */
  kept: string[];
  /** 复验剔除清单（含中文原因，直接可播报）。 */
  removedEntries: CommitHandoffView["removedEntries"];
  /** 整批复验结论：全合法/收缩/全拒。 */
  verdict: CommitHandoffVerdict;
  /** 去重后的交接请求数量。 */
  requestedCount: number;
  /** 保留的合法交集数量。 */
  keptCount: number;
}

/**
 * v0.1.4 V014-E3：跨仓库判定输入（方案①：build 产出 cross-repository）。
 * - currentRepositoryUuid：当前会话仓库 UUID（Host 权威）；
 * - originRepositoryUuid：交接来源仓库 UUID（跨窗口时为源会话 UUID，
 *   同窗时与当前一致；缺省视为同仓库，不猜测）。
 * 两者齐备且不一致时，全部请求项记 cross-repository（同名相对路径跨
 * 仓库也不得误判 accepted）；调用方仍须前置拒绝混合仓库合并（纵深）。
 */
export interface CommitHandoffRepositoryScope {
  currentRepositoryUuid?: string;
  originRepositoryUuid?: string;
}

/**
 * 整批复验交接选择：去重 + 跨仓库前置判定 + 权威候选逐项判定。
 * missing → disappeared（“已从工作副本快照中消失”），与
 * filterCommitSelectionByCandidates 中文口径一致；excluded/blocked 按
 * 阻止项/排除项说明；跨仓库（来源与当前仓库 UUID 不一致）统一记
 * cross-repository，不按消失处理（同名路径异仓库不得误判 accepted）。
 */
export function buildCommitHandoff(
  requested: readonly string[],
  candidates: readonly CommitSelectionCandidateView[],
  repositoryScope?: CommitHandoffRepositoryScope,
): CommitHandoffBuildResult {
  const deduped = [...new Set(requested)];
  // v0.1.4 V014-E3 必修 4：仓库不一致即整批跨仓库（死分支激活）。
  if (
    deduped.length > 0 &&
    repositoryScope?.currentRepositoryUuid !== undefined &&
    repositoryScope?.originRepositoryUuid !== undefined &&
    repositoryScope.originRepositoryUuid !==
      repositoryScope.currentRepositoryUuid
  ) {
    const removedEntries: CommitHandoffView["removedEntries"] = deduped.map(
      (relativePath) => ({
        path: relativePath,
        reason: "cross-repository" as const,
        message: `"${relativePath}"属于其他仓库，不能与当前仓库合并提交`,
      }),
    );
    return {
      kept: [],
      removedEntries,
      verdict: "rejected",
      requestedCount: deduped.length,
      keptCount: 0,
    };
  }
  const candidateByPath = new Map(
    candidates.map((candidate) => [candidate.relativePath, candidate]),
  );
  const kept: string[] = [];
  const removedEntries: CommitHandoffView["removedEntries"] = [];
  for (const relativePath of deduped) {
    const candidate = candidateByPath.get(relativePath);
    if (candidate === undefined) {
      removedEntries.push({
        path: relativePath,
        reason: "disappeared",
        message: `“${relativePath}”已从工作副本快照中消失`,
      });
    } else if (candidate.selection === "blocked") {
      removedEntries.push({
        path: relativePath,
        reason: "blocked",
        message: `“${relativePath}”为阻止项，暂不能提交`,
      });
    } else if (candidate.selection === "excluded") {
      removedEntries.push({
        path: relativePath,
        reason: "excluded",
        message: `“${relativePath}”已变为排除项`,
      });
    } else {
      kept.push(relativePath);
    }
  }
  const verdict: CommitHandoffVerdict =
    deduped.length > 0 && kept.length === 0
      ? "rejected"
      : removedEntries.length > 0
        ? "shrunk"
        : "accepted";
  return {
    kept,
    removedEntries,
    verdict,
    requestedCount: deduped.length,
    keptCount: kept.length,
  };
}

/**
 * 组装随 Commit 快照下发的交接记录（来源固定 changes）。
 * receivedAt 缺省为当前时间；测试可注入固定值。
 */
export function createCommitHandoffView(
  build: CommitHandoffBuildResult,
  receivedAt: string = new Date().toISOString(),
): CommitHandoffView {
  return {
    source: "changes",
    selectionVersion: COMMIT_HANDOFF_SELECTION_VERSION,
    requestedCount: build.requestedCount,
    keptCount: build.keptCount,
    removedEntries: build.removedEntries,
    receivedAt,
  };
}

/**
 * 旧版本/未来版本交接一律视为过期（stale）：调用方忽略，不下发。
 * 缺省（undefined）不是过期，而是“非交接进入”，同样不下发。
 */
export function isStaleCommitHandoff(
  handoff: CommitHandoffView | undefined,
): boolean {
  if (!handoff) {
    return false;
  }
  return handoff.selectionVersion !== COMMIT_HANDOFF_SELECTION_VERSION;
}

/**
 * 快照挂载决策：非交接（undefined）或版本过期返回 undefined（不下发，
 * 快照其余部分不受影响）；合法交接原样返回。fail-closed：版本不符的
 * 载荷不得进入快照。
 */
export function selectCommitHandoffForSnapshot(
  handoff: CommitHandoffView | undefined,
): CommitHandoffView | undefined {
  if (!handoff || isStaleCommitHandoff(handoff)) {
    return undefined;
  }
  return handoff;
}
