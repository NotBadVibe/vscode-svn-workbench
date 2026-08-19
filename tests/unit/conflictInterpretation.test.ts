import { describe, expect, it } from "vitest";
import {
  createLocalConflictInterpretation,
  normalizeConflictInterpretation,
} from "../../src/ai/conflictInterpretation";
import type { AiConflictRequest } from "../../src/ai/aiProvider";

function request(
  working: string,
  mine = "mine",
  theirs = "theirs",
): AiConflictRequest {
  return {
    relativePath: "src/a.ts",
    operation: "text-conflict",
    type: "conflicted",
    sourceLeftRevision: "10",
    sourceRightRevision: "11",
    contents: {
      base: { content: "base", truncated: false },
      mine: { content: mine, truncated: false },
      theirs: { content: theirs, truncated: false },
      working: { content: working, truncated: false },
    },
  };
}

describe("createLocalConflictInterpretation（本地回退，§7 六段）", () => {
  it("输出六段结构，含标记检测与无法判断的业务选择", () => {
    const interpretation = createLocalConflictInterpretation(
      request("<<<<<<< mine\nfoo\n=======\nbar\n>>>>>>> theirs"),
    );
    expect(interpretation.myIntent).toContain("无法读取");
    expect(interpretation.theirIntent).toContain("无法读取");
    expect(interpretation.commonPoints).toHaveLength(1);
    expect(interpretation.conflictPoints.join("、")).toContain("SVN 冲突标记");
    expect(interpretation.recommendedHandling.recommendation).toBe(
      "manualMerge",
    );
    expect(interpretation.businessUnknowns.length).toBeGreaterThan(0);
    expect(interpretation.postSaveVerification.length).toBeGreaterThan(0);
  });

  it("双侧一致时本地判定 acceptWorking 且如实声明未知", () => {
    const interpretation = createLocalConflictInterpretation(
      request("clean", "same", "same"),
    );
    expect(interpretation.recommendedHandling.recommendation).toBe(
      "acceptWorking",
    );
  });
});

describe("normalizeConflictInterpretation（严格结构校验）", () => {
  it("合法输入原样保留六段", () => {
    const value = {
      myIntent: "我的意图",
      theirIntent: "对方意图",
      commonPoints: ["共同点"],
      conflictPoints: ["冲突点"],
      recommendedHandling: {
        summary: "建议人工合并",
        recommendation: "manualMerge",
        evidence: ["证据 1"],
      },
      businessUnknowns: ["业务未知"],
      postSaveVerification: [
        { title: "验证", command: "npm run check" },
        { title: "无命令" },
      ],
      warnings: [],
    };
    const result = normalizeConflictInterpretation(value);
    expect(result.myIntent).toBe("我的意图");
    expect(result.recommendedHandling.recommendation).toBe("manualMerge");
    expect(result.postSaveVerification).toHaveLength(2);
    expect(result.postSaveVerification[0].command).toBe("npm run check");
  });

  it("非法推荐方式回退 manualMerge；畸形字段丢弃", () => {
    const result = normalizeConflictInterpretation({
      myIntent: "x",
      theirIntent: "y",
      recommendedHandling: {
        summary: "s",
        recommendation: "bogus" as never,
        evidence: ["e"],
      },
      postSaveVerification: [{ title: "" }, 42 as never],
    });
    expect(result.recommendedHandling.recommendation).toBe("manualMerge");
    expect(result.postSaveVerification).toHaveLength(0);
  });
});
