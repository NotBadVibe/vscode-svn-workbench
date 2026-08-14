import { describe, expect, it } from "vitest";
import {
  actionableKeys,
  clearHiddenSelection,
  computeTriState,
  countHiddenSelection,
  emptySelection,
  filterOnlySelected,
  hiddenSelectionKeys,
  isActionable,
  mergeRecommendedSelection,
  toggleActionable,
  type SelectableItem,
  type SelectionKey,
} from "../../src/selection/selectionCore";

/**
 * 合成测试 key：测试夹具显式把普通字符串标记为 SelectionKey（品牌），
 * 不引入 nativePathSemantics、不读取 process；不代表真实路径。
 */
function key(value: string): SelectionKey {
  return value as SelectionKey;
}

function item(
  value: string,
  extra: Partial<SelectableItem> = {},
): SelectableItem {
  return { key: key(value), actionable: true, ...extra };
}

function keysOf(iterable: Iterable<SelectionKey>): string[] {
  return [...iterable].sort();
}

describe("可操作项与三态（UX08-SEL-01）", () => {
  it("actionability 是调用方权威输入：excluded 默认不作为可操作（Commit 语义）", () => {
    // Commit 调用方：excluded 且 actionable=false -> 不可被批量选择。
    expect(isActionable(item("e", { actionable: false, excluded: true }))).toBe(
      false,
    );
    // 允许的非提交动作：excluded 且 actionable=true -> 可被明确选择。
    expect(isActionable(item("e", { actionable: true, excluded: true }))).toBe(
      true,
    );
  });

  it("blocked 是二次 fail-closed：即使 actionable=true 也不可操作", () => {
    expect(isActionable(item("b", { actionable: true, blocked: true }))).toBe(
      false,
    );
    expect(isActionable(item("b", { actionable: false, blocked: true }))).toBe(
      false,
    );
  });

  it("needsReview 可由调用方明确 actionable=true 且保持标记", () => {
    const review = item("r", { actionable: true, needsReview: true });
    expect(isActionable(review)).toBe(true);
    expect(review.needsReview).toBe(true);
  });

  it("三态只基于当前筛选可操作项：空集合与无可操作项均为 none", () => {
    expect(computeTriState([], new Set())).toBe("none");
    expect(
      computeTriState(
        [item("a", { actionable: false, blocked: true })],
        new Set([key("a")]),
      ),
    ).toBe("none");
  });

  it("全部可操作项已选为 all；部分为 partial；无一为 none", () => {
    const visible = [
      item("a"),
      item("b"),
      item("c", { actionable: true, blocked: true }),
    ];
    expect(computeTriState(visible, new Set())).toBe("none");
    expect(computeTriState(visible, new Set([key("a")]))).toBe("partial");
    expect(computeTriState(visible, new Set([key("a"), key("b")]))).toBe("all");
    // blocked 项已选与否都不影响三态。
    expect(computeTriState(visible, new Set([key("c")]))).toBe("none");
    // 调用方判定为当前动作不可操作的 excluded 不参与三态。
    expect(
      computeTriState(
        [item("a"), item("e", { actionable: false, excluded: true })],
        new Set([key("a"), key("e")]),
      ),
    ).toBe("all");
  });

  it("隐藏选择不参与三态计算", () => {
    const visible = [item("a")];
    expect(computeTriState(visible, new Set([key("a"), key("hidden")]))).toBe(
      "all",
    );
  });

  it("actionableKeys 返回新 Set 且不修改入参", () => {
    const visible = [item("a"), item("b", { actionable: true, blocked: true })];
    expect(keysOf(actionableKeys(visible))).toEqual(["a"]);
    expect(visible.map((entry) => entry.key)).toEqual([key("a"), key("b")]);
  });
});

