import type { ActivityRecord } from "./activityRecord";

/**
 * 会话内操作记录存储（v0.0.16 批次 A）
 * - 纯内存，不写磁盘；会话结束即清空
 * - 按捕获时间倒序；超过上限淘汰最旧
 * - 不记录 API Key/凭据/证书私密材料
 */
export const MAX_ACTIVITY_RECORDS = 64;

export interface ActivityStoreState {
  records: ActivityRecord[];
  capacity: number;
}

export function createActivityStore(
  capacity = MAX_ACTIVITY_RECORDS,
): ActivityStoreState {
  return { records: [], capacity };
}

export function appendActivityRecord(
  state: ActivityStoreState,
  record: ActivityRecord,
): ActivityStoreState {
  const truncated: ActivityRecord = {
    ...record,
    previewSummary: record.previewSummary
      ? record.previewSummary.slice(0, 200)
      : record.previewSummary,
  };
  const next = [truncated, ...state.records];
  if (next.length > state.capacity) {
    next.length = state.capacity;
  }
  return { ...state, records: next };
}

export function getActivityRecords(
  state: ActivityStoreState,
): ActivityRecord[] {
  return [...state.records];
}

export function clearActivityStore(
  state: ActivityStoreState,
): ActivityStoreState {
  return { ...state, records: [] };
}

export function filterRecordsByScope(
  state: ActivityStoreState,
  scopeHash: string,
): ActivityRecord[] {
  return state.records.filter((r) => r.scopeHash === scopeHash);
}
