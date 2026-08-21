import { describe, expect, it } from "vitest";
import {
  createSnapshotFreshness,
  formatStaleMessage,
  isSnapshotStale,
} from "../../src/activity/snapshotFreshness";

describe("snapshotFreshness（History 只读快照）", () => {
  it("createSnapshotFreshness 生成 capturedAt/scopeHash/revision", () => {
    const f = createSnapshotFreshness("hash-1", "r42");
    expect(f.scopeHash).toBe("hash-1");
    expect(f.revision).toBe("r42");
    expect(new Date(f.capturedAt).toString()).not.toBe("Invalid Date");
  });

  it("scopeHash 变化即 stale", () => {
    const f = createSnapshotFreshness("hash-old", "r42");
    const res = isSnapshotStale(f, {
      currentScopeHash: "hash-new",
      currentRevision: "r42",
    });
    expect(res.stale).toBe(true);
    expect(res.reason).toBe("scopeHash");
  });

  it("revision 变化即 stale", () => {
    const f = createSnapshotFreshness("hash-1", "r41");
    const res = isSnapshotStale(f, {
      currentScopeHash: "hash-1",
      currentRevision: "r42",
    });
    expect(res.stale).toBe(true);
    expect(res.reason).toBe("revision");
  });

  it("时间超过 5 分钟即 stale（仅超时需建议刷新，文案诚实区分）", () => {
    const old = new Date(Date.now() - 6 * 60000).toISOString();
    const res = isSnapshotStale(
      { capturedAt: old, scopeHash: "h", revision: "r1" },
      { currentScopeHash: "h", currentRevision: "r1" },
    );
    expect(res.stale).toBe(true);
    expect(res.reason).toBe("time");
    expect(res.minutesAgo).toBeGreaterThanOrEqual(5);
    expect(formatStaleMessage(res.minutesAgo ?? 6, res.reason)).toBe(
      `此结果基于 ${res.minutesAgo} 分钟前的状态，工作副本可能已变化，建议刷新`,
    );
    // 确证变化（scopeHash/revision）文案为“已变化”，不含“可能”
    expect(formatStaleMessage(6, "scopeHash")).toBe(
      "此结果基于 6 分钟前的状态，工作副本已变化",
    );
    expect(formatStaleMessage(6, "revision")).toBe(
      "此结果基于 6 分钟前的状态，工作副本已变化",
    );
    expect(formatStaleMessage(6, "scopeHash")).not.toContain("可能");
  });

  it("新鲜快照不 stale", () => {
    const f = createSnapshotFreshness("h", "r1");
    const res = isSnapshotStale(f, {
      currentScopeHash: "h",
      currentRevision: "r1",
    });
    expect(res.stale).toBe(false);
  });

  it("无 freshness 不 stale", () => {
    expect(isSnapshotStale(undefined, { currentScopeHash: "h" }).stale).toBe(
      false,
    );
  });
});
