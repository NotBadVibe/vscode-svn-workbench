/**
 * commitSelectionRuleEvaluator 单元测试：默认状态映射、(status, propStatus)
 * 二元组、评估顺序、解释模型、与 v0.0.2 选择结果的全网格兼容（含唯一有意
 * 分歧的显式清单）以及 VS Code 设置适配层。
 * 规划依据：docs/releases/v0.0.3/README.md 第 4.1、5.1、5.4、9.1 节。
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { SvnStatus } from "../../src/svn/svnTypes";
import {
  createCommitSelectionEvaluator,
  deriveCommitSelectionStatusKey,
  evaluateCommitSelection,
  getBuiltinCommitSelectionEvaluator,
  getBuiltinCommitSelectionRules,
  normalizeCandidatePath,
  toCommitCandidateSelectionValue,
} from "../../src/commit/commitSelectionRuleEvaluator";
import { resolveCommitSelectionRules } from "../../src/commit/commitSelectionRuleResolver";
import { readCommitSelectionVscodeLayers } from "../../src/config/commitSelectionSettings";
import { GeneratedFileDecision } from "../../src/commit/generatedFilePolicy";

const evaluator = getBuiltinCommitSelectionEvaluator();

describe("默认状态映射（无路径命中时）", () => {
  const cases: Array<
    [
      SvnStatus,
      "recommended" | "needsReview" | "excluded" | "blocked",
      string,
      boolean,
    ]
  > = [
    ["modified", "recommended", "statusPolicy", false],
    ["added", "recommended", "statusPolicy", false],
    ["deleted", "recommended", "statusPolicy", false],
    ["replaced", "recommended", "statusPolicy", false],
    ["missing", "needsReview", "statusPolicy", false],
    ["unversioned", "needsReview", "statusPolicy", false],
    ["unknown", "needsReview", "statusPolicy", false],
    ["normal", "excluded", "statusPolicy", false],
    ["conflicted", "blocked", "safetyBlocked", true],
    ["obstructed", "blocked", "safetyBlocked", true],
    ["incomplete", "blocked", "safetyBlocked", true],
    ["external", "excluded", "safetyExternal", true],
    ["ignored", "excluded", "safetyIgnored", true],
  ];

  it.each(cases)(
    "status=%s → %s（reasonKey=%s, safetyLocked=%s）",
    (status, decision, reasonKey, safetyLocked) => {
      const explanation = evaluator.evaluate({
        relativePath: "src/plain.ts",
        status,
      });
      expect(explanation).toEqual({
        decision,
        reasonKey,
        statusPolicyKey: safetyLocked ? undefined : deriveKey(status),
        matchedRuleId: undefined,
        ruleSource: undefined,
        safetyLocked,
      });

      function deriveKey(value: SvnStatus): string {
        return value;
      }
    },
  );
});

describe("(status, propStatus) 二元组", () => {
  it("仅属性变化（normal + modified）→ propertyModified 默认推荐", () => {
    const explanation = evaluator.evaluate({
      relativePath: "src/prop-only.ts",
      status: "normal",
      propStatus: "modified",
    });
    expect(explanation).toEqual({
      decision: "recommended",
      reasonKey: "statusPolicy",
      statusPolicyKey: "propertyModified",
      matchedRuleId: undefined,
      ruleSource: undefined,
      safetyLocked: false,
    });
  });

  it("普通 normal（无 propStatus 或 propStatus 非 modified）→ 排除", () => {
    for (const propStatus of [undefined, "unknown", "normal"] as const) {
      const explanation = evaluator.evaluate({
        relativePath: "src/plain.ts",
        status: "normal",
        propStatus,
      });
      expect(explanation.decision).toBe("excluded");
      expect(explanation.statusPolicyKey).toBe("normal");
    }
  });

  it("非 normal 状态的 propStatus=modified 不改变状态策略键", () => {
    expect(
      evaluator.evaluate({
        relativePath: "src/a.ts",
        status: "modified",
        propStatus: "modified",
      }).statusPolicyKey,
    ).toBe("modified");
    expect(
      evaluator.evaluate({
        relativePath: "src/a.ts",
        status: "deleted",
        propStatus: "modified",
      }).statusPolicyKey,
    ).toBe("deleted");
  });

  it("安全状态优先于 propertyModified 判断", () => {
    const explanation = evaluator.evaluate({
      relativePath: "src/a.ts",
      status: "conflicted",
      propStatus: "modified",
    });
    expect(explanation.decision).toBe("blocked");
    expect(explanation.safetyLocked).toBe(true);
  });

  it("propertyModified 策略可独立配置，normal 策略不影响它", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        statusRules: { propertyModified: "needsReview", normal: "recommended" },
      },
    });
    const custom = createCommitSelectionEvaluator(resolved);
    expect(
      custom.evaluate({
        relativePath: "src/a.ts",
        status: "normal",
        propStatus: "modified",
      }).decision,
    ).toBe("needsReview");
    expect(
      custom.evaluate({ relativePath: "src/a.ts", status: "normal" }).decision,
    ).toBe("recommended");
  });

  it("deriveCommitSelectionStatusKey 覆盖各组合", () => {
    expect(deriveCommitSelectionStatusKey("normal", "modified")).toBe(
      "propertyModified",
    );
    expect(deriveCommitSelectionStatusKey("normal")).toBe("normal");
    expect(deriveCommitSelectionStatusKey("modified", "modified")).toBe(
      "modified",
    );
  });
});

describe("V003-CR-01：propStatus 安全规则不可覆盖", () => {
  it("modified + conflicted 始终阻止", () => {
    const explanation = evaluator.evaluate({
      relativePath: "src/a.ts",
      status: "modified",
      propStatus: "conflicted",
    });
    expect(explanation).toEqual({
      decision: "blocked",
      reasonKey: "safetyBlocked",
      statusPolicyKey: undefined,
      matchedRuleId: undefined,
      ruleSource: undefined,
      safetyLocked: true,
    });
  });

  it("normal + conflicted 始终阻止，即使存在推荐路径规则", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        statusRules: { normal: "recommended" },
        pathRules: [{ id: "all", pattern: "**", decision: "recommended" }],
      },
    });
    const custom = createCommitSelectionEvaluator(resolved);
    // 对照组：推荐路径规则确实可以把普通 normal 放行。
    expect(
      custom.evaluate({ relativePath: "src/a.ts", status: "normal" }).decision,
    ).toBe("recommended");

    const explanation = custom.evaluate({
      relativePath: "src/a.ts",
      status: "normal",
      propStatus: "conflicted",
    });
    expect(explanation).toEqual({
      decision: "blocked",
      reasonKey: "safetyBlocked",
      statusPolicyKey: undefined,
      matchedRuleId: undefined,
      ruleSource: undefined,
      safetyLocked: true,
    });
  });

  it("conflicted + modified 保持阻止", () => {
    const explanation = evaluator.evaluate({
      relativePath: "src/a.ts",
      status: "conflicted",
      propStatus: "modified",
    });
    expect(explanation.decision).toBe("blocked");
    expect(explanation.reasonKey).toBe("safetyBlocked");
    expect(explanation.safetyLocked).toBe(true);
  });

  it("propStatus 为 obstructed/incomplete 同样阻止，且先于路径规则", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [{ id: "all", pattern: "**", decision: "recommended" }],
      },
    });
    const custom = createCommitSelectionEvaluator(resolved);
    for (const propStatus of ["obstructed", "incomplete"] as const) {
      for (const status of ["normal", "modified"] as const) {
        const explanation = custom.evaluate({
          relativePath: "src/a.ts",
          status,
          propStatus,
        });
        expect(explanation.decision).toBe("blocked");
        expect(explanation.reasonKey).toBe("safetyBlocked");
        expect(explanation.safetyLocked).toBe(true);
      }
    }
  });

  it("仅属性变化（normal + modified）不回退到普通 normal 策略，仍推荐", () => {
    const explanation = evaluator.evaluate({
      relativePath: "src/prop-only.ts",
      status: "normal",
      propStatus: "modified",
    });
    expect(explanation).toEqual({
      decision: "recommended",
      reasonKey: "statusPolicy",
      statusPolicyKey: "propertyModified",
      matchedRuleId: undefined,
      ruleSource: undefined,
      safetyLocked: false,
    });
  });
});

describe("评估顺序与解释模型", () => {
  it("安全规则优先于路径规则：生成物目录中的冲突文件仍阻止", () => {
    const explanation = evaluator.evaluate({
      relativePath: "dist/conflicted.js",
      status: "conflicted",
    });
    expect(explanation).toEqual({
      decision: "blocked",
      reasonKey: "safetyBlocked",
      statusPolicyKey: undefined,
      matchedRuleId: undefined,
      ruleSource: undefined,
      safetyLocked: true,
    });
  });

  it("路径规则优先于状态默认策略，并给出命中规则与来源", () => {
    const explanation = evaluator.evaluate({
      relativePath: "dist/app.js",
      status: "modified",
    });
    expect(explanation).toEqual({
      decision: "excluded",
      reasonKey: "pathRule",
      statusPolicyKey: undefined,
      matchedRuleId: "generated-dist",
      ruleSource: "builtin",
      safetyLocked: false,
    });
    expect(
      evaluator.evaluate({ relativePath: "bin/deploy.sh", status: "missing" }),
    ).toMatchObject({
      decision: "needsReview",
      reasonKey: "pathRule",
      matchedRuleId: "bin-review",
      ruleSource: "builtin",
    });
  });

  it("强制排除不可被自定义推荐规则覆盖", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [{ id: "all", pattern: "**", decision: "recommended" }],
      },
    });
    const custom = createCommitSelectionEvaluator(resolved);
    for (const status of ["external", "ignored"] as const) {
      const explanation = custom.evaluate({
        relativePath: "src/a.ts",
        status,
      });
      expect(explanation.decision).toBe("excluded");
      expect(explanation.safetyLocked).toBe(true);
    }
    // 但普通状态可以被路径规则推荐。
    expect(
      custom.evaluate({ relativePath: "src/a.ts", status: "modified" }),
    ).toMatchObject({
      decision: "recommended",
      matchedRuleId: "all",
      ruleSource: "repository",
    });
  });

  it("第一条命中生效；禁用规则被跳过", () => {
    const resolved = resolveCommitSelectionRules({
      repository: {
        pathRules: [
          { id: "first", pattern: "src/**", decision: "needsReview" },
          { id: "second", pattern: "src/a.ts", decision: "recommended" },
          {
            id: "off",
            pattern: "off/**",
            decision: "excluded",
            enabled: false,
          },
          { id: "fallback", pattern: "off/**", decision: "recommended" },
        ],
      },
    });
    const custom = createCommitSelectionEvaluator(resolved);
    expect(
      custom.evaluate({ relativePath: "src/a.ts", status: "modified" }),
    ).toMatchObject({ decision: "needsReview", matchedRuleId: "first" });
    expect(
      custom.evaluate({ relativePath: "off/x.ts", status: "modified" }),
    ).toMatchObject({ decision: "recommended", matchedRuleId: "fallback" });
  });

  it("路径规范化：反斜杠、开头 ./ 与结尾 / 不影响匹配", () => {
    expect(normalizeCandidatePath("bin\\Debug\\x.dll")).toBe("bin/Debug/x.dll");
    expect(normalizeCandidatePath("./dist/app.js")).toBe("dist/app.js");
    expect(normalizeCandidatePath("dist/")).toBe("dist");
    expect(
      evaluator.evaluate({
        relativePath: "bin\\Debug\\x.dll",
        status: "modified",
      }).matchedRuleId,
    ).toBe("bin-debug");
    expect(
      evaluator.evaluate({ relativePath: "dist/", status: "modified" })
        .matchedRuleId,
    ).toBe("generated-dist");
  });

  it("决策到 CommitCandidate.selection 的映射", () => {
    expect(toCommitCandidateSelectionValue("recommended")).toBe("selected");
    expect(toCommitCandidateSelectionValue("needsReview")).toBe("needsReview");
    expect(toCommitCandidateSelectionValue("excluded")).toBe("excluded");
    expect(toCommitCandidateSelectionValue("blocked")).toBe("blocked");
  });
});

/**
 * v0.0.2 全网格兼容：13 种状态 × 路径语料，断言内置默认评估结果与
 * v0.0.2 inferSelection 完全一致；唯一有意分歧显式固化（见下）。
 */
