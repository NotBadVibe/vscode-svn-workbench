/*
 * V018-A 性能采集统计模块（v0.1.8 规划 §4.1）。
 *
 * 每组多轮输出 P50/P95（不只平均值），warm/cold 分组由调用方按轮次划分后
 * 分别汇总。自动门禁只用稳定指标；易抖指标记为趋势观察（见下方注释）。
 */

export interface V018RunSummary {
  runs: number;
  p50: number;
  p95: number;
  min: number;
  max: number;
  samples: number[];
}

/** 分位数（升序 + ceil 口径，与既有 measure 脚本一致）。 */
export function v018Percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index];
}

/** 多轮样本汇总为 P50/P95（含 min/max 便于观察抖动）。 */
export function summarizeV018Runs(samples: number[]): V018RunSummary {
  if (samples.length === 0) {
    return { runs: 0, p50: 0, p95: 0, min: 0, max: 0, samples: [] };
  }
  const rounded = samples.map((value) => Math.round(value * 100) / 100);
  return {
    runs: rounded.length,
    p50: Math.round(v018Percentile(rounded, 0.5) * 100) / 100,
    p95: Math.round(v018Percentile(rounded, 0.95) * 100) / 100,
    min: Math.min(...rounded),
    max: Math.max(...rounded),
    samples: rounded,
  };
}

/*
 * 门禁稳定性划分（V018-A 纪律）：
 * - 稳定门禁：fixture 构建耗时、内容字节数、块计数。进程内确定性、
 *   与机器绝对性能弱相关（字节/块数完全确定；耗时只做同机对比）。
 * - 趋势观察：堆内存、RSS、main-thread long task、首屏/高亮/输入延迟。
 *   易受 GC、调度与设备影响，只记趋势，不直接形成 flaky 阻断。
 *   浏览器侧首屏/高亮/输入/导航指标在 V018-B 接 Playwright 实测，本模块
 *   先给出类型与分组口径，不虚构数据。
 */
export const V018_STABLE_GATE_METRICS = [
  "fixtureBuild",
  "contentBytes",
  "blockCount",
] as const;

export const V018_TREND_ONLY_METRICS = [
  "heapUsed",
  "rss",
  "longTask",
  "firstPlainRender",
  "highlightReady",
  "firstInteractive",
  "input",
  "blockAction",
  "navigation",
] as const;

export type V018StableGateMetric = (typeof V018_STABLE_GATE_METRICS)[number];
export type V018TrendOnlyMetric = (typeof V018_TREND_ONLY_METRICS)[number];

/** 是否为可进自动门禁的稳定指标。 */
export function isV018StableGateMetric(name: string): boolean {
  return (V018_STABLE_GATE_METRICS as readonly string[]).includes(name);
}

/** 指标稳定性中文说明（采集报告与门禁注释共用）。 */
export function v018MetricStabilityNote(name: string): string {
  if (isV018StableGateMetric(name)) {
    return "稳定指标：可进自动门禁（同机对比，不得放宽断言）。";
  }
  return "趋势观察：易抖（GC/调度/设备），只记趋势，不直接阻断。";
}

export interface V018RunMetadata {
  /** 设备型号/CPU/内存。 */
  device: string;
  os: string;
  vscodeVersion: string;
  nodeVersion: string;
  /** 界面缩放（如 100%/200%，未记录时为 unknown）。 */
  zoom: string;
  /** 主题（Light/Dark/High Contrast，未记录时为 unknown）。 */
  theme: string;
  /** 构建模式：调试/生产（未记录时为 unknown）。 */
  buildMode: string;
  measuredAt: string;
}

/** 采集运行元数据（缺失项如实填 unknown，不虚构）。 */
export function collectV018Metadata(
  environment: NodeJS.ProcessEnv,
): V018RunMetadata {
  return {
    device: environment.V018_DEVICE ?? "unknown",
    os: environment.V018_OS ?? `${process.platform} ${process.arch}`,
    vscodeVersion: environment.V018_VSCODE ?? "unknown",
    nodeVersion: process.version,
    zoom: environment.V018_ZOOM ?? "unknown",
    theme: environment.V018_THEME ?? "unknown",
    buildMode: environment.V018_BUILD_MODE ?? "unknown",
    measuredAt: new Date().toISOString(),
  };
}
