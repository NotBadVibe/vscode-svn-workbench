/*
 * v0.0.7 项目切换草稿守卫（releases/v0.0.7 §8）：模块窗口从项目 A 加载
 * 项目 B 前必须检查未完成内容。纯函数部分在此，可注入状态做单元测试；
 * Host 接线在 WorkbenchController.open()。
 */

export interface UnfinishedContentInput {
  /** 提交说明草稿（非空白）。 */
  commitMessage?: string;
  /** 手动文件选择。 */
  hasManualSelection?: boolean;
  /** 提交选择 AI 结果。 */
  hasCommitAiResult?: boolean;
  /** 待确认的提交预览。 */
  hasCommitPreview?: boolean;
  /** 待确认的文件操作预览。 */
  hasChangesPreview?: boolean;
  /** 待确认的历史恢复预览。 */
  hasHistoryRestorePreview?: boolean;
  /** 待确认的冲突解决预览。 */
  hasConflictResolvePreview?: boolean;
  /** 冲突 AI 建议。 */
  hasConflictAdvice?: boolean;
  /** Diff 页内编辑草稿。 */
  hasDiffDraft?: boolean;
}

export interface UnfinishedContentResult {
  hasContent: boolean;
  /** 中文原因列表，用于三选一确认消息。 */
  reasons: string[];
}

export function collectUnfinishedContent(
  input: UnfinishedContentInput,
): UnfinishedContentResult {
  const reasons: string[] = [];
  if (input.commitMessage && input.commitMessage.trim().length > 0) {
    reasons.push("提交说明草稿");
  }
  if (input.hasManualSelection) reasons.push("手动文件选择");
  if (input.hasCommitAiResult) reasons.push("提交选择 AI 结果");
  if (input.hasCommitPreview) reasons.push("待确认的提交预览");
  if (input.hasChangesPreview) reasons.push("待确认的文件操作预览");
  if (input.hasHistoryRestorePreview) reasons.push("待确认的历史恢复预览");
  if (input.hasConflictResolvePreview) reasons.push("待确认的冲突解决预览");
  if (input.hasConflictAdvice) reasons.push("冲突 AI 建议");
  if (input.hasDiffDraft) reasons.push("Diff 编辑草稿");
  return { hasContent: reasons.length > 0, reasons };
}

export type ProjectSwitchDecision = "stash" | "discard" | "stay";

/** 解析三选一按钮文案为决定；取消（undefined）按“留在当前项目”处理。 */
export function resolveProjectSwitchDecision(
  choice: string | undefined,
): ProjectSwitchDecision {
  if (choice === "保留为当前项目草稿并切换") return "stash";
  if (choice === "放弃内容并切换") return "discard";
  return "stay";
}
