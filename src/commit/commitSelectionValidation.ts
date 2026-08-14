/*
 * v0.0.8 批次 2 提交选择校验（纯逻辑，无 vscode/SVN 依赖）。
 *
 * 契约来源：批次 2 Task 1（Host 提交选择 fail-closed）：
 * - commit/update-selection 不能只做 scope 校验，必须逐项验证路径在当前
 *   候选集合且 selection 不是 excluded/blocked；
 * - 重复 selectedPaths 规范化为唯一（保持首次出现顺序），确定行为；
 * - buildCommitSnapshot 对初始路由/草稿恢复/旧状态同样过滤：消失、
 *   excluded、blocked 自动移除并给出结构化原因；
 * - 非法输入不修改既有选择、不清除合法现状（由调用方决定）。
 */

import type { CommitCandidateSelection } from "./commitCandidateCollector";

/** 校验所需的最小候选视图（调用方传入权威候选快照）。 */
export interface CommitSelectionCandidateView {
  relativePath: string;
  selection: CommitCandidateSelection;
}

export interface CommitSelectionValidation {
  /** 去重后（保持首次出现顺序）的选择。 */
  selectedPaths: string[];
  /** 不在候选集合中的路径。 */
  missing: string[];
  /** 候选存在但为 excluded/blocked 的路径。 */
  notSubmittable: string[];
}

/**
 * 校验并规范化提交选择：去重 + 候选复验。missing/notSubmittable 非空时
 * 调用方必须拒绝整个请求（不修改既有选择）。
 */
export function validateCommitSelection(
  requested: readonly string[],
  candidates: readonly CommitSelectionCandidateView[],
): CommitSelectionValidation {
  // 重复路径规范化为唯一（保持首次出现顺序），确定行为。
  const selectedPaths = [...new Set(requested)];
  const candidateByPath = new Map(
    candidates.map((candidate) => [candidate.relativePath, candidate]),
  );
  const missing: string[] = [];
  const notSubmittable: string[] = [];
  for (const relativePath of selectedPaths) {
    const candidate = candidateByPath.get(relativePath);
    if (candidate === undefined) {
      missing.push(relativePath);
    } else if (
      candidate.selection === "excluded" ||
      candidate.selection === "blocked"
    ) {
      notSubmittable.push(relativePath);
    }
  }
  return { selectedPaths, missing, notSubmittable };
}

export interface CommitSelectionFilter {
  /** 仍有效的选择（保持输入顺序）。 */
  kept: string[];
  /** 被移除项的中文原因（供一次性 feedback 展示）。 */
  removedReasons: string[];
}

/**
 * 按候选快照过滤旧状态选择（初始路由/草稿恢复/刷新清理）：
 * 消失、excluded、blocked 自动移除并说明原因；重复 relativePath 规范化
 * 为唯一（保持首次出现顺序），重复合法项不在 kept 中重复、也不虚构
 * removed reason；新文件绝不自动加入。
 */
export function filterCommitSelectionByCandidates(
  selectedPaths: readonly string[],
  candidates: readonly CommitSelectionCandidateView[],
): CommitSelectionFilter {
  const candidateByPath = new Map(
    candidates.map((candidate) => [candidate.relativePath, candidate]),
  );
  const kept: string[] = [];
  const removedReasons: string[] = [];
  const seen = new Set<string>();
  for (const relativePath of selectedPaths) {
    // 重复路径只按首次出现处理一次：既不入 kept 重复，也不虚构移除原因。
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    const candidate = candidateByPath.get(relativePath);
    if (candidate === undefined) {
      removedReasons.push(`“${relativePath}”已从工作副本快照中消失`);
    } else if (
      candidate.selection === "excluded" ||
      candidate.selection === "blocked"
    ) {
      removedReasons.push(
        `“${relativePath}”已变为${
          candidate.selection === "blocked" ? "阻止项" : "排除项"
        }`,
      );
    } else {
      kept.push(relativePath);
    }
  }
  return { kept, removedReasons };
}
