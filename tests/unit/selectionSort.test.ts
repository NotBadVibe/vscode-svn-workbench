import { describe, expect, it } from "vitest";
import {
  compareSelectionItems,
  fileNameOf,
  naturalCompare,
  RECOMMENDATION_ORDER,
  sortSelectionItems,
  toDefaultOrder,
  type SelectionSortable,
  type SelectionSortOptions,
} from "../../src/selection/selectionSort";
import type { SelectionKey } from "../../src/selection/selectionCore";

/** 合成测试 key：显式标记为 SelectionKey 品牌，不读取 process。 */
function key(value: string): SelectionKey {
  return value as SelectionKey;
}

function item(
  keyValue: string,
  partial: Partial<SelectionSortable> = {},
): SelectionSortable {
  return { key: key(keyValue), path: keyValue, ...partial };
}

function keysOf(items: readonly SelectionSortable[]): string[] {
  return items.map((entry) => entry.key);
}

describe("naturalCompare（大小写不敏感 + numeric）", () => {
  it("数字段按数值比较：file2 < file10 < file100", () => {
    expect(naturalCompare("file2", "file10")).toBeLessThan(0);
    expect(naturalCompare("file10", "file100")).toBeLessThan(0);
    expect(naturalCompare("file10", "file2")).toBeGreaterThan(0);
  });

  it("大小写不敏感：Repo/REPO/repo 相等", () => {
    expect(naturalCompare("Repo", "repo")).toBe(0);
    expect(naturalCompare("A.ts", "a.ts")).toBe(0);
  });

  it("中文路径按码点确定比较且大小写不影响", () => {
    expect(naturalCompare("中文.ts", "中文2.ts")).toBeLessThan(0);
    expect(naturalCompare("订单", "订单")).toBe(0);
    expect(naturalCompare("a.ts", "中文.ts")).toBeLessThan(0);
  });

  it("前缀相同且长度不同时短者在前", () => {
    expect(naturalCompare("file", "file2")).toBeLessThan(0);
    expect(naturalCompare("repo", "repo-src")).toBeLessThan(0);
  });

  it("前导零不影响数值等价", () => {
    expect(naturalCompare("file2", "file02")).toBe(0);
    expect(naturalCompare("file1", "file01")).toBe(0);
  });

  it("普通字符比较覆盖双向：反方向返回正数", () => {
    expect(naturalCompare("b.ts", "a.ts")).toBeGreaterThan(0);
    expect(naturalCompare("a.ts", "b.ts")).toBeLessThan(0);
  });

  it("一侧数字一侧普通字符时按码点比较（两个方向）", () => {
    expect(naturalCompare("a1b", "axb")).toBeLessThan(0); // '1' < 'x'
    expect(naturalCompare("axb", "a1b")).toBeGreaterThan(0); // 'x' > '1'
  });

  it("fileNameOf 对尾部分隔符的空段返回原值", () => {
    expect(fileNameOf("repo/")).toBe("repo/");
    expect(fileNameOf("C:\\repo\\")).toBe("C:\\repo\\");
  });
});

describe("sortSelectionItems（UX08-SORT-02）", () => {
  const items = [
    item("b", { path: "src/file10.ts" }),
    item("a", { path: "src/file2.ts" }),
    item("c", { path: "src/File2.ts" }),
    item("d", { path: "中文/订单.ts" }),
  ];

  it("路径 asc 用 natural compare；相等时按原始位置稳定兜底", () => {
    const options: SelectionSortOptions = { field: "path", direction: "asc" };
    const sorted = sortSelectionItems(items, options);
    // file2.ts 与 File2.ts 相等（大小写不敏感），保持输入相对顺序 a 在 c 前；
    // file2 < file10（numeric）；中文路径按码点排末尾。
    expect(keysOf(sorted)).toEqual(["a", "c", "b", "d"]);
  });

  it("路径 desc 反转已定义值次序；同值仍稳定", () => {
    const options: SelectionSortOptions = { field: "path", direction: "desc" };
    const sorted = sortSelectionItems(items, options);
    expect(keysOf(sorted)).toEqual(["d", "b", "a", "c"]);
  });

  it("fileName 缺省时取 path 最后一段，兼容反斜杠分隔", () => {
    const withFileNames = [
      item("win", { path: "C:\\repo\\src\\a.ts", fileName: "a.ts" }),
      item("nofile", { path: "repo/b.ts" }),
      item("win2", { path: "C:\\repo\\src\\b.ts" }),
    ];
    const options: SelectionSortOptions = {
      field: "fileName",
      direction: "asc",
    };
    expect(keysOf(sortSelectionItems(withFileNames, options))).toEqual([
      "win",
      "nofile",
      "win2",
    ]);
    expect(fileNameOf("C:\\repo\\src\\a.ts")).toBe("a.ts");
    expect(fileNameOf("repo/b.ts")).toBe("b.ts");
  });

  it("排序返回新数组且不修改输入、不改变 key", () => {
    const options: SelectionSortOptions = { field: "path", direction: "asc" };
    const snapshot = JSON.stringify(items);
    const sorted = sortSelectionItems(items, options);
    expect(sorted).not.toBe(items);
    expect(JSON.stringify(items)).toBe(snapshot);
    expect(sorted.map((entry) => entry.key).sort()).toEqual(
      items.map((entry) => entry.key).sort(),
    );
  });

  it("toDefaultOrder 恢复调用方原始顺序且返回新数组", () => {
    const original = [item("x"), item("y"), item("z")];
    const restored = toDefaultOrder(original);
    expect(keysOf(restored)).toEqual(["x", "y", "z"]);
    expect(restored).not.toBe(original);
  });
});

