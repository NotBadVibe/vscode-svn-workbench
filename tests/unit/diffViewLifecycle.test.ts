import { describe, expect, it } from "vitest";
import {
  shouldRebuildDiffView,
  type DiffViewMountState,
  type DiffViewNextRender,
} from "../../src/webview/features/diff/diffViewLifecycle";

/** 测试共享容器：保持/重建比较默认基于同一容器，容器切换用例显式换新。 */
const sharedContainer = document.createElement("div");

function mountState(
  overrides: Partial<DiffViewMountState> = {},
): DiffViewMountState {
  return {
    key: "src/extension.ts|typescript|true|split|false",
    mode: "edit",
    container: sharedContainer,
    oldContents: "old",
    newContents: "new",
    patch: undefined,
    ...overrides,
  };
}

function next(overrides: Partial<DiffViewNextRender> = {}): DiffViewNextRender {
  return {
    key: "src/extension.ts|typescript|true|split|false",
    container: sharedContainer,
    oldContents: "old",
    newContents: "new",
    patch: undefined,
    ...overrides,
  };
}

describe("shouldRebuildDiffView（v0.0.6 手动生命周期重建决策）", () => {
  it("未挂载时必须挂载", () => {
    expect(shouldRebuildDiffView(undefined, next())).toBe(true);
  });

  it("编辑态同键同容器内容变化：保持不重建（保存后快照刷新不丢输入）", () => {
    const m = mountState();
    expect(
      shouldRebuildDiffView(m, next({ newContents: "new（已保存）" })),
    ).toBe(false);
  });

  it("编辑态同键同容器内容不变：保持", () => {
    expect(shouldRebuildDiffView(mountState(), next())).toBe(false);
  });

  it("只读态同键同容器内容不变：保持", () => {
    const m = mountState({ mode: "read" });
    expect(shouldRebuildDiffView(m, next())).toBe(false);
  });

  it("只读态内容变化（old）必须重建", () => {
    const m = mountState({ mode: "read" });
    expect(shouldRebuildDiffView(m, next({ oldContents: "old2" }))).toBe(true);
  });

  it("只读态内容变化（new）必须重建", () => {
    const m = mountState({ mode: "read" });
    expect(shouldRebuildDiffView(m, next({ newContents: "new2" }))).toBe(true);
  });

  it("只读态内容变化（patch 直渲）必须重建", () => {
    const m = mountState({ mode: "read", patch: "p1" });
    expect(shouldRebuildDiffView(m, next({ patch: "p2" }))).toBe(true);
  });

  it("挂载键变化（目标/编辑态/视图控件）必须重建", () => {
    const m = mountState();
    expect(
      shouldRebuildDiffView(
        m,
        next({ key: "other|typescript|true|split|false" }),
      ),
    ).toBe(true);
  });

  it("容器身份变化（即使同键同内容）必须重建并清理旧容器", () => {
    const m = mountState();
    const fresh = document.createElement("div");
    expect(shouldRebuildDiffView(m, next({ container: fresh }))).toBe(true);
  });

  it("内容逐字段比较：字符串拼接表达下的碰撞不误判为保持", () => {
    // 旧实现用 `|` 拼接 contentKey：old="a|b" new="c" 与 old="a" new="b|c"
    // 会拼出相同的 "a|b|c" 而漏重建；逐字段比较必须识别差异。
    const m = mountState({
      mode: "read",
      oldContents: "a|b",
      newContents: "c",
      patch: "d",
    });
    expect(
      shouldRebuildDiffView(
        m,
        next({ oldContents: "a", newContents: "b|c", patch: "d" }),
      ),
    ).toBe(true);
    // 三字段逐项不等均触发重建。
    expect(shouldRebuildDiffView(m, next({ patch: "e" }))).toBe(true);
  });
});
