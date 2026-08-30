/**
 * v0.1.3 V013-F 冲突恢复出口纯领域模型（中文注释）。
 * 每个错误按「发生了什么→可能原因→恢复动作」表达，提供明确出口。
 * 不自动执行任何 SVN 写操作，出口只读或复用现有确认通道。
 * 非文本分支（tree/property/binary）不伪装成文本合并，独立出口。
 */

import type { ConflictKind } from "./conflictCompletionModel";

// 复用 ConflictKind 定义，避免重复
export type { ConflictKind } from "./conflictCompletionModel";

/** 恢复动作类型（供 UI 按钮映射） */
export type RecoveryActionId =
  | "retry"
  | "copyDraft"
  | "exportDraft"
  | "repreview"
  | "refresh"
  | "viewDetail"
  | "openInEditor"
  | "openExternal"
  | "close";

/** 单条恢复信息：发生了什么→可能原因→恢复动作 */
export interface RecoveryInfo {
  /** 唯一标识 */
  id: string;
  /** 发生了什么 */
  what: string;
  /** 可能原因 */
  cause: string;
  /** 恢复动作说明 */
  recovery: string;
  /** 可执行动作按钮 */
  actions: RecoveryActionId[];
  /** 中文标签（用于 data-testid） */
  testId: string;
}

/** 判断是否为非文本冲突 */
export function isNonTextKind(kind: string | undefined): boolean {
  return kind === "tree" || kind === "property" || kind === "binary";
}

/** 非文本冲突类型的中文说明 */
export function getNonTextInfo(kind: string | undefined): {
  kind: ConflictKind;
  label: string;
  description: string;
  resolveHint: string;
} {
  switch (kind) {
    case "tree":
      return {
        kind: "tree",
        label: "树冲突",
        description:
          "树冲突：目录结构、文件移动、删除或重命名与本地修改并存，无法按文本合并处理。",
        resolveHint:
          "适用的 SVN 选择：可执行 svn resolve --accept mine-full（采用我的）或 --accept theirs-full（采用对方）、或保持冲突后在资源管理器中处理；本页面不提供文本合并。",
      };
    case "property":
      return {
        kind: "property",
        label: "属性冲突",
        description:
          "属性冲突：SVN 属性（svn:ignore、svn:externals 等）与对方修改冲突，无法按文本合并处理。",
        resolveHint:
          "适用的 SVN 选择：可执行 svn resolve --accept mine-full（采用我的属性）或 --accept theirs-full（采用对方属性）；请在属性视图或外部工具中确认。",
      };
    case "binary":
      return {
        kind: "binary",
        label: "二进制冲突",
        description:
          "二进制冲突：文件为二进制或包含不可解码内容，无法按文本合并处理。",
        resolveHint:
          "适用的 SVN 选择：可执行 svn resolve --accept mine-full（采用我的）或 --accept theirs-full（采用对方）；或在外部工具中打开后处理。",
      };
    default:
      return {
        kind: "tree",
        label: "非文本冲突",
        description: "非文本冲突：无法按文本合并处理，请使用对应工具处理。",
        resolveHint:
          "适用的 SVN 选择：可执行 svn resolve --accept mine-full / theirs-full；本页面不提供文本合并。",
      };
  }
}

