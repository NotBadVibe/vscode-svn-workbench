import { describe, expect, it } from "vitest";
import {
  ONBOARDING_BRANCH_COPY,
  ONBOARDING_STEPS,
  advanceOnboarding,
  completeOnboarding,
  deriveOnboardingBranch,
  initialOnboardingState,
  nextRequiredStep,
  requiredStepsForBranch,
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

/*
 * V024-R41：按工作副本状态分支。分支推导是纯函数（数字/布尔输入，与平台
 * 无关，不读取路径、不调用 SVN）；分支切换只重算下一步，不触碰选择与草稿。
 */
describe("onboarding 五态分支（V024-R41）", () => {
  it("推导五态：干净/修改/冲突/非 SVN/CLI 缺失", () => {
    expect(
      deriveOnboardingBranch({
        fileCount: 0,
        conflictedCount: 0,
        hasCommittable: false,
        cliMissing: false,
        nonSvn: false,
      }),
    ).toBe("clean");
    expect(
      deriveOnboardingBranch({
        fileCount: 3,
        conflictedCount: 0,
        hasCommittable: true,
        cliMissing: false,
        nonSvn: false,
      }),
    ).toBe("modified");
    // 冲突且无可提交项（选择→预览已不可能）才独立成支。
    expect(
      deriveOnboardingBranch({
        fileCount: 2,
        conflictedCount: 1,
        hasCommittable: false,
        cliMissing: false,
        nonSvn: false,
      }),
    ).toBe("conflict");
    expect(
      deriveOnboardingBranch({
        fileCount: 0,
        conflictedCount: 0,
        hasCommittable: false,
        cliMissing: false,
        nonSvn: true,
      }),
    ).toBe("non-svn");
    expect(
      deriveOnboardingBranch({
        fileCount: 0,
        conflictedCount: 0,
        hasCommittable: false,
        cliMissing: true,
        nonSvn: true,
      }),
    ).toBe("cli-missing");
  });

  it("优先级：CLI 缺失 > 非工作副本 > 冲突阻塞 > 干净 > 有修改", () => {
    // 有冲突但文件数为 0 仍是冲突分支（冲突文件计入候选）。
    expect(
      deriveOnboardingBranch({
        fileCount: 0,
        conflictedCount: 1,
        hasCommittable: false,
        cliMissing: false,
        nonSvn: false,
      }),
    ).toBe("conflict");
    // 冲突与可提交项并存时走修改分支（冲突文件由阻止语义隔离，
    // 默认 mock（含 1 个冲突）仍可走完选择→预览即属此态）。
    expect(
      deriveOnboardingBranch({
        fileCount: 4,
        conflictedCount: 1,
        hasCommittable: true,
        cliMissing: false,
        nonSvn: false,
      }),
    ).toBe("modified");
    // CLI 缺失压倒一切（此时文件计数不可信）。
    expect(
      deriveOnboardingBranch({
        fileCount: 5,
        conflictedCount: 2,
        hasCommittable: false,
        cliMissing: true,
        nonSvn: false,
      }),
    ).toBe("cli-missing");
  });

  it("分支必需步骤：干净/冲突跳过选择→预览，非 SVN/CLI 缺失只保留首尾", () => {
    expect(requiredStepsForBranch("modified")).toEqual(
      ONBOARDING_STEPS.map((step) => step.id),
    );
    expect(requiredStepsForBranch("clean")).toEqual([
      "open-workbench",
      "view-changes",
      "before-confirm",
    ]);
    expect(requiredStepsForBranch("conflict")).toEqual([
      "open-workbench",
      "view-changes",
      "before-confirm",
    ]);
    expect(requiredStepsForBranch("non-svn")).toEqual([
      "open-workbench",
      "before-confirm",
    ]);
    expect(requiredStepsForBranch("cli-missing")).toEqual([
      "open-workbench",
      "before-confirm",
    ]);
  });

  it("随状态变化重新计算下一步：切分支即重算，不回退已完成记录", () => {
    // 修改分支走完两步后工作副本变干净：下一步直接是最终确认。
    let state = initialOnboardingState();
    state = advanceOnboarding(state, "open-workbench");
    state = advanceOnboarding(state, "view-changes");
    expect(nextRequiredStep(state, "modified")).toBe("select-files");
    expect(nextRequiredStep(state, "clean")).toBe("before-confirm");
    expect(nextRequiredStep(state, "conflict")).toBe("before-confirm");
    expect(nextRequiredStep(state, "non-svn")).toBe("before-confirm");
    // 切回修改分支：下一步恢复为选择步骤（已完成记录未丢失）。
    expect(nextRequiredStep(state, "modified")).toBe("select-files");
    // 全部分支走完返回 undefined。
    const done = completeOnboarding(state);
    expect(nextRequiredStep(done, "clean")).toBeUndefined();
    expect(nextRequiredStep(done, "modified")).toBeUndefined();
  });

  it("干净分支无需选择与预览即可完成；完成不产生提交副作用", () => {
    let state = initialOnboardingState();
    state = advanceOnboarding(state, "open-workbench");
    state = advanceOnboarding(state, "view-changes");
    // 干净分支下一步已是最终确认：用户确认即完成，无须 select/preview。
    expect(nextRequiredStep(state, "clean")).toBe("before-confirm");
    const done = completeOnboarding(state);
    expect(done.completed).toBe(true);
    // 纯状态翻转：结果只含引导字段，不携带任何提交/写操作载荷。
    expect(Object.keys(done).sort()).toEqual([
      "completed",
      "completedSteps",
      "skipped",
    ]);
  });

  it("五态分支文案均为中文且明确是否正常、不承诺写操作", () => {
    expect(ONBOARDING_BRANCH_COPY.clean.statusLine).toContain("正常状态");
    expect(ONBOARDING_BRANCH_COPY["non-svn"].nextAction).toContain(
      "不在本引导承诺范围",
    );
    for (const branch of [
      "clean",
      "modified",
      "conflict",
      "non-svn",
      "cli-missing",
    ] as const) {
      expect(ONBOARDING_BRANCH_COPY[branch].statusLine.length).toBeGreaterThan(
        0,
      );
      // 任一分支文案不得出现执行写操作的承诺。
      expect(
        `${ONBOARDING_BRANCH_COPY[branch].statusLine}${ONBOARDING_BRANCH_COPY[branch].nextAction}`,
      ).not.toMatch(/自动提交|替你提交|一键提交/);
    }
  });
});
