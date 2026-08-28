import { describe, expect, it } from "vitest";
import {
  hashText,
  buildConflictFileIdentity,
  parseConflictRegions,
} from "../../src/conflict/conflictDiffModel";
import {
  applyConflictResolution,
  isStaleConflictAction,
  isStaleByText,
} from "../../src/conflict/conflictResolution";
import {
  SVN_SINGLE,
  MULTI_BLOCK,
  CRLF_SINGLE,
  NO_BASE,
  LONG_LINE,
  DAMAGED_MISSING_SEPARATOR,
  DAMAGED_MISSING_END,
} from "../../src/conflict/fixtures";

describe("受控就地三动作（V011-C）", () => {
  it("current 采用我的修改：替换为 mine 段", () => {
    const r = applyConflictResolution(SVN_SINGLE, 0, "current");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.newText).toContain('mineValue = "我的修改-本地"');
    expect(r.newText).not.toContain("<<<<<<<");
    expect(r.newText).not.toContain("=======");
    expect(r.newText).not.toContain(">>>>>>>");
    expect(r.newText).not.toContain('theirsValue = "对方修改');
  });
  it("incoming 采用对方修改：替换为 theirs 段", () => {
    const r = applyConflictResolution(SVN_SINGLE, 0, "incoming");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.newText).toContain('theirsValue = "对方修改-仓库r128"');
    expect(r.newText).not.toContain("mineValue");
  });
  it("both 保留双方修改：先我的后对方", () => {
    const r = applyConflictResolution(SVN_SINGLE, 0, "both");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    const idxMine = r.newText.indexOf("mineValue");
    const idxTheirs = r.newText.indexOf("theirsValue");
    expect(idxMine).toBeGreaterThan(-1);
    expect(idxTheirs).toBeGreaterThan(-1);
    expect(idxMine).toBeLessThan(idxTheirs);
    // Tooltip 已说明顺序，这里断言顺序稳定
  });
  it("多块连续操作：逐块应用互不干扰", () => {
    let text = MULTI_BLOCK;
    const r1 = applyConflictResolution(text, 0, "current");
    expect("error" in r1).toBe(false);
    if ("error" in r1) return;
    text = r1.newText;
    expect(text).toContain("block1Mine");
    const r2 = applyConflictResolution(text, 0, "incoming"); // 原第1块已消除，原第2块变为索引0
    expect("error" in r2).toBe(false);
    if ("error" in r2) return;
    expect(r2.newText).toContain("block2Theirs");
    // 剩余块数应递减
    const parsed = parseConflictRegions(r2.newText);
    expect(parsed.regions.length).toBe(1);
  });
  it("过期拒绝：identity 或 hash 不匹配即 stale", () => {
    const idA = buildConflictFileIdentity("/repo", "src/a.ts");
    const idB = buildConflictFileIdentity("/repo", "src/b.ts");
    const hashA = hashText(SVN_SINGLE);
    const hashB = hashText(SVN_SINGLE + "\n// changed");
    expect(isStaleConflictAction(idA, hashA, idA, hashA)).toBe(false);
    expect(isStaleConflictAction(idA, hashA, idB, hashA)).toBe(true);
    expect(isStaleConflictAction(idA, hashA, idA, hashB)).toBe(true);
    expect(isStaleByText(idA, hashA, idA, SVN_SINGLE)).toBe(false);
    expect(isStaleByText(idA, hashA, idA, SVN_SINGLE + "\n// changed")).toBe(
      true,
    );
  });
  it("损坏输入 fail-closed：返回结构化错误", () => {
    const a = applyConflictResolution(DAMAGED_MISSING_SEPARATOR, 0, "current");
    expect("error" in a).toBe(true);
    const b = applyConflictResolution(DAMAGED_MISSING_END, 0, "incoming");
    expect("error" in b).toBe(true);
    const c = applyConflictResolution(SVN_SINGLE, 99, "both");
    expect("error" in c).toBe(true);
  });
  it("CRLF/无BASE/超长行均可正确应用", () => {
    for (const t of [CRLF_SINGLE, NO_BASE, LONG_LINE]) {
      const r = applyConflictResolution(t, 0, "current");
      expect("error" in r).toBe(false);
    }
  });
  it("payload 字段完整性：应用后返回新 hash 与 region 行号", () => {
    const r = applyConflictResolution(SVN_SINGLE, 0, "both");
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.appliedRegion.startLine).toBeGreaterThanOrEqual(0);
    expect(r.newHash).toBe(hashText(r.newText));
  });
});
