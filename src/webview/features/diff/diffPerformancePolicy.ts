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

/**
 * V018-C 冲突大文件分级降级（v0.1.8 规划 §4.3）。
 *
 * 三档语义（§4.3）：低于阈值=完整统一视图；接近阈值=关高亮/减上下文/
 * 隐藏未激活只读来源；超阈值=保留草稿+简化编辑器或外部工具出口。
 * 任一降级显示原因+当前模式+可恢复动作；不静默改内容；5MB 安全上限不动；
 * 不切成破坏 marker/region/hash 的伪文件。包无 VirtualizedUnresolvedFile
 *（侦察确认），渲染器恒为 UnresolvedFile/结果编辑器，不强行虚拟化。
 *
 * 判定维度：actualLines（以实际行数为准）+ 冲突块数 + 长行维度。
 */

/** 冲突判定输入：行数以 actualLines 为准，长行单独成维。 */
export interface ConflictPerformanceInput {
  /** 实际行数（含 marker 开销，如 500 块×1000 行目标实际约 3501 行）。 */
  actualLines: number;
  conflictBlocks: number;
  /** 最长行字符数（UTF-16），缺省 0 视为无长行。 */
  maxLineLength?: number;
}

/** 冲突分级决策：模式 + 中文原因 + 可执行的展示降级动作。 */
export interface ConflictPerformanceDecision {
  mode: DiffPerformanceMode;
  reasons: DiffPerformanceReason[];
  /** 接近阈值档：关闭非必要高亮（纯文本语言）。 */
  disableHighlight: boolean;
  /** 接近阈值档：上下文展示上限（行），full 档为 null（不限制）。 */
  maxContextLines: number | null;
  /** 接近阈值档：隐藏未激活只读来源窗格（默认折叠）。 */
  hideInactiveSourcePanes: boolean;
  /** 超阈值档：建议简化编辑器/外部工具出口（草稿保留）。 */
  recommendSimplified: boolean;
}

/** V018-C 长行阈值：单行超 1000 字符视为长行放大器（至少进入精简档）。 */
export const V018C_LONG_LINE_THRESHOLD = 1000;

/** V018-C 精简档上下文上限：只读来源展示截断行数（展示降级，不改草稿）。 */
export const V018C_REDUCED_CONTEXT_LINES = 200;

/** V018-C 冲突中文模式标签（UI 直接展示）。 */
export const V018C_MODE_LABELS: Record<DiffPerformanceMode, string> = {
  full: "完整视图",
  reduced: "精简视图",
  simplified: "简化编辑器",
};

/**
 * 纯函数：冲突三档阈值判定（actualLines + 块数 + 长行）。
 * - 边界含等于：actualLines/fullMaxLines 与块数/fullMaxConflictBlocks 处仍为 full；
 *   reduced 上限处仍为 reduced，超出才进 simplified。
 * - 长行（maxLineLength > 1000）至少进入 reduced，原因复用“行数超过完整模式上限”。
 * - 返回值仅为展示降级建议：reduced 指导降高亮/上下文/隐藏来源；simplified
 *   指导保留草稿并提供简化编辑器/外部工具出口；不切换渲染器，不切分文件。
 */