const referenceExcludedSegments = new Set([
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".nuxt",
  "__pycache__",
  "obj",
]);
const referenceExcludedExtensions = new Set([".log", ".tmp", ".pyc"]);

function referenceClassifyV002(relativePath: string): GeneratedFileDecision {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  const extension = path.extname(normalized).toLocaleLowerCase();
  if (segments.some((segment) => referenceExcludedSegments.has(segment))) {
    return "exclude";
  }
  if (segments.length >= 2 && segments[0].toLocaleLowerCase() === "bin") {
    const second = segments[1].toLocaleLowerCase();
    if (second === "debug" || second === "release") {
      return "exclude";
    }
    return "review";
  }
  if (referenceExcludedExtensions.has(extension)) {
    return "exclude";
  }
  return "include";
}

type V002Selection = "selected" | "needsReview" | "excluded" | "blocked";

function referenceSelectionV002(
  status: SvnStatus,
  generatedDecision: GeneratedFileDecision,
): V002Selection {
  if (
    status === "conflicted" ||
    status === "obstructed" ||
    status === "incomplete"
  ) {
    return "blocked";
  }
  if (
    generatedDecision === "exclude" ||
    status === "ignored" ||
    status === "external" ||
    status === "normal"
  ) {
    return "excluded";
  }
  if (
    generatedDecision === "review" ||
    status === "missing" ||
    status === "unversioned" ||
    status === "unknown"
  ) {
    return "needsReview";
  }
  return "selected";
}