/** V013-F 8 类恢复目录（每个按「发生了什么→可能原因→恢复动作」） */
export const RECOVERY_CATALOG: Record<string, RecoveryInfo> = {
  tokenExpired: {
    id: "tokenExpired",
    what: "发生了什么：保存失败，编辑令牌已过期",
    cause:
      "可能原因：令牌超过 15 分钟有效期、已保存过一次，或工作副本/范围已变化导致令牌失效",
    recovery: "恢复动作：请重新生成预览后重试；草稿已保留，可复制或导出后重试",
    actions: ["retry", "copyDraft", "exportDraft"],
    testId: "recovery-token-expired",
  },
  diskChanged: {
    id: "diskChanged",
    what: "发生了什么：保存失败，磁盘内容已变化",
    cause:
      "可能原因：文件被外部编辑器、SVN Update 或其他进程修改，与保存基准不一致",
    recovery: "恢复动作：请刷新工作副本状态后重试；草稿已保留，可复制或导出",
    actions: ["retry", "copyDraft", "exportDraft"],
    testId: "recovery-disk-changed",
  },
  documentDirty: {
    id: "documentDirty",
    what: "发生了什么：保存失败，编辑器中存在未保存内容",
    cause: "可能原因：VS Code 编辑器打开同一文件且有未保存修改，拒绝覆盖",
    recovery:
      "恢复动作：请先在编辑器中保存该文件，或关闭编辑器后重试；草稿已保留",
    actions: ["retry", "copyDraft", "exportDraft"],
    testId: "recovery-document-dirty",
  },
  targetMoved: {
    id: "targetMoved",
    what: "发生了什么：保存失败，目标文件已移动或删除",
    cause: "可能原因：文件被移动、删除或重命名，路径已不在原位置",
    recovery:
      "恢复动作：请检查文件是否仍在原路径，刷新状态后重试；草稿可复制或导出",
    actions: ["retry", "copyDraft", "exportDraft"],
    testId: "recovery-target-moved",
  },
  writeFailed: {
    id: "writeFailed",
    what: "发生了什么：保存失败，写入失败",
    cause: "可能原因：磁盘空间不足、权限不足或文件被占用",
    recovery: "恢复动作：请检查磁盘与权限后重试；草稿已保留，可复制或导出",
    actions: ["retry", "copyDraft", "exportDraft"],
    testId: "recovery-write-failed",
  },
  markerRemaining: {
    id: "markerRemaining",
    what: "发生了什么：核验未通过，仍检测到冲突标记",
    cause: "可能原因：合并结果中仍包含 <<<<<<< / ======= / >>>>>>> 冲突标记",
    recovery: "恢复动作：请继续编辑，直至所有冲突标记消除后重新保存",
    actions: ["retry"],
    testId: "recovery-marker-remaining",
  },
  previewExpired: {
    id: "previewExpired",
    what: "发生了什么：解决预览已过期",
    cause: "可能原因：草稿、范围或工作副本已变化，预览令牌失效",
    recovery: "恢复动作：请重新检查并生成新预览后再标记解决",
    actions: ["repreview"],
    testId: "recovery-preview-expired",
  },
  svnStatusChanged: {
    id: "svnStatusChanged",
    what: "发生了什么：SVN 状态已被外部改变",
    cause: "可能原因：文件已不是冲突状态，或被外部 SVN 操作改变",
    recovery: "恢复动作：请刷新冲突列表或重新采集状态后重试",
    actions: ["refresh", "viewDetail"],
    testId: "recovery-svn-status-changed",
  },
  resolveFailed: {
    id: "resolveFailed",
    what: "发生了什么：标记解决失败",
    cause: "可能原因：SVN resolve 执行失败（如权限、锁定或冲突已消失）",
    recovery: "恢复动作：请查看错误详情后重试，或在外部工具中执行 svn resolve",
    actions: ["retry", "viewDetail"],
    testId: "recovery-resolve-failed",
  },
  resolveCancelled: {
    id: "resolveCancelled",
    what: "发生了什么：标记解决已取消",
    cause: "可能原因：用户取消了操作或外部进程中断",
    recovery: "恢复动作：可重新生成预览后再次标记解决",
    actions: ["repreview", "close"],
    testId: "recovery-resolve-cancelled",
  },
  updateOriginClosed: {
    id: "updateOriginClosed",
    what: "发生了什么：更新来路已关闭",
    cause: "可能原因：更新结果页已关闭或会话已结束",
    recovery: "恢复动作：可重试更新或关闭本页",
    actions: ["retry", "close"],
    testId: "recovery-update-origin-closed",
  },
  reacquireFailed: {
    id: "reacquireFailed",
    what: "发生了什么：重新采集失败",
    cause: "可能原因：SVN 状态采集超时或工作副本不可用",
    recovery: "恢复动作：请重试采集，或关闭后重新打开",
    actions: ["retry", "close"],
    testId: "recovery-reacquire-failed",
  },
};

