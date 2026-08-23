import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEPS,
  advanceOnboarding,
  completeOnboarding,
  initialOnboardingState,
  restartOnboarding,
  skipOnboarding,
} from "../../src/webview/app/onboarding.svelte";

/*
 * v0.0.18 批次 A（C-03）：三分钟闭环引导纯逻辑。
 * 演示止步于最终确认前：事件推进只覆盖前四步，最后一步由用户确认结束，
 * 全程不出现任何执行提交的动作。
 */

describe("onboarding 纯逻辑", () => {
  it("初始状态从第一步开始", () => {
    const state = initialOnboardingState();
    expect(state).toEqual({
      completed: false,
      skipped: false,
      completedSteps: 0,
    });
    expect(ONBOARDING_STEPS.length).toBe(5);
    // 最后一步是“最终确认前结束”，文案明确不执行提交。
    expect(ONBOARDING_STEPS[4].id).toBe("before-confirm");
    expect(ONBOARDING_STEPS[4].description).toContain("不会执行任何提交");
  });

  it("按顺序推进步骤；不能跳步", () => {
    let state = initialOnboardingState();
    state = advanceOnboarding(state, "open-workbench");
    expect(state.completedSteps).toBe(1);
    // 跳到第 4 步（preview-commit）被拒绝——不强迫但也不允许跳步记录。
    const jumped = advanceOnboarding(state, "preview-commit");
    expect(jumped).toBe(state);
    state = advanceOnboarding(state, "view-changes");
    state = advanceOnboarding(state, "select-files");
    state = advanceOnboarding(state, "preview-commit");
    expect(state.completedSteps).toBe(4);
    expect(state.completed).toBe(false);
  });

  it("重复推进已完成步骤不产生变化", () => {
    let state = initialOnboardingState();
    state = advanceOnboarding(state, "open-workbench");
    expect(advanceOnboarding(state, "open-workbench")).toBe(state);
  });

  it("跳过后不再推进；完成后不再推进", () => {
    let state = advanceOnboarding(initialOnboardingState(), "open-workbench");
    state = skipOnboarding(state);
    expect(state.skipped).toBe(true);
    expect(advanceOnboarding(state, "view-changes")).toBe(state);
    const done = completeOnboarding(state);
    expect(done.completed).toBe(true);
    expect(done.completedSteps).toBe(ONBOARDING_STEPS.length);
  });

  it("重开引导清空全部进度", () => {
    const state = advanceOnboarding(initialOnboardingState(), "open-workbench");
    const skipped = skipOnboarding(state);
    expect(skipped.skipped).toBe(true);
    expect(restartOnboarding()).toEqual(initialOnboardingState());
  });
});
