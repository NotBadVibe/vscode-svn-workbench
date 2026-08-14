/*
 * v0.0.8 批次 1 刷新合法交集（纯逻辑，无 DOM/VS Code/Svelte 依赖）。
 *
 * 契约来源：releases/v0.0.8 §4（全选与选择语义第 10 条）与 UX08-SEL-04。
 *
 * - 以调用方提供的复合稳定 key（已包含 working-copy/repository identity、
 *   规范化仓库内路径和归属）保留 selected ∩ 刷新后候选；
 * - 消失（候选快照中不存在）、越界、blocked/不可操作项由调用方判定并以
 *   retained/removalReason 输入，本模块不猜测、不放宽安全边界；
 * - 重复 identity 是数据完整性异常：fail-closed 取消选择并返回结构化原因，
 *   无论重复项顺序或 retained 组合都不得保留；
 * - 新文件绝不自动加入；needsReview 是否保留由调用方按
 *   actionable/blocked 契约判定后传入；
 * - 返回新集合与移除明细，旧集合不变。
 */

import type { SelectionKey } from "./selectionCore";

/** 刷新后候选中的一项；由调用方（Host 重新采集）构建。 */
export interface RefreshedSelectionItem {
  key: SelectionKey;
  /**
   * 刷新后该文件是否仍可保留选择。false 表示消失、越界、blocked 或
   * 其他调用方判定的不可操作原因；原因由调用方给出，模块不猜测。
   */
  retained: boolean;
  /** retained=false 时的移除原因（供 UI role=status 展示）。 */
  removalReason?: string;
}

export interface RemovedSelection {
  key: SelectionKey;
  reason: string;
}

export interface SelectionRefreshOutcome {
  /** 新集合：原 selected ∩ 刷新后保留项（重复 identity 项除外）。 */
  selected: ReadonlySet<SelectionKey>;
  /** 移除明细（原 selected 中被移除的 key 与原因）。 */
  removed: RemovedSelection[];
}

/** 候选快照中不存在时的默认原因（结构性事实，非猜测）。 */
const DEFAULT_REMOVED_REASON = "已从工作副本快照中消失";

/** 候选存在但判定为不可保留时的默认原因。 */
const DEFAULT_NOT_RETAINED_REASON = "状态已变化，不再可操作";

/** 同一 identity 在刷新快照中多次出现（数据完整性异常）时的确定原因。 */
const DUPLICATE_IDENTITY_REASON = "刷新快照存在重复身份，已安全取消选择";

/**
 * 刷新合法交集：保留 selected ∩ 刷新后保留项；移除消失/不可操作/重复
 * identity 项并返回结构化原因。候选中的新文件绝不自动加入。
 * 返回新集合，旧集合不变。
 */
export function refreshSelectionSet(
  selected: ReadonlySet<SelectionKey>,
  refreshed: readonly RefreshedSelectionItem[],
): SelectionRefreshOutcome {
  // 统计每个 identity 出现次数；重复即快照冲突（fail-closed）。
  const countByKey = new Map<SelectionKey, number>();
  for (const item of refreshed) {
    countByKey.set(item.key, (countByKey.get(item.key) ?? 0) + 1);
  }
  const firstByKey = new Map<SelectionKey, RefreshedSelectionItem>();
  for (const item of refreshed) {
    if (!firstByKey.has(item.key)) firstByKey.set(item.key, item);
  }

  const preserved = new Set<SelectionKey>();
  const removed: RemovedSelection[] = [];

  for (const key of selected) {
    const count = countByKey.get(key) ?? 0;
    if (count > 1) {
      removed.push({ key, reason: DUPLICATE_IDENTITY_REASON });
      continue;
    }
    const candidate = firstByKey.get(key);
    if (candidate !== undefined && candidate.retained) {
      preserved.add(key);
    } else {
      removed.push({
        key,
        reason:
          candidate?.removalReason ??
          (candidate === undefined
            ? DEFAULT_REMOVED_REASON
            : DEFAULT_NOT_RETAINED_REASON),
      });
    }
  }

  return { selected: preserved, removed };
}
