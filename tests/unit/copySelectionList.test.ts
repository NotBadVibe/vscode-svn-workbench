import { describe, expect, it } from "vitest";
import {
  buildPathListText,
  buildStatusPathListText,
  orderSelectedForCopy,
} from "../../src/webview/components/list/copySelectionList";

/*
 * V023-R24：复制清单共享纯逻辑回归。
 * 顺序=当前列表一致、隐藏稳定追加、无身份键、可辨识跨项目同名。
 */

describe("V023-R24 copySelectionList", () => {
  it("可见已选保持列表顺序，隐藏按相对路径稳定追加", () => {
    const list = [
      { relativePath: "b.ts", status: "modified" },
      { relativePath: "a.ts", status: "added" },
      { relativePath: "c.ts", status: "modified" },
    ];
    const ordered = orderSelectedForCopy(
      list,
      list,
      new Set(["c.ts", "a.ts", "hidden/z.ts"]),
    );
    // 可见部分保持列表顺序（a 在 c 前），隐藏追加。
    expect(ordered.map((item) => item.relativePath)).toEqual(["a.ts", "c.ts"]);
    const withHidden = orderSelectedForCopy(
      list,
      [...list, { relativePath: "hidden/z.ts", status: "modified" }],
      new Set(["c.ts", "a.ts", "hidden/z.ts"]),
    );
    expect(withHidden.map((item) => item.relativePath)).toEqual([
      "a.ts",
      "c.ts",
      "hidden/z.ts",
    ]);
  });

  it("只复制相对展示路径，不含身份键/绝对路径", () => {
    const text = buildPathListText([
      {
        relativePath: "src/中文 文件#.ts",
        projectRelativePath: "src/中文 文件#.ts",
        status: "modified",
      },
    ]);
    expect(text).toBe("src/中文 文件#.ts");
    expect(text).not.toContain("test-wc::");
    expect(text).not.toContain("/Users/");
  });

  it("同名跨项目加前缀可辨识", () => {
    const text = buildPathListText([
      {
        relativePath: "proj-a/src/app.ts",
        projectRelativePath: "src/app.ts",
        projectName: "proj-a",
        status: "modified",
      },
      {
        relativePath: "proj-b/src/app.ts",
        projectRelativePath: "src/app.ts",
        projectName: "proj-b",
        status: "modified",
      },
    ]);
    expect(text).toContain("proj-a/src/app.ts");
    expect(text).toContain("proj-b/src/app.ts");
  });

  it("状态+路径清单使用中文状态", () => {
    const text = buildStatusPathListText([
      { relativePath: "a.ts", status: "modified" },
    ]);
    expect(text).toBe("已修改 a.ts");
  });
});
