import { describe, expect, it } from "vitest";
import {
  refreshSelectionSet,
  type RefreshedSelectionItem,
} from "../../src/selection/selectionRefresh";
import type { SelectionKey } from "../../src/selection/selectionCore";

/** 合成测试 key：显式标记为 SelectionKey 品牌，不读取 process。 */
function key(value: string): SelectionKey {
  return value as SelectionKey;
}

function keysOf(iterable: Iterable<SelectionKey>): string[] {
  return [...iterable].sort();
}

describe("刷新合法交集（UX08-SEL-04）", () => {
  it("只保留 selected ∩ 刷新后保留项，返回新集合", () => {
    const selected = new Set([key("a"), key("b"), key("gone")]);
    const refreshed: RefreshedSelectionItem[] = [
      { key: "a", retained: true },
      { key: "b", retained: true },
    ];
    const outcome = refreshSelectionSet(selected, refreshed);
    expect(keysOf(outcome.selected)).toEqual(["a", "b"]);
    expect(outcome.removed).toEqual([
      { key: key("gone"), reason: "已从工作副本快照中消失" },
    ]);
    // 旧集合不变。
    expect(keysOf(selected)).toEqual(["a", "b", "gone"]);
  });

  it("候选中的新文件绝不自动加入", () => {
    const selected = new Set([key("a")]);
    const refreshed: RefreshedSelectionItem[] = [
      { key: "a", retained: true },
      { key: "brand-new", retained: true },
    ];
    expect(keysOf(refreshSelectionSet(selected, refreshed).selected)).toEqual([
      "a",
    ]);
  });

  it("blocked/不可操作项按调用方判定移除并保留结构化原因", () => {
    const selected = new Set([key("a"), key("b"), key("c")]);
    const refreshed: RefreshedSelectionItem[] = [
      { key: "a", retained: true },
      { key: "b", retained: false, removalReason: "已变为阻止项" },
      { key: "c", retained: false, removalReason: "已越出操作范围" },
    ];
    const outcome = refreshSelectionSet(selected, refreshed);
    expect(keysOf(outcome.selected)).toEqual(["a"]);
    expect(outcome.removed).toEqual([
      { key: "b", reason: "已变为阻止项" },
      { key: "c", reason: "已越出操作范围" },
    ]);
  });

  it("retained=false 未提供原因时使用统一默认原因", () => {
    const selected = new Set([key("a")]);
    const refreshed: RefreshedSelectionItem[] = [{ key: "a", retained: false }];
    expect(refreshSelectionSet(selected, refreshed).removed).toEqual([
      { key: "a", reason: "状态已变化，不再可操作" },
    ]);
  });

  it("空集合与空快照确定返回", () => {
    expect(refreshSelectionSet(new Set(), []).removed).toEqual([]);
    expect(keysOf(refreshSelectionSet(new Set(), []).selected)).toEqual([]);
    const outcome = refreshSelectionSet(new Set([key("a")]), []);
    expect(outcome.removed).toEqual([
      { key: key("a"), reason: "已从工作副本快照中消失" },
    ]);
  });

  it("重复 identity 是数据完整性异常：无论顺序与 retained 组合都 fail-closed", () => {
    // 先 true 后 false：后到 unsafe 不得被掩盖。
    expect(
      refreshSelectionSet(new Set([key("a")]), [
        { key: key("a"), retained: true },
        { key: key("a"), retained: false, removalReason: "后到 unsafe" },
      ]).removed,
    ).toEqual([
      { key: key("a"), reason: "刷新快照存在重复身份，已安全取消选择" },
    ]);
    // 先 false 后 true：先到 unsafe 也不得保留。
    expect(
      refreshSelectionSet(new Set([key("a")]), [
        { key: key("a"), retained: false },
        { key: key("a"), retained: true },
      ]).selected.size,
    ).toBe(0);
    // 两个 true 同样不得保留。
    expect(
      refreshSelectionSet(new Set([key("a")]), [
        { key: key("a"), retained: true },
        { key: key("a"), retained: true },
      ]).selected.size,
    ).toBe(0);
    // 未选中的重复 key 不产生选择（新文件仍不自动加入）。
    expect(
      refreshSelectionSet(new Set(), [
        { key: key("a"), retained: true },
        { key: key("a"), retained: true },
      ]).selected.size,
    ).toBe(0);
  });

  it("5,000 项刷新交集覆盖完整数据（UX08-SEL-06）", () => {
    const selected = new Set<SelectionKey>();
    const refreshed: RefreshedSelectionItem[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      selected.add(key(`file-${index}`));
      refreshed.push({
        key: key(`file-${index}`),
        retained: index % 3 !== 0,
        removalReason: index % 3 === 0 ? "已消失" : undefined,
      });
    }
    const outcome = refreshSelectionSet(selected, refreshed);
    expect(outcome.selected.size).toBe(3_333);
    expect(outcome.removed).toHaveLength(1_667);
  });
});
