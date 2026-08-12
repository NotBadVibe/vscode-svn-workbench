import { describe, expect, it } from "vitest";
import { computeDiffHunks } from "../../src/webview/features/diff/diffHunks";

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