describe("状态与选择建议的产品优先级排序", () => {
  const statusOrder = ["conflicted", "modified", "added", "normal"];

  it("状态按显式优先级表排序，不按文案字典序；未知值排末尾", () => {
    const items = [
      item("normal", { status: "normal" }),
      item("unknown", { status: "奇怪状态" }),
      item("modified", { status: "modified" }),
    ];
    const options: SelectionSortOptions = {
      field: "status",
      direction: "asc",
      statusOrder,
    };
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "modified",
      "normal",
      "unknown",
    ]);
  });

  it("建议按默认产品优先级表排序（推荐 < 需确认 < 排除 < 阻止），未知值末尾", () => {
    const items = [
      item("blocked", { recommendation: "blocked" }),
      item("unknown", { recommendation: "mystery" as never }),
      item("review", { recommendation: "needsReview" }),
      item("rec", { recommendation: "recommended" }),
    ];
    const options: SelectionSortOptions = {
      field: "recommendation",
      direction: "asc",
    };
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "rec",
      "review",
      "blocked",
      "unknown",
    ]);
    expect(RECOMMENDATION_ORDER).toEqual([
      "recommended",
      "needsReview",
      "excluded",
      "blocked",
    ]);
  });

  it("降序只反转已定义值次序，未知值仍排末尾", () => {
    const items = [
      item("normal", { status: "normal" }),
      item("unknown", { status: "奇怪状态" }),
      item("modified", { status: "modified" }),
    ];
    const options: SelectionSortOptions = {
      field: "status",
      direction: "desc",
      statusOrder,
    };
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "normal",
      "modified",
      "unknown",
    ]);
  });

  it("未提供优先级表时全部状态视为未知值，稳定保持原始顺序", () => {
    const items = [
      item("a", { status: "modified" }),
      item("b", { status: "x" }),
    ];
    const options: SelectionSortOptions = {
      field: "status",
      direction: "asc",
    };
    expect(keysOf(sortSelectionItems(items, options))).toEqual(["a", "b"]);
  });
});

describe("归属排序与规模", () => {
  it("ownership 按大小写不敏感 natural compare", () => {
    const items = [
      item("b", { ownership: "EmApi" }),
      item("a", { ownership: "emapi" }),
      item("c", { ownership: "EMSys2" }),
      item("d", { ownership: "EMSys10" }),
    ];
    const options: SelectionSortOptions = {
      field: "ownership",
      direction: "asc",
    };
    // EmApi 与 emapi 相等，稳定保持输入顺序 b 在 a 前；EMSys2 < EMSys10。
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
  });

  it("ownership 缺省值按空串参与比较，未知值排末尾", () => {
    const items = [item("with", { ownership: "app" }), item("without")];
    const options: SelectionSortOptions = {
      field: "ownership",
      direction: "asc",
    };
    // 空串排在 "app" 之前（空串 < app）。
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "without",
      "with",
    ]);
    // 直接比较路径也覆盖两侧 ownership 缺省/有值的 ?? 分支。
    expect(
      compareSelectionItems(
        item("x"),
        item("y", { ownership: "app" }),
        options,
      ),
    ).toBeLessThan(0);
    // 缺省在右端：覆盖 right.ownership ?? "" 的缺省分支。
    expect(
      compareSelectionItems(
        item("y", { ownership: "app" }),
        item("x"),
        options,
      ),
    ).toBeGreaterThan(0);
  });

  it("自定义 recommendationOrder 覆盖默认表", () => {
    const items = [
      item("rec", { recommendation: "recommended" }),
      item("blocked", { recommendation: "blocked" }),
    ];
    const options: SelectionSortOptions = {
      field: "recommendation",
      direction: "asc",
      recommendationOrder: ["blocked", "recommended"],
    };
    expect(keysOf(sortSelectionItems(items, options))).toEqual([
      "blocked",
      "rec",
    ]);
  });

  it("5,000 项排序在完整数据集上执行且稳定（UX08-SEL-06）", () => {
    const items: SelectionSortable[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      items.push(item(`key-${index}`, { path: `src/file${index % 100}.ts` }));
    }
    const options: SelectionSortOptions = { field: "path", direction: "asc" };
    const sorted = sortSelectionItems(items, options);
    expect(sorted).toHaveLength(5_000);
    // 稳定性：路径 file0.ts 的 50 项（index % 100 === 0）按输入顺序在前。
    const firstGroup = sorted.slice(0, 50);
    expect(firstGroup.map((entry) => entry.key)).toEqual(
      Array.from({ length: 50 }, (_, groupIndex) => `key-${groupIndex * 100}`),
    );
    // 排序不改变任何 key 集合。
    expect(sorted.map((entry) => entry.key).sort()).toEqual(
      items.map((entry) => entry.key).sort(),
    );
  });

  it("compareSelectionItems 对未知/缺省值确定性返回", () => {
    const options: SelectionSortOptions = {
      field: "recommendation",
      direction: "asc",
    };
    // 已知值（blocked）排在未知值之前。
    expect(
      compareSelectionItems(
        item("x", { recommendation: "blocked" }),
        item("y"),
        options,
      ),
    ).toBeLessThan(0);
    // 两侧未知/缺省时相等（稳定兜底）。
    expect(compareSelectionItems(item("x"), item("y"), options)).toBe(0);
  });
});
