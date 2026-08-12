/*
 * v0.0.6 脏草稿目标切换三选一的决定解析（纯逻辑，可单测）。
 *
 * 授权边界：save 决定的 targetId 必须精确等于 Host 挂起确认时记录的
 * currentTargetId；Webview 不得指定同 scope 内任意其他草稿目标驱动
 * saveDraft（防恶意/陈旧 targetId 写入非预期文件）。
 */

export type DiffSwitchResolution =
  | { kind: "save"; targetId: string }
  | { kind: "stash" }
  | { kind: "stay" }
  | { kind: "reject"; reason: string };

export function resolveDiffSwitchDecision(
  pendingTargetId: string,
  decision: string | undefined,
  targetId: string | undefined,
): DiffSwitchResolution {
  if (decision === "save") {
    if (targetId === undefined || targetId !== pendingTargetId) {
      return {
        kind: "reject",
        reason: "保存决定的目标与挂起的切换确认不一致，已拒绝。",
      };
    }
    return { kind: "save", targetId: pendingTargetId };
  }
  if (decision === "stash") {
    return { kind: "stash" };
  }
  // stay 与未知决定都按“留在当前文件”安全处理。
  return { kind: "stay" };
}

/**
 * 是否需要在加载新目标前发起“脏草稿三选一”确认：
 * - 脏草稿必须确认（有真实未落盘内容）；
 * - 干净草稿但编辑会话仍活动也必须确认——用户可能刚输入而 debounce 检查点
 *   尚未到达 Host，Webview 侧知道真实脏状态（干净时自动暂存，不弹对话框）；
 * - 干净草稿且无活动会话（已保存/从未编辑）不确认，避免无谓往返。
 */
export function shouldConfirmTargetSwitch(state: {
  hasDraft: boolean;
  draftDirty: boolean;
  hasActiveSession: boolean;
}): boolean {
  return state.hasDraft && (state.draftDirty || state.hasActiveSession);
}
