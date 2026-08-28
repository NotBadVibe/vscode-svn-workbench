import { describe, expect, it } from "vitest";
import {
  applyTextConflictResolution,
  parseTextConflictBlocks,
} from "../../src/conflict/conflictMerge";

const sample = `before
<<<<<<< .mine
const value = 'mine';
||||||| .r4
const value = 'base';
=======
const value = 'theirs';
>>>>>>> .r5
after
`;

describe("conflictMerge", () => {
  it("解析 Mine、Base、Theirs 冲突块及位置", () => {
    const blocks = parseTextConflictBlocks(sample);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].mine).toContain("'mine'");
    expect(blocks[0].base).toContain("'base'");
    expect(blocks[0].theirs).toContain("'theirs'");
  });

  it("可逐块采用 Mine、Theirs 或两者且移除标记", () => {
    const mine = applyTextConflictResolution(sample, 0, "mine");
    expect(mine).toContain("'mine'");
    expect(mine).not.toContain("<<<<<<<");
    expect(applyTextConflictResolution(sample, 0, "theirs")).toContain(
      "'theirs'",
    );
    const both = applyTextConflictResolution(sample, 0, "both");
    expect(both).toContain("'mine'");
    expect(both).toContain("'theirs'");
  });

  it("无对应块时保持原文", () => {
    expect(applyTextConflictResolution("clean", 3, "mine")).toBe("clean");
  });
});

describe("conflictMerge 扩展：SVN/Git 角色与损坏处理", () => {
  it("Git 无 BASE 仍解析为 Mine/Theirs", () => {
    const git = `a\n<<<<<<< HEAD\n mine-git\n=======\n theirs-git\n>>>>>>> branch\n`;
    const blocks = parseTextConflictBlocks(git);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].mine).toContain("mine-git");
    expect(blocks[0].theirs).toContain("theirs-git");
    expect(blocks[0].base).toBeUndefined();
  });

  it("CRLF 行尾不丢失", () => {
    const crlf =
      "a\r\n<<<<<<< .mine\r\n mine\r\n=======\r\n theirs\r\n>>>>>>> .r1\r\n";
    const blocks = parseTextConflictBlocks(crlf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].mine).toContain("mine");
  });

  it("损坏缺少分隔符时按现实现状不产生块（由 conflictDiffModel 结构化报错）", () => {
    const damaged = "a\n<<<<<<< .mine\n mine\n>>>>>>> .r1\n";
    const blocks = parseTextConflictBlocks(damaged);
    expect(blocks).toHaveLength(0);
  });
});