export function decideConflictPerformanceMode(
  input: ConflictPerformanceInput,
  thresholds: DiffPerformanceThresholds = V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
): ConflictPerformanceDecision {
  const actualLines = Math.max(0, Math.floor(input.actualLines));
  const conflictBlocks = Math.max(0, Math.floor(input.conflictBlocks));
  const maxLineLength = Math.max(0, Math.floor(input.maxLineLength ?? 0));
  const hasLongLine = maxLineLength > V018C_LONG_LINE_THRESHOLD;
  const reasons = new Set<DiffPerformanceReason>();
  let mode: DiffPerformanceMode = "full";
  if (
    actualLines > thresholds.fullMaxLines ||
    conflictBlocks > thresholds.fullMaxConflictBlocks ||
    hasLongLine
  ) {
    mode = "reduced";
    if (actualLines > thresholds.fullMaxLines || hasLongLine) {
      reasons.add("行数超过完整模式上限");
    }
    if (conflictBlocks > thresholds.fullMaxConflictBlocks) {
      reasons.add("冲突块数超过完整模式上限");
    }
  }
  if (
    actualLines > thresholds.reducedMaxLines ||
    conflictBlocks > thresholds.reducedMaxConflictBlocks
  ) {
    mode = "simplified";
    if (actualLines > thresholds.reducedMaxLines) {
      reasons.add("行数超过精简模式上限");
    }
    if (conflictBlocks > thresholds.reducedMaxConflictBlocks) {
      reasons.add("冲突块数超过精简模式上限");
    }
  }
  const reduced = mode !== "full";
  return {
    mode,
    reasons: [...reasons],
    disableHighlight: reduced,
    maxContextLines: reduced ? V018C_REDUCED_CONTEXT_LINES : null,
    hideInactiveSourcePanes: reduced,
    recommendSimplified: mode === "simplified",
  };
}

/** V018-C 实测证据指针（普通 evidence，gitignored，不污染已发布 evidence）。 */
export const V018C_EVIDENCE_RUN =
  ".validation/evidence/v0.1.8/v018c-conflict-browser" as const;

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

/*
 * V018-D 定位器（DiffOverview）阈值门控（v0.1.8 规划 §4.4 + §8 纪律修正）。
 *
 * 实测（scripts/measure-v018d-locator.js，生产构建 preview 真实 Chromium；
 * 证据 `.validation/evidence/v0.1.8/v018d-locator-browser/v018d-locator.json`）：
 * - 小档（100 块）导航 P50 108.2ms / P95 126.3ms，略超 100ms 导航候选预算；
 * - 大档（500 块）导航 P50 1305.1ms / P95 1386.1ms，超预算约 14 倍，verdict no-go；
 * - 瓶颈在 UnresolvedFile.focusConflict 的 Pierre 侧布局成本，非定位器自身模型
 *   （模型构建约 0.2ms 通过）。
 * 规划 §4.4 要求「100/500 块下仍满足导航和滚动预算」，§8 禁止「扩大超时或删除
 * 断言取得通过」；超预算组件默认开启属违规，故按块数门控：≤ 阈值默认展开，
 * 超阈值默认折叠（不渲染分布条与列表，用户可显式展开，展开时提示成本）。
 * 定位器可存在但必须受控（720×480/200% 折叠态零占位，不占用主编辑区）。
 */

/** V018-D 定位器默认展开的块数上限（含等于；超阈值默认折叠）。 */
export const V018D_OVERVIEW_BLOCK_THRESHOLD = 100;

/** 定位器门控决策：是否超阈值 + 默认展开态 + 中文原因。 */
export interface DiffOverviewGateDecision {
  /** 块数（已钳制为非负整数）。 */
  blockCount: number;
  /** 生效阈值（默认 100，可注入复用，不散落魔法数字）。 */
  threshold: number;
  /** 超阈值则门控生效（默认折叠，不渲染列表；用户可显式展开）。 */
  gated: boolean;
  /** 默认展开态：未门控展开，门控折叠（用户显式选择可覆盖）。 */
  defaultExpanded: boolean;
  /** 中文原因（可直接展示，不静默）。 */
  reasons: string[];
}

/**
 * 纯函数：定位器阈值门控。边界含等于：块数 ≤ 阈值默认展开，> 阈值默认折叠。
 */
export function decideDiffOverviewGate(
  blockCount: number,
  threshold: number = V018D_OVERVIEW_BLOCK_THRESHOLD,
): DiffOverviewGateDecision {
  const count = Math.max(0, Math.floor(blockCount));
  const limit = Math.max(0, Math.floor(threshold));
  const gated = count > limit;
  return {
    blockCount: count,
    threshold: limit,
    gated,
    defaultExpanded: !gated,
    reasons: gated
      ? [`共 ${count} 块，超过 ${limit} 块阈值，已默认收起定位器`]
      : [],
  };
}

