/**
 * 快照新鲜度（v0.0.16 批次 D）
 * - 每个只读快照携带 capturedAt + scopeHash + revision
 * - 过期判断不只依赖颜色，需文字+图标提示
 */

export interface SnapshotFreshness {
  capturedAt: string;
  scopeHash: string;
  revision?: string;
}

export interface FreshnessCheckInput {
  currentScopeHash: string;
  currentRevision?: string;
}

export function isSnapshotStale(
  freshness: SnapshotFreshness | undefined,
  current: FreshnessCheckInput,
): { stale: boolean; reason?: string; minutesAgo?: number } {
  if (!freshness) return { stale: false };
  const minutesAgo = Math.floor(
    (Date.now() - new Date(freshness.capturedAt).getTime()) / 60000,
  );
  if (freshness.scopeHash !== current.currentScopeHash) {
    return { stale: true, reason: "scopeHash", minutesAgo };
  }
  if (
    freshness.revision !== undefined &&
    current.currentRevision !== undefined &&
    freshness.revision !== current.currentRevision
  ) {
    return { stale: true, reason: "revision", minutesAgo };
  }
  // 仅时间阈值：超过 5 分钟视为可能过期（提示文案仍需用户确认）
  if (minutesAgo >= 5) {
    return { stale: true, reason: "time", minutesAgo };
  }
  return { stale: false, minutesAgo };
}

export function formatStaleMessage(
  minutesAgo: number,
  reason?: string,
): string {
  if (reason === "time") {
    return `此结果基于 ${minutesAgo} 分钟前的状态，工作副本可能已变化，建议刷新`;
  }
  return `此结果基于 ${minutesAgo} 分钟前的状态，工作副本已变化`;
}

export function createSnapshotFreshness(
  scopeHash: string,
  revision?: string,
): SnapshotFreshness {
  return {
    capturedAt: new Date().toISOString(),
    scopeHash,
    revision,
  };
}
