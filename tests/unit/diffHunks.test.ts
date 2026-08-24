import { describe, expect, it } from "vitest";
import {
  computeDiffHunks,
  computePatchHunks,
} from "../../src/webview/features/diff/diffHunks";

describe("computeDiffHunks（v0.0.6 差异导航/逐块采用）", () => {
  it("无差异时返回空", () => {
    expect(computeDiffHunks("a\nb\n", "a\nb\n")).toEqual([]);
  });

  it("单块修改：NEW 侧行号区间正确", () => {
    const hunks = computeDiffHunks(
      "line1\nline2\nline3\n",
      "line1\nline2-changed\nline3\n",
    );
    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;
    expect(hunk.newStart).toBe(2);
    expect(hunk.newEnd).toBe(2);
    expect(hunk.oldStart).toBe(2);
    expect(hunk.oldEnd).toBe(2);
    expect(hunk.newLines).toEqual(["line2-changed"]);
    expect(hunk.oldLines).toEqual(["line2"]);
  });

  it("相邻增删合并为一个块", () => {
    const hunks = computeDiffHunks("a\nb\nc\n", "a\nx\ny\nc\n");
    expect(hunks).toHaveLength(1);
    const [hunk] = hunks;
    expect(hunk.newLines).toEqual(["x", "y"]);
    expect(hunk.oldLines).toEqual(["b"]);
    expect(hunk.newStart).toBe(2);
    expect(hunk.newEnd).toBe(3);
  });

  it("多处独立差异生成多个块", () => {
    const hunks = computeDiffHunks("a\nb\nc\nd\ne\n", "a\nB\nc\nd\nE\n");
    expect(hunks).toHaveLength(2);
    expect(hunks[0].newStart).toBe(2);
    expect(hunks[1].newStart).toBe(5);
  });

  it("行号按 NEW 侧 1-based 计（导航用）", () => {
    const hunks = computeDiffHunks("keep\nkeep\nold\n", "keep\nkeep\nnew\n");
    expect(hunks[0].newStart).toBe(3);
    expect(hunks[0].newEnd).toBe(3);
  });
});

describe("computePatchHunks（v0.1.0 修订比较导航）", () => {
  it("从多个 @@ 头解析 NEW 侧行号区间", () => {
    const patch = [
      "Index: src/a.ts",
      "===================================================================",
      "--- src/a.ts\t(revision 41)",
      "+++ src/a.ts\t(revision 42)",
      "@@ -1,3 +1,4 @@",
      " ctx",
      "-old",
      "+new",
      "@@ -20 +21,2 @@",
      " ctx",
      "+added",
    ].join("\n");
    const hunks = computePatchHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({
      newStart: 1,
      newEnd: 4,
      oldStart: 1,
      oldEnd: 3,
    });
    expect(hunks[1]).toMatchObject({
      newStart: 21,
      newEnd: 22,
      oldStart: 20,
      oldEnd: 20,
    });
  });

  it("无 @@ 头或空 patch 返回空", () => {
    expect(computePatchHunks("这不是合法 patch")).toEqual([]);
    expect(computePatchHunks("")).toEqual([]);
  });

  it("重复调用不受正则 lastIndex 残留影响", () => {
    const patch = "@@ -1 +1 @@\n-a\n+b\n";
    expect(computePatchHunks(patch)).toHaveLength(1);
    expect(computePatchHunks(patch)).toHaveLength(1);
  });
});