/*
 * V018-E 可选同步只读比较窗格 go/no-go（v0.1.8 规划 §4.5）。
 *
 * 结论：no-go，保留 v0.1.3 单视口（Tabs），不视为版本失败。
 * 本节只记录验证数据与纯门控，不挂载任何三窗格 UI，不调用私有 API。
 *
 * 逐条验证（证据均为平台无关的静态契约或既有实测复用，未新建浏览器运行）：
 * 1. 角色清楚（GO-可行）：协议已提供 base/mine/theirs/working 四路
 *    ConflictFileContentView（src/protocol/workbenchProtocol.ts），领域
 *    ConflictRegion{mine,base?,theirs} + ConflictFileModel 四角色标签
 *    （src/conflict/conflictDiffModel.ts）；Mine vs BASE（old=base/new=mine）
 *    与 Theirs vs BASE（old=base/new=theirs）只读 FileDiff 输入可纯构造，
 *    缺 BASE/截断/读取失败时 fail-closed 回单视口。
 * 2. 公开 API（NO-GO-严格）：ScrollSyncManager 公开 setup/cleanUp 仅同步
 *    同一 FileDiff 内左右栏横向 scrollTo({left})（dist/managers/
 *    ScrollSyncManager.js 实证），enabled 为私有守卫；FileDiff.d.ts
 *    中 scrollSyncManager/codeDeletions/codeAdditions 均为 protected，公开
 *    纵向 API 仅 revealLine（hunk 展开语义，非连续滚动），get/setCodeScrollLeft
 *    仅横向；CodeView/Coordinator 为多条目虚拟列表容器与 slot 快照协调
 *    （dist/components/CodeView.d.ts），非跨窗格滚动同步器。跨实例纵向
 *    像素同步需触及 shadow 内 protected 节点，属私有，不可维护。
 * 3. 可关闭无震荡（未实测）：关闭模式存在（cleanUp/dispose 幂等 +
 *    ScrollSyncManager 内 isDeletionsScrolling 互斥守卫可借鉴），但跨窗格
 *    纵向无震荡未经浏览器 A/B 实测，不可标 GO。
 * 4. 按需挂载与清理（部分）：单实例幂等 dispose + observer 回收已有
 *    diffViewAdapter/conflictDiffViewAdapter 与单测，但三实例挂载成本与
 *    文件切换内存回收未经实测。
 * 5. 1024px 门限（模式可行，未实测）：ConflictsModule 已有 Tabs 单视口
 *    （working/mine/theirs/base）与 760px 折叠先例，但 1024px 多栏门限与
 *    小屏自动回 Tabs 未实现、未做视口 E2E。
 * 6. 键盘与读屏（未实测）：现有 tablist/region/aria-label 模式可复用，但三窗格
 *    焦点顺序与读屏语义未设计、未做 axe/真实读屏（设计基线 §3.4 明确真实读屏未执行）。
 * 7. 性能与内存（NO-GO）：V018-B 单只读 FileDiff 5000 行首屏 P95 2056ms，
 *    已超 800ms 候选预算 2.6x；三实例（2 只读 + 1 结果）外推远超首屏与
 *    100 块首个可操作冲突预算，且无三实例 A/B 实测；按硬约束不得缩 fixture
 *    或放宽断言取通过。
 * 任一条件不满足即 no-go（规划 §4.5），故三窗格默认关闭且不提供开启入口。
 */

/** V018-E 多栏生效的最小视口宽度（含等于；以下自动回 Tabs/单视口）。 */
export const V018E_MULTICOLUMN_MIN_WIDTH_PX = 1024;

/**
 * V018-E 证据说明：未新建三窗格浏览器运行（代码不存在，不可测）；
 * 静态证据为包内 dts/js 契约审计，性能外推复用 V018-B 普通 evidence。
 */