const gridCorpus = [
  "src/main.ts",
  "README.md",
  "node_modules/lodash/index.js",
  "dist/app.js",
  "build/output.js",
  "target/classes/Main.class",
  ".next/static/chunks/main.js",
  ".nuxt/dist/server.js",
  "__pycache__/module.cpython-312.txt",
  "obj/Debug/net8.0/app.dll",
  "packages/web/dist/bundle.js",
  "DIST/app.js",
  "bin",
  "bin/app.dll",
  "bin/Debug/app.dll",
  "BIN/Debug/app.dll",
  "bin/Release/app.dll",
  "bin/Debugger/app.dll",
  "bin/deploy.sh",
  "bin/tools/setup.exe",
  "bin/Debug.log/x",
  "src/bin/Debug/app.dll",
  "logs/server.log",
  "ERROR.LOG",
  ".log",
  "d/.log",
  "src/utils/cache.pyc",
  "bin/x.log",
  "bin/Debug/x.log",
  "dist/x.log",
  "a.log.txt",
  "特殊 路径/订单(#1).ts",
];

const allStatuses: SvnStatus[] = [
  "normal",
  "modified",
  "added",
  "deleted",
  "missing",
  "unversioned",
  "conflicted",
  "ignored",
  "external",
  "obstructed",
  "replaced",
  "incomplete",
  "unknown",
];

