/*
 * v0.0.8 列表偏好（排序方向/字段与密度）按模块本地保存。
 * 优先复用现有 Webview state 通道（workbenchBridge getState/setState），
 * 不发送到 Host；键含 moduleId，不跨模块串用。
 */

import type { SortDirection, SortField } from "../../selection/selectionSort";
import { workbenchBridge } from "../bridge/vscodeBridge";

export type ListDensity = "comfortable" | "compact";

export interface ListPreferences {
  sortField?: SortField;
  sortDirection?: SortDirection;
  density?: ListDensity;
  /**
   * V023-R22：非 SortField 体系的模块排序字段（如仓库浏览 name/type/...
   * 与历史变更路径 path/action），按模块键隔离存储，不串入 AI 建议等有意顺序。
   * 与 sortField 互斥使用：调用方只读写其中之一。
   */
  customSortField?: string;
  /**
   * v0.0.17 批次 D：任务导航分组展开记忆（组 id 集合；缺省表示全部默认
   * 折叠状态，由调用方决定哪些组默认展开）。
   */
  expandedGroups?: string[];
}

const STATE_KEY = "svnWorkbench.listPreferences.v1";

/** Mock/浏览器开发环境没有 VS Code state API 时的内存回退。 */
const memoryFallback = new Map<string, ListPreferences>();

function readAll(): Record<string, ListPreferences> {
  const state = workbenchBridge.getState() as
    Record<string, unknown> | undefined;
  const stored = state?.[STATE_KEY];
  return typeof stored === "object" && stored !== null
    ? (stored as Record<string, ListPreferences>)
    : {};
}

export function loadListPreferences(moduleId: string): ListPreferences {
  const stored = readAll()[moduleId];
  if (stored) return { ...stored };
  return { ...(memoryFallback.get(moduleId) ?? {}) };
}

export function saveListPreferences(
  moduleId: string,
  preferences: ListPreferences,
): void {
  memoryFallback.set(moduleId, { ...preferences });
  // Mock/浏览器开发环境没有 VS Code state API：仅内存保存。
  if (workbenchBridge.isMock) return;
  const state =
    (workbenchBridge.getState() as Record<string, unknown> | undefined) ?? {};
  const all = readAll();
  all[moduleId] = { ...preferences };
  workbenchBridge.setState({ ...state, [STATE_KEY]: all });
}