export const V018E_EVIDENCE_NOTE: string =
  "静态契约审计（@pierre/diffs@1.3.4 dist dts/js）+ 复用 " +
  V018B_EVIDENCE_RUN +
  " 单实例首屏数据外推；无三实例 A/B 运行";

/** V018-E 跨窗格纵向同步 API 处置：no-go（仅横向 intra-diff 同步可用）。 */
export const V018E_SYNC_API_DISPOSITION = {
  crossPaneVertical: "no-go" as const,
  reason:
    "ScrollSyncManager 仅同步同一 FileDiff 内左右栏横向 scrollLeft；" +
    "跨实例纵向同步无公开 API，需触及 shadow 内 protected 节点，属私有，不可维护",
} as const;

/** V018-E 门控输入（纯数据，不读 DOM，平台无关）。 */
export interface V018ESyncPanesInput {
  /** 实际行数（含 marker 开销）。 */
  actualLines: number;
  conflictBlocks: number;
  /** 最长行字符数（UTF-16），缺省 0 视为无长行。 */
  maxLineLength?: number;
  /** 四路内容是否齐全可用（缺 BASE/截断/读取失败即 fail-closed）。 */
  hasBase: boolean;
  hasMine: boolean;
  hasTheirs: boolean;
  truncated: boolean;
  hasReadError: boolean;
  /** 视口宽度 px；缺省视为未知（不可启用）。 */
  viewportWidthPx?: number;
  /** 用户显式开启（默认关；no-go 下即使为 true 仍不启用）。 */
  userEnabled: boolean;
}

/** V018-E 门控决策：当前证据下恒为不启用（翻转需新证据）。 */
export interface V018ESyncPanesDecision {
  enabled: false;
  /** no-go 下恒为 true（门控生效，保留单视口）。 */
  gated: true;
  /** 中文原因（可直接展示，不静默）。 */
  reasons: string[];
}

/**
 * 纯函数：V018-E 同步窗格门控。当前证据下恒返回不启用，并按输入逐项给出
 * 中文原因；跨窗格纵向同步原因恒存在。未来若有新证据支持启用，必须同步
 * 更新本决策、证据说明与对应测试，不得绕过本门控直接挂载三窗格。
 */
export function decideV018ESyncPanes(
  input: V018ESyncPanesInput,
  thresholds: DiffPerformanceThresholds = V018_PERFORMANCE_THRESHOLDS_PLACEHOLDER,
): V018ESyncPanesDecision {
  const actualLines = Math.max(0, Math.floor(input.actualLines));
  const conflictBlocks = Math.max(0, Math.floor(input.conflictBlocks));
  const maxLineLength = Math.max(0, Math.floor(input.maxLineLength ?? 0));
  const reasons: string[] = [];
  const contentOk =
    input.hasBase &&
    input.hasMine &&
    input.hasTheirs &&
    !input.truncated &&
    !input.hasReadError;
  if (!contentOk) {
    reasons.push("只读来源不完整（缺 BASE/截断/读取失败），已保留单视口");
  }
  const sizeOk =
    actualLines <= thresholds.fullMaxLines &&
    conflictBlocks <= thresholds.fullMaxConflictBlocks &&
    maxLineLength <= V018C_LONG_LINE_THRESHOLD;
  if (!sizeOk) {
    reasons.push("行数/块数/长行超过完整模式上限，三窗格不在预算内");
  }
  const viewportOk =
    input.viewportWidthPx !== undefined &&
    Math.floor(input.viewportWidthPx) >= V018E_MULTICOLUMN_MIN_WIDTH_PX;
  if (!viewportOk) {
    reasons.push(
      `视口不足 ${V018E_MULTICOLUMN_MIN_WIDTH_PX}px（或未知），自动回 Tabs/单视口`,
    );
  }
  if (!input.userEnabled) {
    reasons.push("三窗格默认关闭，需用户显式开启（当前未开启）");
  }
  reasons.push(V018E_SYNC_API_DISPOSITION.reason);
  return { enabled: false, gated: true, reasons };
}
