import { describe, expect, it } from "vitest";
import {
  isProjectOverviewItem,
  isProjectsSnapshot,
  isProjectStatsStatus,
} from "../../src/protocol/workbenchProtocol";

/*
 * V024-R39：项目统计协议守卫。
 * 零修改（全 0）与未读取/失败（无 counts）不等同；stale 必须带上一成功值
 * 与过期原因；statsSeq 必填（Webview 按序号忽略旧快照）。
 */

function validItem(overrides: Record<string, unknown> = {}) {
  return {
    name: "app",
    absolutePath: "/repo/app",
    exists: true,
    binding: "workingCopyRoot",
    bindingLabel: "独立工作副本根",
    workingCopyRoot: "/repo/app",
    counts: { changes: 0, conflicts: 0, unversioned: 0 },
    statsStatus: "ready",
    statsUpdatedAt: "2026-09-08T00:00:00.000Z",
    current: false,
    ...overrides,
  };
}

describe("projectsProtocolGuards: isProjectStatsStatus", () => {
  it.each(["loading", "ready", "error", "stale"])("接受 %s", (status) => {
    expect(isProjectStatsStatus(status)).toBe(true);
  });

  it("拒绝未知状态与非字符串", () => {
    expect(isProjectStatsStatus("pending")).toBe(false);
    expect(isProjectStatsStatus("")).toBe(false);
    expect(isProjectStatsStatus(undefined)).toBe(false);
    expect(isProjectStatsStatus(0)).toBe(false);
  });
});

describe("projectsProtocolGuards: isProjectOverviewItem", () => {
  it("接受全 0 零修改的 ready 条目", () => {
    expect(isProjectOverviewItem(validItem())).toBe(true);
  });

  it("接受无 counts 的 error 条目（失败不当作 0）", () => {
    const withoutCounts: Record<string, unknown> = validItem({
      statsStatus: "error",
      statsError: "工作副本统计失败",
    });
    delete withoutCounts.counts;
    expect(isProjectOverviewItem(withoutCounts)).toBe(true);
  });

  it("接受带上一成功值与过期原因的 stale 条目", () => {
    expect(
      isProjectOverviewItem(
        validItem({
          statsStatus: "stale",
          statsError: "工作副本统计失败",
          staleReason: "工作副本统计失败，已保留上次成功值。",
        }),
      ),
    ).toBe(true);
  });

  it("拒绝缺 statsStatus 的条目", () => {
    const withoutStatus: Record<string, unknown> = validItem();
    delete withoutStatus.statsStatus;
    expect(isProjectOverviewItem(withoutStatus)).toBe(false);
  });

  it("拒绝非法 statsStatus", () => {
    expect(isProjectOverviewItem(validItem({ statsStatus: "pending" }))).toBe(
      false,
    );
  });

  it("拒绝 counts 非数值的条目", () => {
    expect(
      isProjectOverviewItem(
        validItem({ counts: { changes: "2", conflicts: 0, unversioned: 0 } }),
      ),
    ).toBe(false);
    expect(
      isProjectOverviewItem(
        validItem({
          counts: { changes: 2, conflicts: Number.NaN, unversioned: 0 },
        }),
      ),
    ).toBe(false);
  });

  it("拒绝缺 counts 的 stale（必须保留上一成功值）", () => {
    const withoutCounts: Record<string, unknown> = validItem({
      statsStatus: "stale",
      staleReason: "工作副本统计失败，已保留上次成功值。",
    });
    delete withoutCounts.counts;
    expect(isProjectOverviewItem(withoutCounts)).toBe(false);
  });

  it("拒绝缺 staleReason 的 stale", () => {
    expect(isProjectOverviewItem(validItem({ statsStatus: "stale" }))).toBe(
      false,
    );
  });

  it("拒绝非法 binding", () => {
    expect(isProjectOverviewItem(validItem({ binding: "svn" }))).toBe(false);
  });
});

describe("projectsProtocolGuards: isProjectsSnapshot", () => {
  function validSnapshot(overrides: Record<string, unknown> = {}) {
    return {
      kind: "projects",
      projects: [validItem()],
      generatedAt: "2026-09-08T00:00:00.000Z",
      statsSeq: 7,
      ...overrides,
    };
  }

  it("接受合法快照", () => {
    expect(isProjectsSnapshot(validSnapshot())).toBe(true);
  });

  it("拒绝缺 statsSeq 的快照", () => {
    const withoutSeq: Record<string, unknown> = validSnapshot();
    delete withoutSeq.statsSeq;
    expect(isProjectsSnapshot(withoutSeq)).toBe(false);
  });

  it("任一条目非法即整快照拒绝", () => {
    expect(
      isProjectsSnapshot(
        validSnapshot({
          projects: [validItem(), validItem({ statsStatus: "pending" })],
        }),
      ),
    ).toBe(false);
  });

  it("拒绝非 projects kind", () => {
    expect(isProjectsSnapshot(validSnapshot({ kind: "changes" }))).toBe(false);
  });
});
