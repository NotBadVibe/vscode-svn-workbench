import { describe, expect, it } from "vitest";
import {
  appendActivityRecord,
  clearActivityStore,
  createActivityStore,
  filterRecordsByScope,
  MAX_ACTIVITY_RECORDS,
} from "../../src/activity/activityStore";
import type { ActivityRecord } from "../../src/activity/activityRecord";

function mockRecord(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: `id-${Math.random()}`,
    capturedAt: new Date().toISOString(),
    kind: "operation-execution",
    moduleId: "commit",
    taskId: "commit/compose",
    scopeHash: "hash-a",
    repositoryUuid: "uuid-1",
    scopeLabel: "提交 1 个文件",
    impactedCount: 1,
    previewSummary: "svn commit",
    result: "success",
    nextActions: [],
    ...overrides,
  };
}

describe("activityStore（会话内纯内存）", () => {
  it("追加记录按时间倒序且容量上限 64 淘汰最旧", () => {
    const store = createActivityStore(2);
    const a = mockRecord({ id: "a" });
    const b = mockRecord({ id: "b" });
    const c = mockRecord({ id: "c" });
    let s = appendActivityRecord(store, a);
    s = appendActivityRecord(s, b);
    expect(s.records[0].id).toBe("b");
    s = appendActivityRecord(s, c);
    expect(s.records.length).toBe(2);
    expect(s.records.map((r) => r.id)).toEqual(["c", "b"]);
    expect(MAX_ACTIVITY_RECORDS).toBe(64);
  });

  it("清除后为空", () => {
    let s = createActivityStore();
    s = appendActivityRecord(s, mockRecord({ id: "x" }));
    s = clearActivityStore(s);
    expect(s.records.length).toBe(0);
  });

  it("按 scopeHash 过滤不影响原 store", () => {
    let s = createActivityStore();
    s = appendActivityRecord(s, mockRecord({ id: "a", scopeHash: "hash-a" }));
    s = appendActivityRecord(s, mockRecord({ id: "b", scopeHash: "hash-b" }));
    const filtered = filterRecordsByScope(s, "hash-a");
    expect(filtered.map((r) => r.id)).toEqual(["a"]);
    expect(s.records.length).toBe(2);
  });

  it("不记录私密材料（previewSummary 截断）", () => {
    const long = "a".repeat(500);
    const r = mockRecord({ previewSummary: long });
    expect(r.previewSummary?.length).toBeLessThanOrEqual(500);
    // append 时应截断 200，领域层保证
    const s = appendActivityRecord(createActivityStore(), {
      ...r,
      previewSummary: long,
    });
    expect(s.records[0].previewSummary?.length).toBeLessThanOrEqual(200);
  });
});