describe("与 v0.0.2 选择结果的全网格兼容", () => {
  it("13 种状态 × 路径语料：除显式分歧清单外完全一致", () => {
    const divergences: Array<{
      status: SvnStatus;
      path: string;
      v002: V002Selection;
      v003: V002Selection;
    }> = [];

    for (const status of allStatuses) {
      for (const candidatePath of gridCorpus) {
        const v002 = referenceSelectionV002(
          status,
          referenceClassifyV002(candidatePath),
        );
        const v003 = toCommitCandidateSelectionValue(
          evaluator.evaluate({ relativePath: candidatePath, status }).decision,
        );
        if (v002 !== v003) {
          divergences.push({ status, path: candidatePath, v002, v003 });
        }
      }
    }

    // 有意分歧（评估顺序按规划 5.1：路径规则先于状态默认策略）：
    // 仅当 status=normal 且命中内置 bin review 规则时，v0.0.2 为 excluded，
    // v0.0.3 为 needsReview。真实 svn status 不会产出普通 normal 条目；
    // 仅属性变化的 normal 走 propertyModified 策略（规划内的行为修正），
    // 因此该组合不会出现在真实候选中。
    expect(divergences).toEqual(
      [
        "bin/app.dll",
        "bin/Debugger/app.dll",
        "bin/deploy.sh",
        "bin/tools/setup.exe",
        "bin/Debug.log/x",
        "bin/x.log",
      ].map((candidatePath) => ({
        status: "normal",
        path: candidatePath,
        v002: "excluded",
        v003: "needsReview",
      })),
    );
  });

  it("空配置 resolver 与内置评估器给出一致决策", () => {
    const resolved = resolveCommitSelectionRules({});
    const fromResolver = createCommitSelectionEvaluator(resolved);
    for (const status of allStatuses) {
      for (const candidatePath of gridCorpus.slice(0, 10)) {
        expect(
          fromResolver.evaluate({ relativePath: candidatePath, status }),
        ).toEqual(
          getBuiltinCommitSelectionEvaluator().evaluate({
            relativePath: candidatePath,
            status,
          }),
        );
      }
    }
  });

  it("evaluateCommitSelection 一次性评估与复用评估器一致", () => {
    const input = { relativePath: "dist/app.js", status: "modified" as const };
    expect(
      evaluateCommitSelection(input, getBuiltinCommitSelectionRules()),
    ).toEqual(evaluator.evaluate(input));
  });
});

