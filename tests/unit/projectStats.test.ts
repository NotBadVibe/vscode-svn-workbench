import { describe, expect, it } from "vitest";
import {
  buildProjectStatsItems,
  PROJECT_STATS_NEVER_COLLECTED_ERROR,
  PROJECT_STATS_STALE_REASON,
  type ProjectStatsBaseItem,
} from "../../src/extension/workbench/projectStats";

/*
 * V024-R39：项目统计状态装配（纯领域逻辑）。
 * 零修改（全 0）与未读取/失败（无 counts）严格区分；失败保留上一成功值
 * 配过期原因；定向重试时非目标项目沿用缓存重放，不被清空。
 */

function base(
  overrides: Partial<ProjectStatsBaseItem> & { absolutePath: string },
): ProjectStatsBaseItem {
  return {
    name: "app",
    exists: true,
    binding: "workingCopyRoot",
    bindingLabel: "独立工作副本根",
    workingCopyRoot: "/repo/app",
    current: false,
    ...overrides,
  };
}

describe("项目统计状态装配（V024-R39）", () => {
  it("成功采集为 ready，零修改显式全 0（不与未读取等同）", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/app" })],
      new Map([
        [
          "/repo/app",
          {
            counts: { changes: 0, conflicts: 0, unversioned: 0 },
            updatedAt: "2026-09-08T00:00:00.000Z",
          },
        ],
      ]),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(items).toHaveLength(1);
    expect(items[0].statsStatus).toBe("ready");
    expect(items[0].counts).toEqual({
      changes: 0,
      conflicts: 0,
      unversioned: 0,
    });
    expect(items[0].statsUpdatedAt).toBe("2026-09-08T00:00:00.000Z");
    expect(items[0].statsError).toBeUndefined();
  });

  it("失败且无上一成功值为 error，无 counts（绝不当作 0）", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/app" })],
      new Map(),
      new Map([["/repo/app", "工作副本统计失败：超时"]]),
      new Map(),
      new Map(),
    );
    expect(items[0].statsStatus).toBe("error");
    expect(items[0].counts).toBeUndefined();
    expect(items[0].statsError).toContain("超时");
  });

  it("失败且有上一成功值为 stale：保留旧值 + 成功时间 + 过期原因", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/app" })],
      new Map(),
      new Map([["/repo/app", "工作副本统计失败：连接重置"]]),
      new Map([
        [
          "/repo/app",
          {
            counts: { changes: 3, conflicts: 1, unversioned: 0 },
            updatedAt: "2026-09-07T10:00:00.000Z",
          },
        ],
      ]),
      new Map(),
    );
    expect(items[0].statsStatus).toBe("stale");
    expect(items[0].counts).toEqual({
      changes: 3,
      conflicts: 1,
      unversioned: 0,
    });
    expect(items[0].statsUpdatedAt).toBe("2026-09-07T10:00:00.000Z");
    expect(items[0].staleReason).toBe(PROJECT_STATS_STALE_REASON);
    expect(items[0].statsError).toContain("连接重置");
  });

  it("同工作副本失败不影响其他项目：其他项目仍为可信 ready", () => {
    const items = buildProjectStatsItems(
      [
        base({ absolutePath: "/repo/a", name: "a" }),
        base({ absolutePath: "/repo/b", name: "b" }),
      ],
      new Map([
        [
          "/repo/b",
          {
            counts: { changes: 1, conflicts: 0, unversioned: 0 },
            updatedAt: "2026-09-08T00:00:00.000Z",
          },
        ],
      ]),
      new Map([["/repo/a", "工作副本统计失败"]]),
      new Map(),
      new Map(),
    );
    const a = items.find((item) => item.absolutePath === "/repo/a")!;
    const b = items.find((item) => item.absolutePath === "/repo/b")!;
    expect(a.statsStatus).toBe("error");
    expect(a.counts).toBeUndefined();
    expect(b.statsStatus).toBe("ready");
    expect(b.counts).toEqual({ changes: 1, conflicts: 0, unversioned: 0 });
  });

  it("定向重试重放：非目标项目沿用缓存为 ready，不被清空", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/other" })],
      new Map(),
      new Map(),
      new Map([
        [
          "/repo/other",
          {
            counts: { changes: 2, conflicts: 0, unversioned: 1 },
            updatedAt: "2026-09-07T09:00:00.000Z",
          },
        ],
      ]),
      new Map(),
    );
    expect(items[0].statsStatus).toBe("ready");
    expect(items[0].counts).toEqual({
      changes: 2,
      conflicts: 0,
      unversioned: 1,
    });
  });

  it("历史失败记忆：本轮未采集但失败记忆存在时仍可 stale", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/app" })],
      new Map(),
      new Map(),
      new Map([
        [
          "/repo/app",
          {
            counts: { changes: 1, conflicts: 0, unversioned: 0 },
            updatedAt: "2026-09-07T09:00:00.000Z",
          },
        ],
      ]),
      new Map([["/repo/app", "历史失败原因"]]),
    );
    expect(items[0].statsStatus).toBe("stale");
    expect(items[0].staleReason).toBe(PROJECT_STATS_STALE_REASON);
  });

  it("非 SVN / 路径缺失项目为 ready 且无 counts（不适用不断言失败）", () => {
    const items = buildProjectStatsItems(
      [
        {
          name: "notes",
          absolutePath: "/repo/notes",
          exists: true,
          binding: "notSvn",
          bindingLabel: "非 SVN 目录",
          current: false,
        },
      ],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(items[0].statsStatus).toBe("ready");
    expect(items[0].counts).toBeUndefined();
  });

  it("无任何状态时为 error 并给出可理解的下一步，不虚构 0", () => {
    const items = buildProjectStatsItems(
      [base({ absolutePath: "/repo/app" })],
      new Map(),
      new Map(),
      new Map(),
      new Map(),
    );
    expect(items[0].statsStatus).toBe("error");
    expect(items[0].counts).toBeUndefined();
    expect(items[0].statsError).toBe(PROJECT_STATS_NEVER_COLLECTED_ERROR);
  });
});
