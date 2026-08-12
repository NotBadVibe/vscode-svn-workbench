import { describe, expect, it } from "vitest";
import {
  resolveDiffSwitchDecision,
  shouldConfirmTargetSwitch,
} from "../../src/extension/workbench/diffTargetSwitch";

/*
 * v0.0.6 验收回归：目标切换三选一决定的授权绑定。
 * save 决定的 targetId 必须精确等于 Host 挂起确认时的 currentTargetId，
 * 不允许 Webview 指定同 scope 内任意其他草稿目标驱动 saveDraft。
 */
describe("diffTargetSwitch 决定授权绑定", () => {
  it("save 决定携带匹配 targetId 时放行", () => {
    expect(resolveDiffSwitchDecision("t-current", "save", "t-current")).toEqual(
      { kind: "save", targetId: "t-current" },
    );
  });

  it("save 决定携带恶意/陈旧 targetId 时拒绝（不驱动 saveDraft）", () => {
    const result = resolveDiffSwitchDecision("t-current", "save", "t-other");
    expect(result.kind).toBe("reject");
    // 缺失 targetId 同样拒绝。
    expect(resolveDiffSwitchDecision("t-current", "save", undefined).kind).toBe(
      "reject",
    );
  });

  it("stash/stay/未知决定不触碰草稿保存链", () => {
    expect(resolveDiffSwitchDecision("t-current", "stash", undefined)).toEqual({
      kind: "stash",
    });
    expect(resolveDiffSwitchDecision("t-current", "stay", undefined)).toEqual({
      kind: "stay",
    });
    expect(resolveDiffSwitchDecision("t-current", "bogus", undefined)).toEqual({
      kind: "stay",
    });
  });
});

describe("目标切换确认守卫（仅真正可能丢内容时才拦截）", () => {
  it("脏草稿必须确认", () => {
    expect(
      shouldConfirmTargetSwitch({
        hasDraft: true,
        draftDirty: true,
        hasActiveSession: false,
      }),
    ).toBe(true);
  });

  it("干净草稿但编辑会话仍活动必须确认（debounce 检查点可能未达）", () => {
    expect(
      shouldConfirmTargetSwitch({
        hasDraft: true,
        draftDirty: false,
        hasActiveSession: true,
      }),
    ).toBe(true);
  });

  it("干净草稿且无活动会话不确认（不产生无谓确认往返）", () => {
    expect(
      shouldConfirmTargetSwitch({
        hasDraft: true,
        draftDirty: false,
        hasActiveSession: false,
      }),
    ).toBe(false);
  });

  it("无草稿不确认", () => {
    expect(
      shouldConfirmTargetSwitch({
        hasDraft: false,
        draftDirty: false,
        hasActiveSession: false,
      }),
    ).toBe(false);
  });
});
