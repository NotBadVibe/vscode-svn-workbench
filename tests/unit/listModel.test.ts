import { describe, expect, it } from "vitest";
import {
  FILE_STATUS_ORDER,
  displayPathOf,
  fileNameOf,
  matchesFileQuery,
  middleEllipsis,
  moveActiveIndex,
  edgeActiveIndex,
  rangeItems,
  shouldHandleListKeydown,
  splitPathForCell,
} from "../../src/webview/components/list/listModel";
import {
  describeSelectionChange,
  summarizeSelectionChange,
} from "../../src/commit/selectionChangeSummary";

describe("列表底座纯逻辑（v0.0.8）", () => {
  it("中部省略保留文件名、扩展名与辨识目录", () => {
    expect(middleEllipsis("src/a.ts", 48)).toBe("src/a.ts");
    const long = "src/very/long/sequence/of/directories/module/file.ts";
    const result = middleEllipsis(long, 30);
    expect(result).toContain("…");
    expect(result.endsWith("file.ts")).toBe(true);
    expect(result.length).toBeLessThan(long.length);
    // 靠近文件的目录优先保留。
    expect(result).toContain("module");
    // 单段长文件名：中部省略保留扩展名，不以末尾省略号丢扩展名。
    const single = middleEllipsis("a".repeat(60) + ".ts", 20);
    expect(single).toContain("…");
    expect(single.endsWith(".ts")).toBe(true);
    expect(single.length).toBeLessThanOrEqual(20);
    expect(single.startsWith("a")).toBe(true);
  });

  it("拆分两行展示：文件名 + 项目内父目录", () => {
    expect(splitPathForCell("src/app/index.ts")).toEqual({
      fileName: "index.ts",
      parentPath: "src/app",
    });
    expect(splitPathForCell("file.ts")).toEqual({
      fileName: "file.ts",
      parentPath: "",
    });
  });

  it("搜索匹配项目内路径、文件名、状态与归属", () => {
    const file = {
      relativePath: "app/src/index.ts",
      projectRelativePath: "src/index.ts",
      projectName: "app",
      status: "modified",
    } as never;
    expect(matchesFileQuery(file, "src/index")).toBe(true);
    expect(matchesFileQuery(file, "index.ts")).toBe(true);
    expect(matchesFileQuery(file, "已修改")).toBe(true);
    expect(matchesFileQuery(file, "app")).toBe(true);
    expect(matchesFileQuery(file, "不存在")).toBe(false);
    expect(matchesFileQuery(file, "  ")).toBe(true);
  });

  it("键盘导航夹紧边界并支持翻页与首尾", () => {
    expect(moveActiveIndex(-1, 1, 10)).toBe(0);
    expect(moveActiveIndex(0, -1, 10)).toBe(0);
    expect(moveActiveIndex(9, 1, 10)).toBe(9);
    expect(moveActiveIndex(5, 1, 0)).toBe(-1);
    expect(edgeActiveIndex("home", 5)).toBe(0);
    expect(edgeActiveIndex("end", 5)).toBe(4);
  });

  it("Shift 连续选择返回有序区间", () => {
    const items = ["a", "b", "c", "d"];
    expect(rangeItems(items, 1, 3)).toEqual(["b", "c", "d"]);
    expect(rangeItems(items, 3, 1)).toEqual(["b", "c", "d"]);
    expect(rangeItems(items, -1, 2)).toEqual([]);
  });

  it("IME 候选与文本输入不触发列表快捷键", () => {
    const composing = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(composing, "isComposing", { value: true });
    expect(shouldHandleListKeydown(composing)).toBe(false);
    const input = document.createElement("input");
    const inInput = new KeyboardEvent("keydown", { key: "a" });
    Object.defineProperty(inInput, "target", { value: input });
    expect(shouldHandleListKeydown(inInput)).toBe(false);
  });

  it("状态优先级表冲突在前", () => {
    expect(FILE_STATUS_ORDER[0]).toBe("conflicted");
    expect(FILE_STATUS_ORDER).toContain("modified");
  });

  it("displayPathOf/fileNameOf 语义稳定", () => {
    expect(
      displayPathOf({
        relativePath: "app/a.ts",
        projectRelativePath: "a.ts",
      } as never),
    ).toBe("a.ts");
    expect(displayPathOf({ relativePath: "app/a.ts" } as never)).toBe(
      "app/a.ts",
    );
    expect(fileNameOf("a/b/c.ts")).toBe("c.ts");
  });
});

describe("选择变更摘要（v0.0.8）", () => {
  it("统计新增、保留与移除的手动选择", () => {
    expect(summarizeSelectionChange(["a", "b", "c"], ["b", "c", "d"])).toEqual({
      added: 1,
      kept: 2,
      removed: 1,
    });
    expect(describeSelectionChange(["a"], ["a", "b"])).toBe(
      "新增 1 个、保留 1 个手动选择、移除 0 个",
    );
  });
});