describe("表头 toggle（UX08-SEL-02）", () => {
  it("none -> 全选本次可操作项；all -> 取消本次可操作项", () => {
    const visible = [item("a"), item("b")];
    const all = toggleActionable(visible, emptySelection());
    expect(keysOf(all)).toEqual(["a", "b"]);
    expect(keysOf(toggleActionable(visible, all))).toEqual([]);
  });

  it("partial -> 全选本次可操作项，保留既有选择", () => {
    const visible = [item("a"), item("b")];
    const next = toggleActionable(visible, new Set([key("a")]));
    expect(keysOf(next)).toEqual(["a", "b"]);
  });

  it("blocked 与不可操作项永不被批量加入或移除", () => {
    const visible = [
      item("a"),
      item("b", { actionable: true, blocked: true }),
      item("e", { actionable: false, excluded: true }),
    ];
    const next = toggleActionable(visible, emptySelection());
    expect(keysOf(next)).toEqual(["a"]);
    expect(
      keysOf(
        toggleActionable(visible, new Set([key("a"), key("b"), key("e")])),
      ),
    ).toEqual(["b", "e"]);
  });

  it("筛选外隐藏选择保留；新出现项不会因过去全选自动加入", () => {
    const firstSnapshot = [item("a"), item("b")];
    const selected = toggleActionable(firstSnapshot, emptySelection());
    // 新筛选：a 隐藏、b 隐藏、新增 c。
    const secondSnapshot = [item("c")];
    const next = toggleActionable(secondSnapshot, selected);
    expect(keysOf(next)).toEqual(["a", "b", "c"]);
    // 不点击表头时，新文件绝不自动加入。
    expect(keysOf(selected)).toEqual(["a", "b"]);
  });
});

describe("推荐初始化/合并（UX08-SEL-02/05）", () => {
  it("只加入 recommended 且可操作项；blocked/excluded/needsReview 不加入", () => {
    const visible = [
      item("rec", { recommended: true }),
      item("blocked", { recommended: true, actionable: true, blocked: true }),
      item("excluded", { recommended: true, excluded: true }),
      item("review", { recommended: true, needsReview: true }),
      item("notActionable", { recommended: true, actionable: false }),
      item("plain"),
    ];
    expect(
      keysOf(mergeRecommendedSelection(visible, emptySelection())),
    ).toEqual(["rec"]);
  });

  it("用户手动保留项不被覆盖或移除（只加不减）", () => {
    const visible = [
      item("rec", { recommended: true }),
      item("manual", { recommended: false }),
    ];
    const selected = new Set([key("manual"), key("hidden")]);
    expect(keysOf(mergeRecommendedSelection(visible, selected))).toEqual([
      "hidden",
      "manual",
      "rec",
    ]);
  });
});

describe("隐藏选择（UX08-SEL-03）", () => {
  const visible = [item("a"), item("b")];
  const selected = new Set([key("a"), key("c"), key("d")]);

  it("hiddenSelectionKeys/count 只含已选但不可见的 key", () => {
    expect(keysOf(hiddenSelectionKeys(visible, selected))).toEqual(["c", "d"]);
    expect(countHiddenSelection(visible, selected)).toBe(2);
  });

  it("clearHiddenSelection 返回 selected ∩ 可见，不修改入参", () => {
    expect(keysOf(clearHiddenSelection(visible, selected))).toEqual(["a"]);
    expect(keysOf(selected)).toEqual(["a", "c", "d"]);
  });

  it("filterOnlySelected 返回可见且已选项，保持可见顺序", () => {
    const visibleOrdered = [item("b"), item("a"), item("z")];
    expect(
      filterOnlySelected(visibleOrdered, new Set([key("a"), key("z")])).map(
        (entry) => entry.key,
      ),
    ).toEqual([key("a"), key("z")]);
  });
});

describe("输入不变异与规模（UX08-SEL-06）", () => {
  it("5,000 项全选与清空覆盖完整数据，不依赖 DOM", () => {
    const visible: SelectableItem[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      visible.push(item(`file-${index}`));
    }
    const selected = toggleActionable(visible, emptySelection());
    expect(selected.size).toBe(5_000);
    expect(toggleActionable(visible, selected).size).toBe(0);
  });

  it("所有集合函数不修改入参 Set/数组", () => {
    const visible = [item("a"), item("b", { actionable: true, blocked: true })];
    const selected = new Set([key("a"), key("hidden")]);
    const visibleSnapshot = JSON.stringify(visible);
    const selectedSnapshot = keysOf(selected);
    computeTriState(visible, selected);
    toggleActionable(visible, selected);
    mergeRecommendedSelection(visible, selected);
    hiddenSelectionKeys(visible, selected);
    countHiddenSelection(visible, selected);
    clearHiddenSelection(visible, selected);
    filterOnlySelected(visible, selected);
    expect(JSON.stringify(visible)).toBe(visibleSnapshot);
    expect(keysOf(selected)).toEqual(selectedSnapshot);
  });
});
