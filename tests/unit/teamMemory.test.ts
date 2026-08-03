import { describe, expect, it, vi } from "vitest";
import type { Memento } from "vscode";
import {
  appendTeamMemory,
  clearTeamMemory,
  readTeamMemory,
  teamMemoryStorageKey,
  TEAM_MEMORY_MAX_ENTRIES,
} from "../../src/ai/teamMemory";

function memory(initial?: unknown): Memento {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(teamMemoryStorageKey("repo"), initial);
  return {
    keys: () => [...values.keys()],
    get: ((key: string, fallback?: unknown) =>
      values.has(key) ? values.get(key) : fallback) as Memento["get"],
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    }),
  };
}

describe("AI 团队记忆", () => {
  it("使用仓库哈希隔离、脱敏摘要、去重并可清除", async () => {
    expect(teamMemoryStorageKey("secret-url")).not.toContain("secret-url");
    const storage = memory();
    await appendTeamMemory(storage, "repo", {
      revision: "8",
      message: "\nfeat: token=abc password=super-secret\nbody",
      recordedAt: "2026-07-30T08:00:00.000Z",
    });
    await appendTeamMemory(storage, "repo", {
      revision: "8",
      message: "feat: token=abc password=super-secret",
      recordedAt: "2026-07-30T09:00:00.000Z",
    });
    const snapshot = readTeamMemory(storage, "repo");
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0].summary).not.toContain("super-secret");
    expect(snapshot.externallyShared).toBe(false);
    await clearTeamMemory(storage, "repo");
    expect(readTeamMemory(storage, "repo").entries).toEqual([]);
  });

  it("丢弃坏缓存、非法修订和空说明并限制最近 50 条", async () => {
    const storage = memory([
      { summary: "", recordedAt: "bad", source: "other" },
      null,
    ]);
    expect(readTeamMemory(storage, "repo").entries).toEqual([]);
    for (let index = 0; index < TEAM_MEMORY_MAX_ENTRIES + 2; index += 1) {
      await appendTeamMemory(storage, "repo", {
        revision: index === 0 ? "bad" : String(index),
        message: `message ${index}`,
        recordedAt: new Date(2026, 0, 1, 0, index).toISOString(),
      });
    }
    const snapshot = readTeamMemory(storage, "repo");
    expect(snapshot.entries).toHaveLength(TEAM_MEMORY_MAX_ENTRIES);
    expect(snapshot.entries[0].revision).toBe(
      String(TEAM_MEMORY_MAX_ENTRIES + 1),
    );
    const before = snapshot.entries.length;
    expect(
      (await appendTeamMemory(storage, "repo", { message: "   " })).entries,
    ).toHaveLength(before);
  });
});
