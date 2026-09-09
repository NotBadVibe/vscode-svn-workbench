import { describe, expect, it } from "vitest";
import {
  buildMergeRevisionArgs,
  classifyMergeSelection,
  describeMergeRevisionMapping,
  expandMergeSelection,
  normalizeMergeRevisionSelection,
  parseMergeDryRunOutput,
  parseMergeinfoRevisions,
  parseMergeRevisionList,
  readMergeRevisionIntent,
} from "../../src/repository/mergeRevisionSelection";
import { isRepositoryMergePreviewView } from "../../src/protocol/workbenchProtocol";

/*
 * V026-R45：合并修订选择（纯领域 + 协议守卫，平台无关）。
 * 验收：单修订、连续范围、不连续选择、已合并修订、无 mergeinfo 支持分别有正确结果；
 * 反向合并拒绝；dry-run 解析不虚构。
 */

describe("V026-R45 normalizeMergeRevisionSelection", () => {
  it("缺省模式为全部符合条件", () => {
    expect(
      normalizeMergeRevisionSelection(
        undefined,
        undefined,
        undefined,
        undefined,
      ),
    ).toMatchObject({
      mode: "eligible",
      issues: [],
    });
    expect(
      normalizeMergeRevisionSelection(
        "eligible",
        undefined,
        undefined,
        undefined,
      ).mode,
    ).toBe("eligible");
  });

  it("单修订归一化并去 r 前缀与前导零", () => {
    const result = normalizeMergeRevisionSelection(
      "specific",
      "r007",
      undefined,
      undefined,
    );
    expect(result.issues).toEqual([]);
    expect(result.requestedRevisions).toEqual(["7"]);
  });

  it("不连续多选去重排序", () => {
    const result = normalizeMergeRevisionSelection(
      "specific",
      "r45, 42,r45 44",
      undefined,
      undefined,
    );
    expect(result.issues).toEqual([]);
    expect(result.requestedRevisions).toEqual(["42", "44", "45"]);
  });

  it("指定模式空输入要求补填，不静默回落", () => {
    const result = normalizeMergeRevisionSelection(
      "specific",
      "  ",
      undefined,
      undefined,
    );
    expect(result.requestedRevisions).toEqual([]);
    expect(result.issues.join("")).toContain("请填写至少一个");
  });

  it("指定模式拒绝非法修订", () => {
    const result = normalizeMergeRevisionSelection(
      "specific",
      "42, abc, 0",
      undefined,
      undefined,
    );
    expect(result.requestedRevisions).toEqual(["42"]);
    expect(result.issues.join(" ")).toMatch(/无效/);
  });

  it("连续范围接受起止并含端点", () => {
    const result = normalizeMergeRevisionSelection(
      "range",
      undefined,
      "r40",
      "45",
    );
    expect(result.issues).toEqual([]);
    expect(result.fromRevision).toBe("40");
    expect(result.toRevision).toBe("45");
    expect(expandMergeSelection(result)).toEqual([
      "40",
      "41",
      "42",
      "43",
      "44",
      "45",
    ]);
  });

  it("反向范围视为反向合并直接拒绝，不归一化", () => {
    const result = normalizeMergeRevisionSelection(
      "range",
      undefined,
      "45",
      "40",
    );
    expect(result.issues.join("")).toContain("反向合并");
    expect(expandMergeSelection(result)).toEqual([]);
  });

  it("超限范围 fail-closed 要求缩小", () => {
    const result = normalizeMergeRevisionSelection(
      "range",
      undefined,
      "1",
      "500",
    );
    expect(result.issues.join("")).toContain("超过单次");
  });

  it("范围缺失端点要求补填", () => {
    const result = normalizeMergeRevisionSelection(
      "range",
      undefined,
      "40",
      "",
    );
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe("V026-R45 parseMergeRevisionList", () => {
  it("逗号/空白/分号分隔均可", () => {
    expect(parseMergeRevisionList("42;44 45,r46").revisions).toEqual([
      "42",
      "44",
      "45",
      "46",
    ]);
  });

  it("超限多选拒绝", () => {
    const many = Array.from({ length: 201 }, (_, index) =>
      String(index + 1),
    ).join(",");
    const result = parseMergeRevisionList(many);
    expect(result.revisions).toEqual([]);
    expect(result.issues.join("")).toContain("超过单次");
  });
});

describe("V026-R45 parseMergeinfoRevisions", () => {
  it("逐行解析 rN 并容忍空白", () => {
    expect(parseMergeinfoRevisions("r44\n  r42\nr43\n")).toEqual([
      "42",
      "43",
      "44",
    ]);
  });

  it("非法行跳过不虚构", () => {
    expect(parseMergeinfoRevisions("r42\nHEAD\n\nfoo\nr0\n")).toEqual(["42"]);
  });
});

describe("V026-R45 classifyMergeSelection", () => {
  it("单修订在 eligible 内为有效", () => {
    expect(
      classifyMergeSelection(["42"], ["42", "43"], ["41"], true),
    ).toMatchObject({
      valid: ["42"],
      alreadyMerged: [],
      notEligible: [],
      issues: [],
    });
  });

  it("已合并修订阻止执行", () => {
    const result = classifyMergeSelection(["41", "42"], ["42"], ["41"], true);
    expect(result.alreadyMerged).toEqual(["41"]);
    expect(result.valid).toEqual(["42"]);
    expect(result.issues.join("")).toContain("已合并");
  });

  it("范围外修订阻止执行", () => {
    const result = classifyMergeSelection(["99"], ["42"], ["41"], true);
    expect(result.notEligible).toEqual(["99"]);
    expect(result.issues.join("")).toContain("不在可合并集合内");
  });

  it("无 mergeinfo 支持时跳过校验不阻止", () => {
    expect(classifyMergeSelection(["42"], [], [], false)).toMatchObject({
      valid: ["42"],
      issues: [],
    });
  });
});

describe("V026-R45 buildMergeRevisionArgs", () => {
  it("空集合为完整合并（不带 -c/-r）", () => {
    expect(buildMergeRevisionArgs([])).toEqual([]);
  });

  it("单修订映射为 -c", () => {
    expect(buildMergeRevisionArgs(["42"])).toEqual(["-c", "42"]);
  });

  it("连续区间映射为 -r 起始减一", () => {
    expect(buildMergeRevisionArgs(["40", "41", "42"])).toEqual(["-r", "39:42"]);
    expect(buildMergeRevisionArgs(["1", "2"])).toEqual(["-r", "0:2"]);
  });

  it("不连续多选映射为 -c 逗号分隔", () => {
    expect(buildMergeRevisionArgs(["42", "45", "48"])).toEqual([
      "-c",
      "42,45,48",
    ]);
  });
});

describe("V026-R45 describeMergeRevisionMapping", () => {
  it("三种模式各有中文解释且含 SVN 语义", () => {
    expect(describeMergeRevisionMapping([])).toContain("完整合并");
    expect(describeMergeRevisionMapping(["42"])).toContain("-c 42");
    expect(describeMergeRevisionMapping(["40", "41", "42"])).toContain(
      "-r 39:42",
    );
    expect(describeMergeRevisionMapping(["42", "45"])).toContain("-c 42,45");
  });
});

describe("V026-R45 parseMergeDryRunOutput", () => {
  it("解析文件与 C 标记冲突", () => {
    const result = parseMergeDryRunOutput(
      "--- Merging r43 into '.'\nU app/a.ts\nA app/b.ts\nC app/c.ts\n",
    );
    expect(result.files).toEqual(["app/a.ts", "app/b.ts", "app/c.ts"]);
    expect(result.conflicts).toEqual(["app/c.ts"]);
    expect(result.summary).toContain("3 个路径");
    expect(result.summary).toContain("1 个可能冲突");
  });

  it("空输出如实说明无差异", () => {
    const result = parseMergeDryRunOutput("\n");
    expect(result.files).toEqual([]);
    expect(result.summary).toContain("未报告文件变更");
  });

  it("超限截断注明省略数", () => {
    const stdout = Array.from(
      { length: 25 },
      (_, index) => `U file-${index}.ts`,
    ).join("\n");
    const result = parseMergeDryRunOutput(stdout, 20);
    expect(result.files).toHaveLength(20);
    expect(result.truncated).toBe(true);
    expect(result.omittedCount).toBe(5);
    expect(result.summary).toContain("另有 5 个未展示");
  });

  it("二进制输出不虚构清单", () => {
    const result = parseMergeDryRunOutput("U a.ts\0binary");
    expect(result.files).toEqual([]);
    expect(result.summary).toContain("二进制");
  });
});

describe("V026-R45 readMergeRevisionIntent", () => {
  it("结构化 merge 优先、旧扁平字段兼容", () => {
    expect(
      readMergeRevisionIntent({
        merge: { mode: "specific", revisions: "r42", from: "", to: "" },
      }),
    ).toMatchObject({ mode: "specific", revisions: "r42" });
    expect(
      readMergeRevisionIntent({
        mergeMode: "range",
        mergeRangeFrom: "40",
        mergeRangeTo: "45",
      }),
    ).toMatchObject({ mode: "range", fromRevision: "40", toRevision: "45" });
  });
});

describe("V026-R45 isRepositoryMergePreviewView", () => {
  const valid = {
    mode: "specific",
    requestedRevisions: ["42"],
    resolvedRevisions: ["42"],
    eligible: ["42", "43"],
    merged: ["41"],
    eligibleCount: 2,
    mergedCount: 1,
    mergeinfoSupported: true,
    dryRunCommand: "svn merge --dry-run -c 42 <s> <w> --accept postpone",
    dryRunFiles: ["app/a.ts"],
    dryRunConflicts: [],
    dryRunSummary: "试运行预计影响 1 个路径，未发现 C 标记冲突。",
  };

  it("接受合法合并视图", () => {
    expect(isRepositoryMergePreviewView(valid)).toBe(true);
    expect(
      isRepositoryMergePreviewView({
        ...valid,
        mode: "eligible",
        resolvedRevisions: [],
      }),
    ).toBe(true);
  });

  it("拒绝非法模式与坏载荷", () => {
    expect(isRepositoryMergePreviewView({ ...valid, mode: "reverse" })).toBe(
      false,
    );
    expect(isRepositoryMergePreviewView({ ...valid, eligibleCount: "2" })).toBe(
      false,
    );
    expect(
      isRepositoryMergePreviewView({ ...valid, dryRunFiles: "app/a.ts" }),
    ).toBe(false);
    expect(isRepositoryMergePreviewView(undefined)).toBe(false);
  });
});
