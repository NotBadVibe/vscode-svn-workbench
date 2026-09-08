/*
 * v0.0.8 列表偏好（排序方向/字段与密度）按模块本地保存。
 * 优先复用现有 Webview state 通道（workbenchBridge getState/setState），
 * 不发送到 Host；键含 moduleId，不跨模块串用。
 *
 * V024-R51 存续范围：
 * - 仅保存不含正文的视图偏好（排序、密度、展开状态）；不保存正文、
 *   路径候选、凭据或任何写令牌/AI 确认。未知字段写入时直接丢弃。
 * - 隔离：VS Code Webview state 容器按工作区隔离；键含 moduleId，不跨模块串用。
 *   同工作区内可选再按 projectKey + moduleId 隔离（projectKey 缺省时使用历史
 *   moduleId 键，旧数据可读）。Webview 未接收本地绝对路径，展示名可能重名，
 *   因此各模块缺省保持工作区 + 模块级共享（排序/密度本就是视图默认值，不算串用）；
 *   需要按项目区分的表面可显式传入稳定 projectKey。Host 侧草稿按真实项目身份隔离
 *  （见 projectDraftStore.projectDraftKey），与本模块互补。
 * - 清理：clearListPreferences/clearAllListPreferences 为清理入口；
 *   Webview state 随工作区关闭可整体清除。
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

/**
 * V024-R51：视图偏好写入白名单。保存时只保留排序、密度与展开状态，
 * 正文、路径候选、凭据等未知字段一律丢弃（不落盘正文）。
 */
function sanitizePreferences(preferences: ListPreferences): ListPreferences {
  const next: ListPreferences = {};
  if (preferences.sortField !== undefined)
    next.sortField = preferences.sortField;
  if (preferences.sortDirection !== undefined)
    next.sortDirection = preferences.sortDirection;
  if (preferences.density !== undefined) next.density = preferences.density;
  if (preferences.customSortField !== undefined)
    next.customSortField = preferences.customSortField;
  if (preferences.expandedGroups !== undefined)
    next.expandedGroups = [...preferences.expandedGroups];
  return next;
}

/**
 * V024-R51：按 projectKey + moduleId 派生存储键。
 * projectKey 为空时使用历史 moduleId 键（旧数据可读）。
 */
export function preferenceStorageKey(
  moduleId: string,
  projectKey?: string,
): string {
  const trimmed = (projectKey ?? "").trim();
  if (!trimmed) return moduleId;
  return `${trimmed}::${moduleId}`;
}

function readAll(): Record<string, ListPreferences> {
  const state = workbenchBridge.getState() as
    Record<string, unknown> | undefined;
  const stored = state?.[STATE_KEY];
  return typeof stored === "object" && stored !== null
    ? (stored as Record<string, ListPreferences>)
    : {};
}

function readEntry(key: string): ListPreferences | undefined {
  const stored = readAll()[key];
  if (stored && typeof stored === "object") return { ...stored };
  const fallback = memoryFallback.get(key);
  if (fallback) return { ...fallback };
  return undefined;
}

export function loadListPreferences(
  moduleId: string,
  projectKey?: string,
): ListPreferences {
  const key = preferenceStorageKey(moduleId, projectKey);
  // 项目级优先；缺省回退历史模块键（旧数据可读，但新项目写入不再共用旧键）。
  const stored =
    readEntry(key) ?? (key !== moduleId ? readEntry(moduleId) : undefined);
  if (stored) return sanitizePreferences(stored);
  return {};
}

export function saveListPreferences(
  moduleId: string,
  preferences: ListPreferences,
  projectKey?: string,
): void {
  const key = preferenceStorageKey(moduleId, projectKey);
  const sanitized = sanitizePreferences(preferences);
  memoryFallback.set(key, { ...sanitized });
  // Mock/浏览器开发环境没有 VS Code state API：仅内存保存。
  if (workbenchBridge.isMock) return;
  const state =
    (workbenchBridge.getState() as Record<string, unknown> | undefined) ?? {};
  const all = readAll();
  all[key] = { ...sanitized };
  workbenchBridge.setState({ ...state, [STATE_KEY]: all });
}

/**
 * V024-R51：清理入口。清除指定模块（可选指定项目）的视图偏好；
 * 全缺省时清除全部视图偏好。不触碰正文草稿与凭据（本模块从不保存它们）。
 */
export function clearListPreferences(
  moduleId?: string,
  projectKey?: string,
): void {
  const targetKey =
    moduleId !== undefined
      ? preferenceStorageKey(moduleId, projectKey)
      : undefined;
  if (targetKey !== undefined) {
    memoryFallback.delete(targetKey);
    // 项目键回退：清除项目键时不同时清除历史模块键（历史键另行显式清除），
    // 避免一次清理误删其他项目的共享默认值。
  } else {
    memoryFallback.clear();
  }
  if (workbenchBridge.isMock) return;
  const state =
    (workbenchBridge.getState() as Record<string, unknown> | undefined) ?? {};
  const all = readAll();
  if (targetKey !== undefined) {
    delete all[targetKey];
  } else {
    for (const key of Object.keys(all)) delete all[key];
  }
  workbenchBridge.setState({ ...state, [STATE_KEY]: all });
}

/** V024-R51：清理全部视图偏好的便捷入口（等价于 clearListPreferences()）。 */
export function clearAllListPreferences(): void {
  clearListPreferences();
}