describe("readCommitSelectionVscodeLayers 适配层", () => {
  it("从 inspect 结果拆出用户与工作区两层", () => {
    const layers = readCommitSelectionVscodeLayers({
      inspect: (key: string) => {
        if (key === "statusRules") {
          return {
            globalValue: { unversioned: "recommended" },
            workspaceValue: { missing: "excluded" },
          };
        }
        if (key === "pathRules") {
          return {
            globalValue: undefined,
            workspaceValue: [
              { id: "ws", pattern: "w/**", decision: "excluded" },
            ],
          };
        }
        return undefined;
      },
    });
    expect(layers.user).toEqual({
      statusRules: { unversioned: "recommended" },
    });
    expect(layers.workspace).toEqual({
      statusRules: { missing: "excluded" },
      pathRules: [{ id: "ws", pattern: "w/**", decision: "excluded" }],
    });

    // 拆出的层可直接进入 resolver：工作区覆盖用户。
    const resolved = resolveCommitSelectionRules(layers);
    expect(resolved.statusRules.unversioned).toBe("recommended");
    expect(resolved.statusRules.missing).toBe("excluded");
    expect(resolved.pathRules[0]).toMatchObject({
      id: "ws",
      source: "workspace",
    });
  });

  it("两层都未配置时返回 undefined 层", () => {
    const layers = readCommitSelectionVscodeLayers({
      inspect: () => undefined,
    });
    expect(layers).toEqual({ user: undefined, workspace: undefined });
  });

  it("默认走 vscode.workspace.getConfiguration（mock 下为空层）", () => {
    const layers = readCommitSelectionVscodeLayers();
    expect(layers).toEqual({ user: undefined, workspace: undefined });
  });
});
