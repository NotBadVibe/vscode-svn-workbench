/*
 * V018-A 差异性能阈值策略模块候选（v0.1.8 规划 §4.1/§4.2/§5）。
 *
 * 定位：集中阈值与降级原因的唯一位置，不散落魔法数字。
 * 纪律：先放空架子 + baseline 数据填充建议，不启用切换。
 * 本模块暂不被任何 Diff/冲突渲染组件引用（零改动现有渲染），
 * 实际切换门控待 V018-B/V018-C 依据 baseline 证据再启用。
 */

/** 性能模式：完整 / 精简（降高亮与上下文）/ 简化（纯文本或外部工具出口）。 */
export type DiffPerformanceMode = "full" | "reduced" | "simplified";

/** 降级原因（中文，便于 UI 直接展示，不静默改变内容）。 */
export type DiffPerformanceReason =
  | "行数超过完整模式上限"
  | "冲突块数超过完整模式上限"
  | "行数超过精简模式上限"
  | "冲突块数超过精简模式上限"
  | "高亮失败回退"
  | "内存预算不足回退";

/** 阈值表：当前为占位初值，待 V018-A baseline 填充后由证据调整。 */
export interface DiffPerformanceThresholds {
  /** 完整模式行数上限（候选：普通 Diff 以 5000 行为分界实测）。 */
  fullMaxLines: number;
  /** 精简模式行数上限（超出则进简化模式）。 */
  reducedMaxLines: number;
  /** 完整模式冲突块数上限（候选：以 100 块为分界实测）。 */
  fullMaxConflictBlocks: number;
  /** 精简模式冲突块数上限（超出则进简化模式）。 */
  reducedMaxConflictBlocks: number;
}

export interface DiffPerformanceInput {
  lines: number;
  conflictBlocks: number;
}

export interface DiffPerformanceDecision {
  mode: DiffPerformanceMode;
  reasons: DiffPerformanceReason[];
}

/*
 * 占位阈值（V018-A baseline 填充建议）：
 * - fullMaxLines：先取 5000，待 baseline 中 5000/10000 行首屏 P95 出炉后，
 *   以“首个可见内容 P95 ≤800ms”的候选预算反推（规划 §3）。
 * - fullMaxConflictBlocks：先取 100，待 100/500 块首个可操作冲突 P95
 *   （候选 ≤1000ms）出炉后调整。
 * - reduced 档上限为二级缓冲，具体值同样由 baseline 证据确定，本版本不拍脑袋。
 */
export const V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER: DiffPerformanceThresholds =
  {
    fullMaxLines: 5000,
    reducedMaxLines: 10000,
    fullMaxConflictBlocks: 100,
    reducedMaxConflictBlocks: 500,
  };

/** 规划 §3 候选预算（只读参照，调整必须说明原因，不可为通过而放宽）。 */
export const V018_CANDIDATE_BUDGETS = {
  /** 普通 Diff 5000 行首个可见内容 P95 ≤800ms。 */
  diff5000FirstVisibleP95Ms: 800,
  /** 冲突 100 块首个可操作冲突 P95 ≤1000ms。 */
  conflict100FirstActionableP95Ms: 1000,
  /** 块动作视觉反馈 P95 ≤100ms。 */
  blockActionP95Ms: 100,
  /** 普通输入处理 P95 ≤50ms。 */
  inputP95Ms: 50,
  /** 导航 P95 ≤100ms。 */
  navigationP95Ms: 100,
  /** 输入期间无 >50ms 高亮长任务。 */
  highlightLongTaskMs: 50,
} as const;

/**
 * 纯函数：按阈值给出模式建议与中文原因。
 * 注意：返回值仅为建议，调用方（V018-B/C）在门禁通过前不得据此切换渲染。
 */
export function suggestDiffPerformanceMode(
  input: DiffPerformanceInput,
  thresholds: DiffPerformanceThresholds = V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
): DiffPerformanceDecision {
  const reasons = new Set<DiffPerformanceReason>();
  let mode: DiffPerformanceMode = "full";
  if (
    input.lines > thresholds.fullMaxLines ||
    input.conflictBlocks > thresholds.fullMaxConflictBlocks
  ) {
    mode = "reduced";
    if (input.lines > thresholds.fullMaxLines) {
      reasons.add("行数超过完整模式上限");
    }
    if (input.conflictBlocks > thresholds.fullMaxConflictBlocks) {
      reasons.add("冲突块数超过完整模式上限");
    }
  }
  if (
    input.lines > thresholds.reducedMaxLines ||
    input.conflictBlocks > thresholds.reducedMaxConflictBlocks
  ) {
    mode = "simplified";
    if (input.lines > thresholds.reducedMaxLines) {
      reasons.add("行数超过精简模式上限");
    }
    if (input.conflictBlocks > thresholds.reducedMaxConflictBlocks) {
      reasons.add("冲突块数超过精简模式上限");
    }
  }
  return { mode, reasons: [...reasons] };
}
