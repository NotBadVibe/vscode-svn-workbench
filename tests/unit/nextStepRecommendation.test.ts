import { describe, expect, it } from "vitest";
import {
  deriveScopeRecommendation,
  recommendationInputFromSnapshot,
} from "../../src/extension/workbench/nextStepRecommendation";
import type { ChangesSnapshot } from "../../src/protocol/workbenchProtocol";

/*
 * v0.0.17 批次 C：全局推荐下一步推导（C-01/C-09）。
 * 推荐只是推荐：不替用户执行、不扩大右键范围、不自动开始写操作；
 * key 随状态变化，忽略后新状态重新展示（忽略不持久惩罚由 Webview 保证）。
 */

describe("deriveScopeRecommendation", () => {
  it("有冲突时优先推荐处理冲突并携带数量", () => {
    const recommendation = deriveScopeRecommendation({
      conflictedCount: 3,
      changedCount: 5,
      aiConfigured: true,
    });
    expect(recommendation).toMatchObject({
      key: "conflicts:3",
      title: "处理 3 个冲突",
      target: { moduleId: "conflicts", taskId: "conflicts/resolve" },
      count: 3,
    });
    expect(recommendation?.reason).toContain("3 个文件存在冲突");
  });

  it("无冲突但有本地修改时推荐检查建议提交", () => {
    const recommendation = deriveScopeRecommendation({
      conflictedCount: 0,
      changedCount: 4,
      aiConfigured: true,
    });
    expect(recommendation).toMatchObject({
      key: "commit:4",
      title: "检查建议的 4 个文件",
      target: { moduleId: "commit", taskId: "commit/compose" },
    });
  });

  it("干净且未配置 AI 时推荐了解 AI 可选能力", () => {
    const recommendation = deriveScopeRecommendation({
      conflictedCount: 0,
      changedCount: 0,
      aiConfigured: false,
    });
    expect(recommendation).toMatchObject({
      key: "ai-unconfigured",
      target: { moduleId: "settings", taskId: "settings/ai" },
    });
    // 如实说明 AI 是可选增强，不暗示核心功能依赖模型。
    expect(recommendation?.reason).toContain("核心 SVN 功能不受影响");
  });

  it("干净且已配置 AI 时推荐检查远端更新并指向独立 update 模块", () => {
    const recommendation = deriveScopeRecommendation({
      conflictedCount: 0,
      changedCount: 0,
      aiConfigured: true,
    });
    expect(recommendation).toMatchObject({
      key: "clean-check-update",
      title: "检查远端更新",
      target: { moduleId: "update", taskId: "update/preview" },
    });
  });

  it("数量变化时 key 变化，忽略后新状态仍可展示", () => {
    const before = deriveScopeRecommendation({
      conflictedCount: 2,
      changedCount: 0,
      aiConfigured: true,
    });
    const after = deriveScopeRecommendation({
      conflictedCount: 3,
      changedCount: 0,
      aiConfigured: true,
    });
    expect(before?.key).toBe("conflicts:2");
    expect(after?.key).toBe("conflicts:3");
  });
});

describe("recommendationInputFromSnapshot", () => {
  const changesSnapshot: ChangesSnapshot = {
    kind: "changes",
    commitDraft: "",
    files: [],
    summary: { modified: 2, added: 1, conflicted: 1, unversioned: 3 },
    refreshedAt: "2026-08-23T10:00:00.000Z",
  };

  it("changes 快照按状态计数推导且 unversioned 不计入可提交变更", () => {
    const input = recommendationInputFromSnapshot(
      changesSnapshot,
      true,
      undefined,
    );
    expect(input).toEqual({
      conflictedCount: 1,
      changedCount: 3,
      totalCandidates: 7,
      aiConfigured: true,
    });
  });

  it("update 快照读取冲突计数；采集失败沿用上次输入", () => {
    const previous = {
      conflictedCount: 1,
      changedCount: 2,
      totalCandidates: 5,
      aiConfigured: true,
    };
    const fromUpdate = recommendationInputFromSnapshot(
      {
        kind: "update",
        info: { name: "repo" },
        conflicts: { count: 5, paths: [] },
      },
      true,
      previous,
    );
    expect(fromUpdate?.conflictedCount).toBe(5);
    const failed = recommendationInputFromSnapshot(
      {
        kind: "update",
        info: { name: "repo" },
        conflicts: { count: 0, paths: [], error: "采集失败" },
      },
      true,
      previous,
    );
    expect(failed).toBe(previous);
  });

  it("不携带候选信息的快照沿用上次输入，避免为推荐额外采集 SVN 状态", () => {
    const previous = {
      conflictedCount: 1,
      changedCount: 2,
      totalCandidates: 5,
      aiConfigured: true,
    };
    const input = recommendationInputFromSnapshot(
      { kind: "settings" } as never,
      true,
      previous,
    );
    expect(input).toBe(previous);
    const withoutPrevious = recommendationInputFromSnapshot(
      { kind: "settings" } as never,
      true,
      undefined,
    );
    expect(withoutPrevious).toBeUndefined();
  });
});
