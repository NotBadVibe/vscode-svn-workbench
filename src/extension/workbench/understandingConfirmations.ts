/**
 * v0.0.12 批次 B：跨模块会话内共享的用户确认事实存储。
 *
 * 变更解读模块（understanding）与其他模块（commit / changelists）各持独立
 * 会话窗口；用户确认事实“仅会话内”（不落盘，进程结束即失效）仍需跨模块
 * 复用。本模块提供内存级、按项目键隔离的存储：
 * - 写入：understanding 在确认/清除/组合快照时同步；
 * - 读取：commit 生成提交说明、changelists 语义拆分时只取“仍有效”（候选
 *   hash 一致且非待复核）的事实；
 * - 项目/范围变化后旧条目自然失效（项目键不匹配或被候选 hash 拒绝），
 *   绝不静默沿用。
 */

import type { UserConfirmedFact } from "../../understanding/changeUnderstanding";

interface StoredConfirmations {
  projectKey: string;
  scopeHash: string;
  candidateHash: string;
  facts: UserConfirmedFact[];
}

const store = new Map<string, StoredConfirmations>();

/** 写入/清空当前项目的会话内确认（facts 为空即删除条目）。 */
export function updateUnderstandingConfirmations(input: {
  projectKey: string;
  scopeHash: string;
  candidateHash: string;
  facts: UserConfirmedFact[];
}): void {
  if (input.facts.length === 0) {
    store.delete(input.projectKey);
    return;
  }
  store.set(input.projectKey, {
    projectKey: input.projectKey,
    scopeHash: input.scopeHash,
    candidateHash: input.candidateHash,
    facts: input.facts,
  });
}

/**
 * 读取仍有效的确认事实：项目键匹配 + 候选 hash 与当前一致 + 非待复核。
 * 任何不匹配都返回空（fail-closed），绝不把过期确认交给模型。
 */
export function readValidUnderstandingConfirmations(input: {
  projectKey: string;
  currentCandidateHash: string;
}): UserConfirmedFact[] {
  const entry = store.get(input.projectKey);
  if (!entry) return [];
  if (entry.candidateHash !== input.currentCandidateHash) return [];
  return entry.facts.filter((fact) => !fact.needsReview);
}