/**
 * 根据合并文本检测 marker 残留（复用 parseTextConflictBlocks 逻辑的简化版）。
 * 纯函数，不依赖 DOM。
 */
export function hasMarkerRemaining(text: string): boolean {
  if (!text) return false;
  return (
    text.includes("<<<<<<<") &&
    text.includes("=======") &&
    text.includes(">>>>>>>")
  );
}

/**
 * 根据快照与当前草稿推导应展示的恢复项列表（纯函数）。
 * 供 Webview 消费，Host 侧不直接依赖。
 */
export function deriveRecoveryItems(input: {
  conflictKind?: string;
  feedback?: string;
  issues?: string[];
  resolvePreview?: { canResolve: boolean; issues: string[] } | undefined;
  workingText?: string;
  hasResolveError?: boolean;
  hasResolveCancelled?: boolean;
  updateOriginClosed?: boolean;
  reacquireFailed?: boolean;
  hasPreviewExpired?: boolean;
  svnStatusChanged?: boolean;
}): RecoveryInfo[] {
  const items: RecoveryInfo[] = [];
  const fb = (input.feedback ?? "").toLowerCase();
  const issues = (input.issues ?? []).join(" ").toLowerCase();
  const combined = `${fb} ${issues}`;
  // 保存类：按关键字匹配（中文错误已固化，确保 feedback 含恢复动作）
  if (combined.includes("令牌") && combined.includes("过期")) {
    items.push(RECOVERY_CATALOG.tokenExpired);
  } else if (combined.includes("磁盘") && combined.includes("变化")) {
    items.push(RECOVERY_CATALOG.diskChanged);
  } else if (
    combined.includes("未保存内容") ||
    combined.includes("存在未保存")
  ) {
    items.push(RECOVERY_CATALOG.documentDirty);
  } else if (
    combined.includes("已移动") ||
    combined.includes("不存在") ||
    combined.includes("已删除")
  ) {
    items.push(RECOVERY_CATALOG.targetMoved);
  } else if (combined.includes("写入失败") || combined.includes("写失败")) {
    items.push(RECOVERY_CATALOG.writeFailed);
  }

  // marker 残留：文本检测或 issue 提示
  if (
    (input.workingText !== undefined &&
      hasMarkerRemaining(input.workingText)) ||
    combined.includes("冲突标记")
  ) {
    // 仅当核验 blocked 场景（非文本不混用），但此处通用提示继续编辑
    if (!items.some((i) => i.id === "markerRemaining")) {
      items.push(RECOVERY_CATALOG.markerRemaining);
    }
  }

  // Resolve preview 过期
  if (
    input.hasPreviewExpired ||
    combined.includes("预览已过期") ||
    combined.includes("预览令牌")
  ) {
    if (!items.some((i) => i.id === "previewExpired")) {
      items.push(RECOVERY_CATALOG.previewExpired);
    }
  }

  // SVN 状态被外部改变
  if (
    input.svnStatusChanged ||
    combined.includes("svn 状态已变化") ||
    combined.includes("不是冲突状态") ||
    combined.includes("已被外部改变")
  ) {
    items.push(RECOVERY_CATALOG.svnStatusChanged);
  }

  // svn resolve 失败/取消
  if (
    input.hasResolveError ||
    combined.includes("标记解决失败") ||
    combined.includes("resolve 失败")
  ) {
    items.push(RECOVERY_CATALOG.resolveFailed);
  }
  if (input.hasResolveCancelled || combined.includes("已取消")) {
    items.push(RECOVERY_CATALOG.resolveCancelled);
  }

  // Update 来路已关闭 / 重新采集失败
  if (input.updateOriginClosed) {
    items.push(RECOVERY_CATALOG.updateOriginClosed);
  }
  if (input.reacquireFailed) {
    items.push(RECOVERY_CATALOG.reacquireFailed);
  }

  return items;
}
