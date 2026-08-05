/**
 * commitSelectionRuleResolver 单元测试：三层覆盖优先级、稳定 ID 覆盖、禁用继承、
 * 降级路径、数量上限、未知字段保留（经由统一读写层）与安全状态不可覆盖。
 * 规划依据：docs/releases/v0.0.3/README.md 第 5.3、6、8 节。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MAX_COMMIT_SELECTION_PATH_RULES,
  builtinCommitSelectionPathRules,
  defaultCommitSelectionStatusRules,
  extractCommitSelectionLayerConfig,
} from "../../src/commit/commitSelectionRules";
import { resolveCommitSelectionRules } from "../../src/commit/commitSelectionRuleResolver";
import { createCommitSelectionEvaluator } from "../../src/commit/commitSelectionRuleEvaluator";
import {
  readSvnWorkbenchConfig,
  updateSvnWorkbenchConfig,
} from "../../src/config/svnWorkbenchConfig";

describe("resolveCommitSelectionRules 默认值", () => {
  it("无配置时返回内置默认状态策略与内置路径规则", () => {
    const resolved = resolveCommitSelectionRules({});
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
    expect(resolved.pathRules.map((rule) => rule.id)).toEqual(
      builtinCommitSelectionPathRules.map((rule) => rule.id),
    );
    expect(resolved.pathRules.every((rule) => rule.source === "builtin")).toBe(
      true,
    );
    expect(resolved.errors).toEqual([]);
    expect(resolved.warnings).toEqual([]);
    expect(resolved.layers.user.state).toBe("empty");
    expect(resolved.layers.workspace.state).toBe("empty");
    expect(resolved.layers.repository.state).toBe("empty");
  });
});

describe("状态策略合并", () => {
  it("单层覆盖单个状态键，其余保持默认", () => {
    const resolved = resolveCommitSelectionRules({
      user: { statusRules: { unversioned: "recommended" } },
    });
    expect(resolved.statusRules.unversioned).toBe("recommended");
    expect(resolved.statusRules.missing).toBe("needsReview");
    expect(resolved.layers.user.state).toBe("applied");
    expect(resolved.layers.user.statusRuleCount).toBe(1);
  });

  it("仓库 > 工作区 > 用户 > 内置", () => {
    const resolved = resolveCommitSelectionRules({
      user: { statusRules: { missing: "excluded", unknown: "excluded" } },
      workspace: { statusRules: { missing: "recommended" } },
      repository: { statusRules: { missing: "needsReview" } },
    });
    expect(resolved.statusRules.missing).toBe("needsReview");
    expect(resolved.statusRules.unknown).toBe("excluded");
  });

  it("安全状态配置不生效：冲突仍阻止、忽略仍排除", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        statusRules: {
          conflicted: "recommended",
          ignored: "recommended",
          external: "recommended",
        },
      },
    });
    expect(resolved.layers.repository.state).toBe("applied");
    expect(resolved.warnings).toHaveLength(3);
    const evaluator = createCommitSelectionEvaluator(resolved);
    for (const status of ["conflicted", "obstructed", "incomplete"] as const) {
      const evaluation = evaluator.evaluate({
        relativePath: "src/a.ts",
        status,
      });
      expect(evaluation.decision).toBe("blocked");
      expect(evaluation.safetyLocked).toBe(true);
    }
    for (const status of ["external", "ignored"] as const) {
      const evaluation = evaluator.evaluate({
        relativePath: "src/a.ts",
        status,
      });
      expect(evaluation.decision).toBe("excluded");
      expect(evaluation.safetyLocked).toBe(true);
    }
  });
});

describe("路径规则合并", () => {
  it("高优先级新增自定义规则排在内置规则之前（仓库 > 工作区 > 用户）", () => {
    const resolved = resolveCommitSelectionRules({
      user: {
        pathRules: [{ id: "user-rule", pattern: "u/**", decision: "excluded" }],
      },
      workspace: {
        pathRules: [{ id: "ws-rule", pattern: "w/**", decision: "excluded" }],
      },
      repository: {
        pathRules: [{ id: "repo-rule", pattern: "r/**", decision: "excluded" }],
      },
    });
    expect(resolved.pathRules.map((rule) => rule.id)).toEqual([
      "repo-rule",
      "ws-rule",
      "user-rule",
      ...builtinCommitSelectionPathRules.map((rule) => rule.id),
    ]);
    expect(resolved.pathRules[0].source).toBe("repository");
    expect(resolved.pathRules[1].source).toBe("workspace");
    expect(resolved.pathRules[2].source).toBe("user");
  });

  it("同稳定 ID 覆盖内置定义：原位替换、来源记为覆盖层", () => {
    const builtinIndex = builtinCommitSelectionPathRules.findIndex(
      (rule) => rule.id === "generated-dist",
    );
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [
          {
            id: "generated-dist",
            pattern: "packages/*/dist/**",
            decision: "needsReview",
            reason: "团队自定义 dist 规则",
          },
        ],
      },
    });
    expect(resolved.pathRules[builtinIndex]).toMatchObject({
      id: "generated-dist",
      pattern: "packages/*/dist/**",
      decision: "needsReview",
      reason: "团队自定义 dist 规则",
      source: "repository",
      enabled: true,
    });
    expect(
      resolved.pathRules.filter((rule) => rule.id === "generated-dist"),
    ).toHaveLength(1);
  });

  it("禁用覆盖只影响同 ID：内置规则失效但其余规则保持", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [
          {
            id: "generated-dist",
            pattern: "**/dist/**",
            decision: "excluded",
            enabled: false,
          },
        ],
      },
    });
    const dist = resolved.pathRules.find(
      (rule) => rule.id === "generated-dist",
    );
    expect(dist?.enabled).toBe(false);
    expect(dist?.source).toBe("repository");
    const evaluator = createCommitSelectionEvaluator(resolved);
    // dist 不再被排除：modified 文件落入状态默认策略。
    expect(
      evaluator.evaluate({ relativePath: "dist/app.js", status: "modified" })
        .decision,
    ).toBe("recommended");
    // 其余内置规则仍然生效。
    expect(
      evaluator.evaluate({
        relativePath: "node_modules/pkg/index.js",
        status: "modified",
      }).decision,
    ).toBe("excluded");
  });

  it("同 ID 自定义规则跨层覆盖：位置保持首次出现处，定义取高优先级层", () => {
    const resolved = resolveCommitSelectionRules({
      user: {
        pathRules: [
          { id: "team-docs", pattern: "docs/**", decision: "needsReview" },
          { id: "user-only", pattern: "u/**", decision: "excluded" },
        ],
      },
      repository: {
        pathRules: [
          {
            id: "team-docs",
            pattern: "docs/internal/**",
            decision: "recommended",
          },
        ],
      },
    });
    const ids = resolved.pathRules.map((rule) => rule.id);
    // team-docs 首次出现在用户层，覆盖不移动位置：仍在用户区首位、内置之前。
    expect(ids.indexOf("team-docs")).toBe(0);
    expect(ids.indexOf("user-only")).toBe(1);
    const teamDocs = resolved.pathRules.find((rule) => rule.id === "team-docs");
    expect(teamDocs).toMatchObject({
      pattern: "docs/internal/**",
      decision: "recommended",
      source: "repository",
    });
    expect(ids.filter((id) => id === "team-docs")).toHaveLength(1);
  });

  it("第一条命中生效：前置宽规则优先于后置规则", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [
          { id: "wide", pattern: "generated/**", decision: "excluded" },
          {
            id: "narrow",
            pattern: "generated/keep/**",
            decision: "recommended",
          },
        ],
      },
    });
    const evaluator = createCommitSelectionEvaluator(resolved);
    const evaluation = evaluator.evaluate({
      relativePath: "generated/keep/a.ts",
      status: "modified",
    });
    expect(evaluation.decision).toBe("excluded");
    expect(evaluation.matchedRuleId).toBe("wide");
    expect(evaluation.ruleSource).toBe("repository");
    // 且后置规则被遮蔽 → 警告。
    expect(
      resolved.warnings.some((warning) => warning.includes('"narrow"')),
    ).toBe(true);
    expect(resolved.errors).toEqual([]);
  });

  it("合并后规则总数超过上限时丢弃最低优先级自定义规则并告警", () => {
    const customCount = MAX_COMMIT_SELECTION_PATH_RULES;
    const resolved = resolveCommitSelectionRules({
      user: {
        pathRules: Array.from({ length: customCount }, (_, index) => ({
          id: `bulk-${index}`,
          pattern: `bulk${index}/**`,
          decision: "excluded" as const,
        })),
      },
    });
    expect(resolved.pathRules.length).toBe(MAX_COMMIT_SELECTION_PATH_RULES);
    // 内置规则全部保留，被丢弃的是用户层末尾的自定义规则。
    for (const builtin of builtinCommitSelectionPathRules) {
      expect(resolved.pathRules.some((rule) => rule.id === builtin.id)).toBe(
        true,
      );
    }
    expect(
      resolved.pathRules.some((rule) => rule.id === `bulk-${customCount - 1}`),
    ).toBe(false);
    expect(resolved.warnings.some((warning) => warning.includes("丢弃"))).toBe(
      true,
    );
  });
});

describe("降级路径", () => {
  it("仓库层校验失败时回退到工作区/用户/内置，错误与警告保留", () => {
    const resolved = resolveCommitSelectionRules({
      user: { statusRules: { unversioned: "recommended" } },
      workspace: {
        pathRules: [{ id: "ws-rule", pattern: "w/**", decision: "excluded" }],
      },
      repository: {
        pathRules: [
          { id: "dup", pattern: "a/**", decision: "excluded" },
          { id: "dup", pattern: "b/**", decision: "excluded" },
        ],
      },
    });
    expect(resolved.layers.repository.state).toBe("failed");
    expect(resolved.layers.repository.errors[0]).toContain("重复");
    expect(resolved.errors).toHaveLength(1);
    // 低优先级层不受影响。
    expect(resolved.statusRules.unversioned).toBe("recommended");
    expect(resolved.pathRules[0].id).toBe("ws-rule");
  });

  it("仓库层不是对象时按失败回退", () => {
    const resolved = resolveCommitSelectionRules({
      repository: "not-an-object",
    });
    expect(resolved.layers.repository.state).toBe("failed");
    expect(resolved.errors[0]).toContain("必须是 JSON 对象");
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
  });

  it("非法 glob、无效决策与 blocked 决策都使对应层回退", () => {
    const resolved = resolveCommitSelectionRules({
      user: {
        pathRules: [{ id: "bad", pattern: "[unclosed", decision: "excluded" }],
      },
      workspace: { statusRules: { modified: "include" } },
      repository: {
        pathRules: [{ id: "b", pattern: "x/**", decision: "blocked" }],
      },
    });
    expect(resolved.layers.user.state).toBe("failed");
    expect(resolved.layers.workspace.state).toBe("failed");
    expect(resolved.layers.repository.state).toBe("failed");
    expect(resolved.errors).toHaveLength(3);
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
    expect(resolved.pathRules.map((rule) => rule.id)).toEqual(
      builtinCommitSelectionPathRules.map((rule) => rule.id),
    );
  });
});

describe("未知字段保留（经由统一读写层）", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "svn-workbench-commit-selection-test-"),
    );
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("写入 commitSelection 后既有键与未知键原样保留", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      JSON.stringify(
        {
          commitConvention: { enabled: true, requiredPrefix: true },
          commitCandidateFilterPresets: [],
          teamCustomKey: { note: "团队自定义" },
        },
        null,
        2,
      ),
      "utf8",
    );

    await updateSvnWorkbenchConfig(
      tempRoot,
      {
        commitSelection: {
          version: 1,
          statusRules: { unversioned: "recommended" },
          pathRules: [
            {
              id: "team-vendor",
              enabled: true,
              pattern: "vendor/**",
              decision: "excluded",
              reason: "第三方目录",
            },
          ],
        },
      },
      "{}\n",
    );

    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.warnings).toEqual([]);
    expect(result.raw?.commitConvention).toEqual({
      enabled: true,
      requiredPrefix: true,
    });
    expect(result.raw?.commitCandidateFilterPresets).toEqual([]);
    expect(result.raw?.teamCustomKey).toEqual({ note: "团队自定义" });

    // 读回的仓库层配置可直接进入 resolver 并生效。
    const extracted = extractCommitSelectionLayerConfig(result.raw);
    expect(extracted.warnings).toEqual([]);
    const resolved = resolveCommitSelectionRules({
      repository: extracted.layer,
    });
    expect(resolved.layers.repository.state).toBe("applied");
    expect(resolved.statusRules.unversioned).toBe("recommended");
    expect(resolved.pathRules[0]).toMatchObject({
      id: "team-vendor",
      source: "repository",
    });
  });

  it("无效 JSON 时统一读写层告警，extract 不产生仓库层配置", async () => {
    await fs.writeFile(
      path.join(tempRoot, ".svn-workbench.json"),
      "{ bad json",
      "utf8",
    );
    const result = await readSvnWorkbenchConfig(tempRoot);
    expect(result.raw).toBeUndefined();
    expect(result.warnings[0]).toContain("不是合法 JSON");
    const extracted = extractCommitSelectionLayerConfig(result.raw);
    expect(extracted.layer).toBeUndefined();
    // resolver 无仓库层输入时回退内置默认，错误已在读取层以警告形式呈现。
    const resolved = resolveCommitSelectionRules({
      repository: extracted.layer,
    });
    expect(resolved.layers.repository.state).toBe("empty");
    expect(resolved.statusRules).toEqual(defaultCommitSelectionStatusRules);
  });
});
