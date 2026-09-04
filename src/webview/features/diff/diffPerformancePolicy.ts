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

/*
 * V018-B 普通 Diff 虚拟化与 Worker 评估结论（v0.1.8 规划 §4.2，spike→go/no-go）。
 *
 * 浏览器侧实测（Playwright 真实 Chromium，证据见 V018B_EVIDENCE_RUN）：
 * - 现状（生产构建 preview，FileDiff 只读，5 轮）：
 *   ts-1000-mid 首屏 P50 521ms / P95 530ms；
 *   ts-5000-mid 首屏 P50 2056ms / P95 2060ms（超 800ms 候选预算 2.6x）；
 *   ts-10000-mid 首屏 P50 4728ms / P95 4754ms；
 *   ts-5000-mid-longline-crlf-noeol 首屏 P50 4417ms / P95 4451ms
 *   （长行是放大器：5000 长行 ≈ 10000 普通行）。
 *   高亮在首屏后渐进完成（5000 行约 +313ms），首屏已是纯文本可用内容。
 * - spike 对比（同 vite dev 服务器，同 fixture 只读，3 轮，相对对比有效）：
 *   VirtualizedFileDiff 窗口化确认（ts-5000 Shadow 节点 3366 vs 117373，
 *   约 35x；滚动 22ms vs 320ms，约 14x；堆略降 45MB vs 54MB）；
 *   但首屏全面倒退——5000 行 2816ms vs 1773ms（+59%），10000 行
 *   5551ms vs 3383ms（+64%）：全文布局估计（computeApproximateSize）
 *   成本主导首屏，虚拟化只省滚动/DOM 不省首屏。
 *
 * 决策（数据驱动）：
 * - 虚拟化自动切换 = no-go：首要门禁是首屏 P95 ≤800ms，虚拟化回归首屏
 *   不满足门禁；滚动收益不足以抵消首屏回归 + Virtualizer 生命周期复杂度
 *   + 编辑态布局失效风险（invalidateEditSessionLayout 专属 API 存在）。
 *   默认保持 FileDiff；滚动优化留待首屏 plain 渐进渲染正解，不在本棒切换。
 * - 编辑态虚拟化 = no-go：有不兼容证据即不启用（上专属 API）。
 * - Worker（@pierre/diffs/worker 高亮）= no-go（defer）：高亮已渐进且非瓶颈
 *   （首屏不等待高亮），Worker 解决不了首屏矛盾；且 CSP 无 worker-src，
 *   启用需改 CSP + 自供 workerFactory + vite 打包验证，成本收益不成正比。
 *   CSP 不动（见 V018B_WORKER_DISPOSITION）。
 * - reduced/simplified 模式语义不变：仍指降高亮/上下文的展示降级，
 *   不指渲染器切换；渲染器恒为 FileDiff。
 */

/** V018-B 实测证据指针（普通 evidence，gitignored，不污染已发布 evidence）。 */
export const V018B_EVIDENCE_RUN =
  ".validation/evidence/v0.1.8/v018b-2026-09-04T12-21-14-browser" as const;

export const V018B_EVIDENCE_FILES = [
  "v018-browser.json",
  "v018-spike.json",
  "v018-spike-dom.json",
] as const;

/** V018-B 渲染器决策：恒为 FileDiff（no-go 显式门，翻转需新证据）。 */
export type V018BRendererKind = "filediff";

export interface V018BRendererDecision {
  renderer: V018BRendererKind;
  /** 虚拟化：no-go（首屏回归）；编辑态：no-go（布局失效风险）。 */
  virtualization: "no-go";
  /** 中文原因（可直接展示，不静默）。 */
  reasons: string[];
}

export interface V018BRendererInput {
  lines: number;
  /** 编辑态恒不虚拟化（分级阈值或简化高亮，不强行上）。 */
  editMode: boolean;
  /** patch 只读分支同样保持 FileDiff（no-go 下无分支切换）。 */
  patchBranch: boolean;
}

/**
 * 纯函数：V018-B 渲染器门控。当前数据下恒返回 FileDiff + no-go 原因；
 * 未来若有新证据支持切换，必须同步更新本决策、证据指针与对应测试，
 * 不得散落魔法数字或绕过本门控直接挂载 VirtualizedFileDiff。
 */
export function decideV018BRenderer(
  input: V018BRendererInput,
): V018BRendererDecision {
  const reasons: string[] = [
    "虚拟化未通过首屏门禁：同条件实测 5000 行首屏 +59%、10000 行 +64%，默认保持 FileDiff",
  ];
  if (input.editMode) {
    reasons.push("编辑态虚拟化存在布局失效风险，默认保持 FileDiff");
  }
  if (input.patchBranch) {
    reasons.push(
      "只读 patch 分支同样保持 FileDiff（虚拟化首屏回归，未达切换阈值）",
    );
  }
  if (input.lines > V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER.fullMaxLines) {
    reasons.push("行数超过完整模式上限：降高亮与上下文，不切换渲染器");
  }
  return { renderer: "filediff", virtualization: "no-go", reasons };
}

/** V018-B Worker 处置：不启用，CSP 不动。 */
export const V018B_WORKER_DISPOSITION = {
  enabled: false as const,
  /** CSP 变更：无（renderWebviewShell 不补 worker-src）。 */
  cspChange: "none" as const,
  reason:
    "高亮已渐进且非首屏瓶颈，Worker 解决不了首屏矛盾；启用需改 CSP + 自供 workerFactory + vite 打包验证，defer",
} as const;

/**
 * 纯函数：按阈值给出模式建议与中文原因。
 * 注意：返回值仅为建议，调用方（V018-B/C）在门禁通过前不得据此切换渲染。
 * V018-B 结论：reduced/simplified 仅指导降高亮与上下文，不触发渲染器切换
 * （渲染器由 decideV018BRenderer 门控，当前恒为 FileDiff）。
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
