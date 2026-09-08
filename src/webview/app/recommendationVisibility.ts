import type {
  ScopeRecommendation,
  WorkbenchModuleId,
  WorkbenchTaskId,
} from "../../protocol/workbenchProtocol";

/**
 * V022-R28 · 推荐下一步的当前任务相关性过滤（Webview 侧纯函数）。
 *
 * 约束：
 * - 默认不改写操作协议：只消费已有 `moduleId`/`taskId`，不新增协议字段；
 * - 推荐只打开目标模块（`open-module`），不执行写操作、不扩大操作范围；
 * - 忽略仍是会话内按 `key` 生效（AppShell 侧），状态变化产生新 `key` 时重新展示。
 *
 * 规则（按顺序判定）：
 * 1. 当前 `module`/`task` 已等于推荐目标 → 隐藏同义推荐（如提交页不再显示“前往检查并提交”）。
 * 2. 当前阻止（`conflicts:N`）→ 始终显著（除规则 1 自身页面外），冲突数量由 Host 保证准确。
 * 3. 只读/配置类任务（历史、设置、诊断、项目、活动、差异浏览）→ 只保留当前阻止，其余降低（隐藏）。
 * 4. 编辑脏状态（提交说明/冲突草稿/差异编辑中）→ 不推无关跳转，只保留当前阻止。
 */
export interface RecommendationVisibilityContext {
  moduleId: WorkbenchModuleId;
  taskId: WorkbenchTaskId;
  /** 当前模块是否有未保存的编辑（提交说明非空、冲突草稿脏、差异编辑会话中等）。 */
  dirty: boolean;
}

/** 只读或配置类任务：推荐只保留当前阻止，不用跳转占据首屏。 */
const REDUCED_PROMINENCE_MODULES: ReadonlySet<WorkbenchModuleId> = new Set([
  "history",
  "settings",
  "diagnostics",
  "projects",
  "activity",
  "diff",
]);

/** 是否为当前阻止类推荐（key 由 Host 按 `conflicts:N` 生成，数量即最新采集）。 */
export function isBlockingRecommendation(
  recommendation: ScopeRecommendation,
): boolean {
  return recommendation.key.startsWith("conflicts:");
}

export function shouldShowRecommendation(
  recommendation: ScopeRecommendation | undefined,
  context: RecommendationVisibilityContext,
): boolean {
  if (!recommendation) return false;
  // 规则 1：已在推荐目标任务中，不重复引导。
  if (recommendation.target.moduleId === context.moduleId) return false;
  if (
    recommendation.target.taskId !== undefined &&
    recommendation.target.taskId === context.taskId
  ) {
    return false;
  }
  // 规则 2：当前阻止或必要恢复保持显著。
  if (isBlockingRecommendation(recommendation)) return true;
  // 规则 3：只读/配置任务降低推荐。
  if (REDUCED_PROMINENCE_MODULES.has(context.moduleId)) return false;
  // 规则 4：编辑脏状态不推无关跳转。
  if (context.dirty) return false;
  return true;
}
