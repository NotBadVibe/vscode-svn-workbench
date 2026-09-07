import { describe, expect, it } from "vitest";
import {
  isBlockingRecommendation,
  shouldShowRecommendation,
} from "../../src/webview/app/recommendationVisibility";
import type { ScopeRecommendation } from "../../src/protocol/workbenchProtocol";

/*
 * V022-R28 · 推荐下一步结合当前任务（Host 推导不变，Webview 按已有
 * moduleId/taskId 过滤；推荐只打开目标模块，不执行写操作、不扩大范围）。
 */

function commitRecommendation(): ScopeRecommendation {
  return {
    key: "commit:3",
    title: "检查建议的 3 个文件",
    reason: "当前范围有 3 个本地修改，建议逐项检查后提交。",
    actionLabel: "前往检查并提交",
    target: { moduleId: "commit", taskId: "commit/compose" },
    count: 3,
  };
}

function conflictRecommendation(): ScopeRecommendation {
  return {
    key: "conflicts:2",
    title: "处理 2 个冲突",
    reason: "当前范围有 2 个文件存在冲突，建议先处理冲突，再提交或更新。",
    actionLabel: "前往处理冲突",
    target: { moduleId: "conflicts", taskId: "conflicts/resolve" },
    count: 2,
  };
}

describe("shouldShowRecommendation", () => {
  it("提交页隐藏跳回自身的同义推荐", () => {
    expect(
      shouldShowRecommendation(commitRecommendation(), {
        moduleId: "commit",
        taskId: "commit/compose",
        dirty: false,
      }),
    ).toBe(false);
  });

  it("同模块不同任务也视为同义（如设置页内不再推设置目标）", () => {
    const settings = {
      key: "ai-unconfigured",
      title: "了解 AI 可选能力",
      reason: "尚未配置 AI 模型。",
      actionLabel: "了解 AI 可选能力",
      target: { moduleId: "settings", taskId: "settings/ai" },
    } satisfies ScopeRecommendation;
    expect(
      shouldShowRecommendation(settings, {
        moduleId: "settings",
        taskId: "settings/team",
        dirty: false,
      }),
    ).toBe(false);
  });

  it("本地修改页保留前往提交的推荐（相关任务直达）", () => {
    expect(
      shouldShowRecommendation(commitRecommendation(), {
        moduleId: "changes",
        taskId: "changes/overview",
        dirty: false,
      }),
    ).toBe(true);
  });

  it("冲突推荐在适用任务保持显著且数量由 Host 携带", () => {
    const recommendation = conflictRecommendation();
    expect(isBlockingRecommendation(recommendation)).toBe(true);
    expect(recommendation.count).toBe(2);
    for (const moduleId of ["changes", "history", "diff"] as const) {
      expect(
        shouldShowRecommendation(recommendation, {
          moduleId,
          taskId: "changes/overview",
          dirty: true,
        }),
      ).toBe(true);
    }
  });

  it("冲突页自身不重复显示处理冲突推荐", () => {
    expect(
      shouldShowRecommendation(conflictRecommendation(), {
        moduleId: "conflicts",
        taskId: "conflicts/resolve",
        dirty: false,
      }),
    ).toBe(false);
  });

  it("历史/设置/差异等只读或配置任务降低非阻止推荐", () => {
    for (const moduleId of [
      "history",
      "settings",
      "diagnostics",
      "projects",
      "activity",
      "diff",
    ] as const) {
      expect(
        shouldShowRecommendation(commitRecommendation(), {
          moduleId,
          taskId: "history/revisions",
          dirty: false,
        }),
      ).toBe(false);
    }
  });

  it("编辑脏状态不推无关跳转（提交说明/冲突草稿/差异编辑中）", () => {
    expect(
      shouldShowRecommendation(commitRecommendation(), {
        moduleId: "changes",
        taskId: "changes/overview",
        dirty: true,
      }),
    ).toBe(false);
  });

  it("无推荐时不展示", () => {
    expect(
      shouldShowRecommendation(undefined, {
        moduleId: "changes",
        taskId: "changes/overview",
        dirty: false,
      }),
    ).toBe(false);
  });

  it("推荐目标只含模块与任务，不携带路径或写操作（不扩大范围）", () => {
    const recommendation = commitRecommendation();
    expect(recommendation.target).toEqual({
      moduleId: "commit",
      taskId: "commit/compose",
    });
    expect("paths" in recommendation.target).toBe(false);
  });
});
