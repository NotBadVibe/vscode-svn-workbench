import type { ProjectOverviewItem } from "../../protocol/workbenchProtocol";

/**
 * V024-R39：项目统计装配（纯领域逻辑，不依赖 vscode/SVN，可独立测试）。
 * - 成功值（successes）优先：ready + counts + 成功时间；
 * - 本轮/历史失败（failures）且有上一成功值（cache）：stale，保留上一成功值，
 *   配中文失败原因、成功时间与固定过期原因；
 * - 失败且无上一成功值：error，无 counts（绝不当作 0）；
 * - 非 SVN/路径缺失（workingCopyRoot 缺省）：ready 无 counts（不适用，由归属警告说明）；
 * - 零修改必须显式全 0 counts，与未读取/失败的缺省严格区分（调用方保证）。
 */

export interface ProjectStatsBaseItem {
  name: string;
  absolutePath: string;
  exists: boolean;
  binding: ProjectOverviewItem["binding"];
  bindingLabel: string;
  workingCopyRoot?: string;
  repositoryUuid?: string;
  current: boolean;
}

export interface ProjectStatsCounts {
  changes: number;
  conflicts: number;
  unversioned: number;
}

export interface ProjectStatsSuccess {
  counts: ProjectStatsCounts;
  updatedAt: string;
}

export const PROJECT_STATS_STALE_REASON =
  "工作副本统计失败，已保留上次成功值。";

export const PROJECT_STATS_NEVER_COLLECTED_ERROR =
  "尚未采集该项目统计，请刷新项目总览后重试。";

/**
 * 按项目装配统计状态视图。successes/failures 为本轮采集结果，
 * cache/failureMemory 为跨轮保留（成功值与失败原因记忆）。
 */
export function buildProjectStatsItems(
  baseItems: readonly ProjectStatsBaseItem[],
  successes: ReadonlyMap<string, ProjectStatsSuccess>,
  failures: ReadonlyMap<string, string>,
  cache: ReadonlyMap<string, ProjectStatsSuccess>,
  failureMemory: ReadonlyMap<string, string>,
): ProjectOverviewItem[] {
  return baseItems.map((item) => {
    if (item.workingCopyRoot === undefined) {
      return { ...item, statsStatus: "ready" as const };
    }
    const fresh = successes.get(item.absolutePath);
    if (fresh) {
      return {
        ...item,
        counts: { ...fresh.counts },
        statsStatus: "ready" as const,
        statsUpdatedAt: fresh.updatedAt,
      };
    }
    const failure =
      failures.get(item.absolutePath) ?? failureMemory.get(item.absolutePath);
    const cached = cache.get(item.absolutePath);
    if (failure && cached) {
      return {
        ...item,
        counts: { ...cached.counts },
        statsStatus: "stale" as const,
        statsError: failure,
        statsUpdatedAt: cached.updatedAt,
        staleReason: PROJECT_STATS_STALE_REASON,
      };
    }
    if (cached) {
      // 非目标分组重放：沿用上一成功值，仍为可信 ready。
      return {
        ...item,
        counts: { ...cached.counts },
        statsStatus: "ready" as const,
        statsUpdatedAt: cached.updatedAt,
      };
    }
    if (failure) {
      return {
        ...item,
        statsStatus: "error" as const,
        statsError: failure,
      };
    }
    return {
      ...item,
      statsStatus: "error" as const,
      statsError: PROJECT_STATS_NEVER_COLLECTED_ERROR,
    };
  });
}
