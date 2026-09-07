import { describe, expect, it } from "vitest";
import {
  canToggleIgnoreWhitespace,
  canToggleShowWhitespace,
  expandWhitespaceForPreview,
  hasWhitespaceOnlyDifferences,
  isWhitespaceOnlyConflictBlock,
  isWhitespaceOnlyHunk,
  linesEqualIgnoringWhitespace,
  normalizeLineForCompare,
  normalizeTextForCompare,
  segmentLineWhitespace,
  splitHunksByWhitespace,
  WHITESPACE_VIEW_SUPPORT,
} from "../../src/webview/features/diff/diffWhitespace";
import type { DiffHunk } from "../../src/webview/features/diff/diffHunks";

function makeHunk(oldLines: string[], newLines: string[]): DiffHunk {
  return {
    newStart: 1,
    newEnd: Math.max(1, newLines.length),
    oldStart: 1,
    oldEnd: Math.max(1, oldLines.length),
    newLines,
    oldLines,
  };
}

describe("diffWhitespace 空白选项纯逻辑（V018-D §4.4）", () => {
  it("行归一折叠空格并去首尾", () => {
    expect(normalizeLineForCompare("  a   b\tc  ")).toBe("a b c");
    expect(normalizeLineForCompare("   ")).toBe("");
  });

  it("整段归一保持行数不变", () => {
    const out = normalizeTextForCompare("a  b\n  c\t d \n");
    expect(out.split("\n")).toHaveLength(3);
    expect(out).toBe("a b\nc d\n");
  });

  it("仅空白差异的行比较", () => {
    expect(linesEqualIgnoringWhitespace("a  b", "a\tb")).toBe(true);
    expect(linesEqualIgnoringWhitespace("a b", "a c")).toBe(false);
  });

  it("纯空白块判定（含纯空白行增删）", () => {
    expect(isWhitespaceOnlyHunk(makeHunk(["a  b"], ["a\tb"]))).toBe(true);
    expect(isWhitespaceOnlyHunk(makeHunk(["a"], ["b"]))).toBe(false);
    expect(isWhitespaceOnlyHunk(makeHunk([""], ["   "]))).toBe(true);
  });

  it("splitHunksByWhitespace 只过滤纯空白块", () => {
    const hunks = [makeHunk(["a"], ["b"]), makeHunk(["x  y"], ["x\ty"])];
    const { visible, ignoredWhitespaceCount } = splitHunksByWhitespace(hunks);
    expect(visible).toHaveLength(1);
    expect(ignoredWhitespaceCount).toBe(1);
    expect(hasWhitespaceOnlyDifferences(hunks)).toBe(true);
    expect(hasWhitespaceOnlyDifferences([hunks[0]])).toBe(false);
  });

  it("冲突三方归一相等才算仅空白", () => {
    expect(isWhitespaceOnlyConflictBlock("a  b", "a\tb", "a b")).toBe(true);
    expect(isWhitespaceOnlyConflictBlock("a", "a", "b")).toBe(false);
    // 无 BASE 时双方相等即算仅空白
    expect(isWhitespaceOnlyConflictBlock("x  y", undefined, "x\ty")).toBe(true);
  });

  it("忽略空白切换契约：只读允许，编辑/patch/二进制拒绝", () => {
    expect(
      canToggleIgnoreWhitespace({
        editing: false,
        dirty: false,
        isPatch: false,
        binary: false,
      }).allowed,
    ).toBe(true);
    // 脏编辑态同样拒绝（重建会丢 Editor 未落盘输入与 undo）
    expect(
      canToggleIgnoreWhitespace({
        editing: true,
        dirty: true,
        isPatch: false,
        binary: false,
      }),
    ).toEqual({ allowed: false, reason: "editing" });
    expect(
      canToggleIgnoreWhitespace({
        editing: false,
        dirty: false,
        isPatch: true,
        binary: false,
      }).reason,
    ).toBe("patch");
    expect(
      canToggleIgnoreWhitespace({
        editing: false,
        dirty: false,
        isPatch: false,
        binary: true,
      }).reason,
    ).toBe("binary");
  });

  it("预览展开与分段不改写原文", () => {
    expect(expandWhitespaceForPreview("a b\tc")).toBe("a·b→c");
    const segs = segmentLineWhitespace("a b\tc");
    expect(segs.map((s) => s.kind)).toEqual([
      "text",
      "space",
      "text",
      "tab",
      "text",
    ]);
    expect(segs.map((s) => s.text).join("")).toBe("a b\tc");
  });

  it("V020-R11：空格/Tab/CRLF/尾随空白归一且展示符号不写回原文", () => {
    // CRLF 行尾与尾随空白归一后相等，但原文保留 CRLF/尾随空格。
    expect(linesEqualIgnoringWhitespace("trailing  \r\n", "trailing\r\n")).toBe(
      true,
    );
    expect(
      normalizeTextForCompare("a  b\r\n  c\t d \r\n").split("\n"),
    ).toHaveLength(3);
    // 展示符号仅用于预览：原文不含 ·/→，展开后可观察。
    const raw = "let\tx  =  2;  \n";
    expect(raw).not.toContain("·");
    expect(raw).not.toContain("→");
    expect(expandWhitespaceForPreview(raw)).toContain("·");
    expect(expandWhitespaceForPreview(raw)).toContain("→");
    expect(
      segmentLineWhitespace(raw)
        .map((s) => s.text)
        .join(""),
    ).toBe(raw);
  });

  it("V020-R11：显示空白门控 patch/二进制禁用并解释", () => {
    expect(
      canToggleShowWhitespace({ isPatch: false, binary: false }).allowed,
    ).toBe(true);
    expect(
      canToggleShowWhitespace({ isPatch: true, binary: false }).reason,
    ).toBe("patch");
    expect(
      canToggleShowWhitespace({ isPatch: false, binary: true }).reason,
    ).toBe("binary");
  });

  it("V020-R11：五类视图支持表齐全且冲突为标记语义", () => {
    expect(WHITESPACE_VIEW_SUPPORT.map((row) => row.kind)).toEqual([
      "normal",
      "history",
      "fallback",
      "conflict",
      "editing",
    ]);
    const conflict = WHITESPACE_VIEW_SUPPORT.find(
      (row) => row.kind === "conflict",
    );
    expect(conflict?.ignore).toContain("标记纯空白块");
    expect(conflict?.ignore).toContain("不自动 Resolve");
  });
});
