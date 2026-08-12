/**
 * DiffView 差异视图重建决策（v0.0.6）。
 *
 * 手动生命周期：渲染 effect 每次重跑时调用 shouldRebuildDiffView 决定
 * 是否释放旧 FileDiff/Editor 实例并重新挂载。把判定抽成纯逻辑以便独立
 * 单测覆盖（含容器身份切换等 Svelte harness 难以触发的分支）。
 */

/** 当前已挂载视图的完整状态（含实际容器与渲染内容）。 */
export interface DiffViewMountState {
  /** 挂载键：目标/语言/编辑态/视图控件（unified/split、展开控制）。 */
  key: string;
  mode: "edit" | "read";
  /** 实际挂载实例的容器；销毁时必须清理它而不是当前新容器。 */
  container: HTMLElement;
  oldContents: string;
  newContents: string;
  patch: string | undefined;
}

/** 本次渲染的输入（与已挂载状态逐字段比较）。 */
export interface DiffViewNextRender {
  key: string;
  container: HTMLElement;
  oldContents: string;
  newContents: string;
  patch: string | undefined;
}

/**
 * 判断是否必须重建差异视图（释放旧实例并挂载到新状态）：
 * - 未挂载：需要挂载；
 * - 容器身份变化：必须重建——旧容器可能已脱离 DOM，实例残留在旧容器，
 *   销毁时必须清理旧容器而非当前新容器；
 * - 挂载键变化（目标切换/退出编辑/视图切换）：必须重建；
 * - 只读态内容变化（old/new/patch 逐字段比较，不做大文本拼接）：必须重建，
 *   以采用权威内容；
 * - 编辑态同键同容器：保持实例不重建（Host 保存后权威快照刷新不打断输入）。
 */
export function shouldRebuildDiffView(
  mounted: DiffViewMountState | undefined,
  next: DiffViewNextRender,
): boolean {
  if (mounted === undefined) return true;
  if (mounted.container !== next.container) return true;
  if (mounted.key !== next.key) return true;
  if (mounted.mode === "read") {
    return (
      mounted.oldContents !== next.oldContents ||
      mounted.newContents !== next.newContents ||
      mounted.patch !== next.patch
    );
  }
  return false;
}
