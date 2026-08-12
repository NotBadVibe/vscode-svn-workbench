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
