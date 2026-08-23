import type {
  ScopeRecommendation,
  WorkbenchModuleSnapshot,
} from "../../protocol/workbenchProtocol";

/**
 * v0.0.17 批次 C：全局推荐下一步（易用性审查 C-01/C-09）。
 * Host 按最新候选状态统一推导一条主推荐，挂在 ScopeBar 下方；
 * 推荐只是推荐：不替用户执行、不扩大右键范围、不自动开始写操作。
 * 推荐可忽略（Webview 会话内按 key 忽略），状态变化产生新 key 时重新
 * 展示，忽略不持久惩罚。
 */
export interface ScopeRecommendationInput {
  /** 当前范围冲突文件数（最新一次采集）。 */
  conflictedCount: number;
  /** 本地可提交变更数（modified/added/deleted/missing/replaced）。 */
  changedCount: number;
  /**
   * 当前范围候选文件总数（v0.0.18 批次 E：范围栏快捷事实）；
   * conflicts/update 快照无法给出时沿用上次值（undefined 表示尚无数据）。
   */
  totalCandidates?: number;
  /** 是否已配置任一 AI 场景模型。 */
  aiConfigured: boolean;
}

export function deriveScopeRecommendation(
  input: ScopeRecommendationInput,
): ScopeRecommendation | undefined {
  if (input.conflictedCount > 0) {
    return {
      key: `conflicts:${input.conflictedCount}`,
      title: `处理 ${input.conflictedCount} 个冲突`,
      reason: `当前范围有 ${input.conflictedCount} 个文件存在冲突，建议先处理冲突，再提交或更新。`,
      actionLabel: "前往处理冲突",
      target: { moduleId: "conflicts", taskId: "conflicts/resolve" },
      count: input.conflictedCount,
    };
  }
  if (input.changedCount > 0) {
    return {
      key: `commit:${input.changedCount}`,
      title: `检查建议的 ${input.changedCount} 个文件`,
      reason: `当前范围有 ${input.changedCount} 个本地修改，建议逐项检查后提交。`,
      actionLabel: "前往检查并提交",
      target: { moduleId: "commit", taskId: "commit/compose" },
      count: input.changedCount,
    };
  }
  if (!input.aiConfigured) {
    return {
      key: "ai-unconfigured",
      title: "了解 AI 可选能力",
      reason:
        "尚未配置 AI 模型。配置后可获得提交说明建议、变更解读等可选增强；未配置时核心 SVN 功能不受影响。",
      actionLabel: "了解 AI 可选能力",
      target: { moduleId: "settings", taskId: "settings/ai" },
    };
  }
  return {
    key: "clean-check-update",
    title: "检查远端更新",
    reason: "本地没有未提交修改，可以检查远端是否有新修订。",
    actionLabel: "前往检查更新",
    target: { moduleId: "update", taskId: "update/preview" },
  };
}

/** 按状态计数推导推荐输入；unversioned/ignored 等不计入可提交变更。 */
function inputFromStatusCounts(
  counts: Map<string, number>,
  aiConfigured: boolean,
): ScopeRecommendationInput {
  const conflicted = counts.get("conflicted") ?? 0;
  const changed =
    (counts.get("modified") ?? 0) +
    (counts.get("added") ?? 0) +
    (counts.get("deleted") ?? 0) +
    (counts.get("missing") ?? 0) +
    (counts.get("replaced") ?? 0);
  let total = 0;
  for (const count of counts.values()) total += count;
  return {
    conflictedCount: conflicted,
    changedCount: changed,
    totalCandidates: total,
    aiConfigured,
  };
}

/**
 * 从模块快照提取推荐输入；不携带候选信息的快照返回 undefined
 * （沿用会话内上一次输入，不为推荐额外采集 SVN 状态）。
 */
export function recommendationInputFromSnapshot(
  snapshot: WorkbenchModuleSnapshot,
  aiConfigured: boolean,
  previous: ScopeRecommendationInput | undefined,
): ScopeRecommendationInput | undefined {
  if (snapshot.kind === "changes") {
    const counts = new Map<string, number>(Object.entries(snapshot.summary));
    return inputFromStatusCounts(counts, aiConfigured);
  }
  if (snapshot.kind === "commit") {
    const counts = new Map<string, number>();
    for (const file of snapshot.files) {
      counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
    }
    return inputFromStatusCounts(counts, aiConfigured);
  }
  if (snapshot.kind === "conflicts") {
    const conflicted = snapshot.conflicts.length;
    return {
      conflictedCount: conflicted,
      changedCount: previous?.changedCount ?? 0,
      totalCandidates: previous?.totalCandidates,
      aiConfigured,
    };
  }
  if (snapshot.kind === "update") {
    if (snapshot.conflicts.error) return previous;
    return {
      conflictedCount: snapshot.conflicts.count,
      changedCount: previous?.changedCount ?? 0,
      totalCandidates: previous?.totalCandidates,
      aiConfigured,
    };
  }
  return previous;
}
