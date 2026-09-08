/**
 * V023-R18：审阅队列逐文件滚动/导航记忆（Webview 会话内，模块重挂载后保留）。
 *
 * Diff 目标切换经 Host 重建快照（新会话 app/initialize），组件级 $state 会
 * 丢失；此模块级 Map 在同一 Webview JS 上下文中存活，只记“看到哪”（块索引
 * 与滚动偏移），不记任何可写身份，不进入日志与协议消息。
 */

export interface ReviewScrollMemory {
  /** 差异块导航索引（回到该文件时恢复，不破坏块导航语义）。 */
  navIndex: number;
  /** 模块滚动容器的 scrollTop（锚失效时的辅助恢复，不单独决定位置）。 */
  scrollTop: number;
}

const memory = new Map<string, ReviewScrollMemory>();

export function saveReviewScroll(
  relativePath: string,
  entry: ReviewScrollMemory,
): void {
  memory.set(relativePath, entry);
}

export function readReviewScroll(
  relativePath: string,
): ReviewScrollMemory | undefined {
  return memory.get(relativePath);
}

export function clearReviewScroll(): void {
  memory.clear();
}
