import { describe, expect, it } from "vitest";
import {
  buildCommitConventionSampleSkeleton,
  previewCommitConventionSample,
  validateCommitMessageConvention,
  type CommitConventionConfig,
} from "../../src/commit/commitConventionRules";

/*
 * V025-R47 团队规则示例即时校验（纯逻辑，平台无关）：
 * - 骨架只表达前缀/模块结构，不编造真实工单号；
 * - 非法正则、空允许列表、中文模块、真实/缺失工单号、超预算均有明确原因；
 * - 预览结论与提交页同一函数（validateCommitMessageConvention）等价，
 *   同一示例在设置与提交页得到相同结论。
 */

const fullConfig: CommitConventionConfig = {
  enabled: true,
  requiredIssueId: true,
  issueIdPattern: "[A-Z]+-\\d+",
  requiredModule: true,
  allowedModules: ["order", "user"],
  requiredPrefix: true,
  allowedPrefixes: ["feat", "fix"],
};

function ruleOf(
  preview: ReturnType<typeof previewCommitConventionSample>,
  rule: "prefix" | "module" | "issueId",
) {
  const found = preview.ruleResults.find((item) => item.rule === rule);
  if (!found) throw new Error(`缺少规则结论：${rule}`);
  return found;
}

describe("示例骨架", () => {
  it("给出符合前缀/模块结构的骨架，不编造真实工单号", () => {
    const skeleton = buildCommitConventionSampleSkeleton(fullConfig);
    expect(skeleton).toContain("feat(order):");
    // 骨架中的工单号行是占位写法，不包含可被正则命中的真实工单号。
    expect(skeleton).toContain("不编造");
    expect(skeleton).not.toMatch(/[A-Z]+-\d+/);
  });

  it("未启用时给出中性写作提示", () => {
    expect(
      buildCommitConventionSampleSkeleton({
        ...fullConfig,
        enabled: false,
      }),
    ).toContain("改动意图");
  });

  it("空允许列表时仍给出可填写的结构占位", () => {
    const skeleton = buildCommitConventionSampleSkeleton({
      ...fullConfig,
      allowedPrefixes: [],
      allowedModules: [],
    });
    expect(skeleton).toContain(":");
  });
});

describe("示例即时校验", () => {
  it("真实工单号通过，缺失工单号给出明确原因", () => {
    const passing = previewCommitConventionSample(
      "feat(order): 修复订单列表\n\nPROJ-123",
      fullConfig,
    );
    expect(ruleOf(passing, "prefix").passed).toBe(true);
    expect(ruleOf(passing, "module").passed).toBe(true);
    expect(ruleOf(passing, "issueId").passed).toBe(true);
    expect(passing.valid).toBe(true);

    const missing = previewCommitConventionSample(
      "feat(order): 修复订单列表",
      fullConfig,
    );
    expect(ruleOf(missing, "issueId").passed).toBe(false);
    expect(ruleOf(missing, "issueId").message).toContain("工单号");
    expect(missing.valid).toBe(false);
  });

  it("中文模块给出明确的范围外原因，前缀结论不受影响", () => {
    const preview = previewCommitConventionSample(
      "feat(订单): 修复订单列表\n\nPROJ-123",
      fullConfig,
    );
    const module = ruleOf(preview, "module");
    expect(module.passed).toBe(false);
    expect(module.message).toContain("订单");
    expect(module.message).toContain("不在允许范围");
    expect(ruleOf(preview, "prefix").passed).toBe(true);
    expect(preview.valid).toBe(false);
  });

  it("非法正则即时拒绝并给出明确原因", () => {
    const preview = previewCommitConventionSample("feat(order): 修复", {
      ...fullConfig,
      issueIdPattern: "[",
    });
    expect(preview.valid).toBe(false);
    expect(
      preview.configIssues.some((issue) => issue.includes("正则不合法")),
    ).toBe(true);
  });

  it("空允许列表即时拒绝并给出明确原因", () => {
    const preview = previewCommitConventionSample("feat(order): 修复", {
      ...fullConfig,
      allowedPrefixes: [],
      allowedModules: [],
    });
    expect(preview.valid).toBe(false);
    expect(
      preview.configIssues.some((issue) =>
        issue.includes("至少需要填写一个允许前缀"),
      ),
    ).toBe(true);
    expect(
      preview.configIssues.some((issue) =>
        issue.includes("至少需要填写一个允许模块"),
      ),
    ).toBe(true);
  });

  it("空样例在全要求下三条规则均失败且原因明确", () => {
    const preview = previewCommitConventionSample("", fullConfig);
    expect(preview.valid).toBe(false);
    for (const rule of ["prefix", "module", "issueId"] as const) {
      expect(ruleOf(preview, rule).passed).toBe(false);
      expect(ruleOf(preview, rule).message.length).toBeGreaterThan(0);
    }
  });

  it("超过字符预算即时拒绝", () => {
    const preview = previewCommitConventionSample("a".repeat(2001), fullConfig);
    expect(preview.valid).toBe(false);
    expect(preview.budgetIssue).toContain("2000");
    expect(
      previewCommitConventionSample("a".repeat(2000), fullConfig).budgetIssue,
    ).toBeUndefined();
  });

  it("未启用的规则标记未启用且不阻止通过", () => {
    const preview = previewCommitConventionSample("任意文本", {
      ...fullConfig,
      enabled: false,
    });
    expect(preview.valid).toBe(true);
    for (const rule of ["prefix", "module", "issueId"] as const) {
      const result = ruleOf(preview, rule);
      expect(result.required).toBe(false);
      expect(result.passed).toBe(true);
    }
  });

  it("同一示例的预览结论与提交页校验结论一致", () => {
    const samples = [
      "",
      "feat(order): 修复订单列表\n\nPROJ-123",
      "feat(订单): 修复\n\nPROJ-123",
      "docs: 更新说明",
      "Feat(Order): 大小写\n\n#42",
      "fix(user): 修复\n\n缺失工单号",
    ];
    const configs: CommitConventionConfig[] = [
      fullConfig,
      { ...fullConfig, enabled: false },
      { ...fullConfig, requiredIssueId: false },
      { ...fullConfig, requiredPrefix: false, requiredModule: false },
    ];
    for (const config of configs) {
      for (const sample of samples) {
        const preview = previewCommitConventionSample(sample, config);
        const authoritative = validateCommitMessageConvention(sample, config);
        // 设置页预览 valid 与提交页 validateCommitMessageConvention valid 一致。
        expect(preview.valid, `sample=${JSON.stringify(sample)}`).toBe(
          authoritative.valid,
        );
      }
    }
  });
});
