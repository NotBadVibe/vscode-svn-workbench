/**
 * V017-C T6 —— 模块主区落点 action（DiffModule `focusOnMount` 模式的共享实现）。
 * - 用法：模块根容器 `use:focusOnMount` + `tabindex="-1"`。
 * - 模块挂载（用户显式打开/切换模块）时聚焦主区一次；快照刷新不重挂载，
 *   不抢焦点。只做视觉无感知的程序化聚焦，不改变布局。
 */
export function focusOnMount(node: HTMLElement): void {
  queueMicrotask(() => node.focus());
}
