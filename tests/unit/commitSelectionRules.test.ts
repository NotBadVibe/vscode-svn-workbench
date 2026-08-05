/**
 * commitSelectionRules 单元测试：内置默认值、内置路径规则与 v0.0.2
 * generatedFilePolicy 硬编码的逐条等价（真值表对拍）、glob 校验/规范化与
 * 遮蔽检测。规划依据：docs/releases/v0.0.3/README.md 第 5、6、9.1 节。
 */
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GeneratedFileDecision,
  classifyGeneratedFile,
} from "../../src/commit/generatedFilePolicy";
import {
  MAX_COMMIT_SELECTION_PATTERN_LENGTH,
  MAX_COMMIT_SELECTION_PATH_RULES,
  ResolvedCommitSelectionPathRule,
  builtinCommitSelectionPathRules,
  defaultCommitSelectionStatusRules,
  detectShadowedCommitSelectionPathRules,
  extractCommitSelectionLayerConfig,
  isValidCommitSelectionPathRuleId,
  normalizeCommitSelectionPattern,
  validateCommitSelectionLayerConfig,
  validateCommitSelectionPattern,
} from "../../src/commit/commitSelectionRules";

/**
 * v0.0.2 generatedFilePolicy.ts 的原始硬编码实现，作为迁移等价性的对拍基准。
 * 若内置规则实现漂移，本测试会逐条指出不一致的路径。
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

const truthTableCorpus: string[] = [
  // 生成物目录段：根、嵌套、目录项本身与内容。
  "node_modules",
  "node_modules/lodash/index.js",
  "dist",
  "dist/app.js",
  "build",
  "build/output.js",
  "target",
  "target/classes/Main.class",
  ".next",
  ".next/static/chunks/main.js",
  ".nuxt",
  ".nuxt/dist/server.js",
  "__pycache__",
  "__pycache__/module.cpython-312.txt",
  "obj",
  "obj/Debug/net8.0/app.dll",
  "packages/web/dist/bundle.js",
  "a/b/node_modules/pkg/x.js",
  // 目录段大小写敏感与前缀不误判。
  "DIST/app.js",
  "Dist/app.js",
  "OBJ/x.dll",
  "distx/app.js",
  "builder/output.js",
  "objects/main.c",
  // bin 规则：仅根锚定、Debug/Release 排除、其余 review、大小写不敏感。
  "bin",
  "bin/app.dll",
  "bin/x",
  "bin/Debug",
  "bin/Debug/app.dll",
  "bin/debug/app.dll",
  "BIN/Debug/app.dll",
  "bIn/dEbUg/deep/file.dll",
  "bin/Release",
  "bin/Release/app.dll",
  "bin/release/app.dll",
  "bin/Debugger/app.dll",
  "bin/deploy.sh",
  "bin/tools/setup.exe",
  "bin/.hidden/x",
  "bin/Debug.log/x",
  "src/bin/Debug/app.dll",
  "a/bin/Release/x",
  "bin2/Debug/app.dll",
  // 扩展名：大小写不敏感；恰名 ".log"/".tmp"/".pyc" 与 path.extname 一致不命中。
  "a.log",
  "x.LOG",
  "logs/ERROR.LOG",
  "logs/server.log",
  ".log",
  "d/.log",
  "..log",
  "d/..log",
  ".d/x.log",
  "work/cache.tmp",
  "A.TMP",
  ".tmp",
  "src/utils/cache.pyc",
  "module.PYC",
  ".pyc",
  "logs.log",
  "a.log.txt",
  "x.log/nested.ts",
  // 组合：bin 优先于扩展名，目录段优先于 bin。
  "bin/x.log",
  "bin/Debug/x.log",
  "dist/x.log",
  "obj/x.tmp",
  "node_modules/pkg/index.pyc",
  // 普通源码与文档。
  "src/main.ts",
  "README.md",
  "src/pages/order/OrderList.vue",
  "docs/guide.md",
  ".github/workflows/ci.yml",
  "特殊 路径/订单(#1).ts",
];

describe("内置规则与 v0.0.2 generatedFilePolicy 真值表对拍", () => {
  it.each(truthTableCorpus.map((candidate) => [candidate] as const))(
    "classifyGeneratedFile(%s) 与 v0.0.2 硬编码一致",
    (candidate) => {
      expect(classifyGeneratedFile(candidate)).toBe(
        referenceClassifyV002(candidate),
      );
    },
  );

  it("对拍语料覆盖 exclude/review/include 三种结果", () => {
    const decisions = new Set(
      truthTableCorpus.map((candidate) => referenceClassifyV002(candidate)),
    );
    expect(decisions).toEqual(new Set(["exclude", "review", "include"]));
  });
});

describe("内置默认值", () => {
  it("默认状态策略与规划 4.1 表一致", () => {
    expect(defaultCommitSelectionStatusRules).toEqual({
      modified: "recommended",
      added: "recommended",
      deleted: "recommended",
      replaced: "recommended",
      propertyModified: "recommended",
      missing: "needsReview",
      unversioned: "needsReview",
      unknown: "needsReview",
      normal: "excluded",
    });
  });

  it("内置路径规则使用稳定 ID 且不重复", () => {
    const ids = builtinCommitSelectionPathRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isValidCommitSelectionPathRuleId(id)).toBe(true);
    }
    expect(ids).toContain("generated-dist");
    expect(ids).toContain("bin-debug");
    expect(ids).toContain("bin-release");
    expect(ids).toContain("bin-review");
  });

  it("内置规则全部通过 pattern 校验且不产生遮蔽警告", () => {
    for (const rule of builtinCommitSelectionPathRules) {
      expect(validateCommitSelectionPattern(rule.pattern)).toBeUndefined();
    }
    const resolved: ResolvedCommitSelectionPathRule[] =
      builtinCommitSelectionPathRules.map((rule) => ({
        ...rule,
        source: "builtin",
        normalizedPattern: normalizeCommitSelectionPattern(rule.pattern),
      }));
    expect(detectShadowedCommitSelectionPathRules(resolved)).toEqual([]);
  });
});

describe("glob pattern 校验与规范化", () => {
  it("接受合法 pattern：相对仓库根、/ 分隔、支持 **", () => {
    for (const pattern of [
      "**/dist/**",
      "bin/Debug/**",
      "**/?*.log",
      "src/**/*.ts",
      "*.md",
      "a{b,c}/**",
    ]) {
      expect(validateCommitSelectionPattern(pattern)).toBeUndefined();
    }
  });

  it("拒绝空 pattern、超长 pattern、反斜杠、绝对路径与盘符", () => {
    expect(validateCommitSelectionPattern("")).toContain("非空");
    expect(validateCommitSelectionPattern("   ")).toContain("非空");
    expect(validateCommitSelectionPattern(42)).toContain("非空");
    expect(
      validateCommitSelectionPattern(
        "x".repeat(MAX_COMMIT_SELECTION_PATTERN_LENGTH + 1),
      ),
    ).toContain("上限");
    expect(
      validateCommitSelectionPattern(
        "x".repeat(MAX_COMMIT_SELECTION_PATTERN_LENGTH),
      ),
    ).toBeUndefined();
    expect(validateCommitSelectionPattern("bin\\Debug\\**")).toContain('"/"');
    expect(validateCommitSelectionPattern("/abs/**")).toContain("相对仓库根");
    expect(validateCommitSelectionPattern("C:/repo/**")).toContain("盘符");
  });

  it("拒绝括号不平衡的非法 glob", () => {
    expect(validateCommitSelectionPattern("[unclosed")).toContain("不是合法");
    expect(validateCommitSelectionPattern("x{")).toContain("不是合法");
    expect(validateCommitSelectionPattern("a(")).toContain("不是合法");
  });

  it("规范化：去空白、折叠重复分隔符、去掉开头 ./", () => {
    expect(normalizeCommitSelectionPattern("  **/dist/**  ")).toBe(
      "**/dist/**",
    );
    expect(normalizeCommitSelectionPattern("a//b///c")).toBe("a/b/c");
    expect(normalizeCommitSelectionPattern("./src/**")).toBe("src/**");
    expect(normalizeCommitSelectionPattern("././x")).toBe("x");
  });
});

describe("规则 ID 校验", () => {
  it("接受字母数字开头、含 - 与 _ 的稳定 ID", () => {
    for (const id of ["generated-dist", "team_rule1", "A9-_x"]) {
      expect(isValidCommitSelectionPathRuleId(id)).toBe(true);
    }
  });

  it("拒绝空、非法字符、开头非法与超长 ID", () => {
    for (const id of [
      "",
      "-abc",
      "_abc",
      "has space",
      "中文ID",
      "a".repeat(65),
    ]) {
      expect(isValidCommitSelectionPathRuleId(id)).toBe(false);
    }
  });
});

describe("extractCommitSelectionLayerConfig", () => {
  it("缺少 commitSelection 键时返回空", () => {
    expect(extractCommitSelectionLayerConfig({ commitConvention: {} })).toEqual(
      { warnings: [] },
    );
    expect(extractCommitSelectionLayerConfig(undefined)).toEqual({
      warnings: [],
    });
  });

  it("commitSelection 不是对象时给出警告并忽略", () => {
    const result = extractCommitSelectionLayerConfig({ commitSelection: 42 });
    expect(result.layer).toBeUndefined();
    expect(result.warnings[0]).toContain("必须是 JSON 对象");
  });

  it("原样返回 commitSelection 对象供 resolver 校验", () => {
    const layer = { version: 1, statusRules: { modified: "excluded" } };
    expect(
      extractCommitSelectionLayerConfig({ commitSelection: layer }),
    ).toEqual({ layer, warnings: [] });
  });
});

describe("validateCommitSelectionLayerConfig", () => {
  it("合法配置原样通过，enabled/reason 补默认值", () => {
    const result = validateCommitSelectionLayerConfig(
      {
        version: 1,
        statusRules: { modified: "excluded" },
        pathRules: [
          { id: "team-docs", pattern: "docs/**", decision: "recommended" },
        ],
      },
      "当前仓库",
    );
    expect(result.errors).toEqual([]);
    expect(result.config?.statusRules).toEqual({ modified: "excluded" });
    expect(result.config?.pathRules).toEqual([
      {
        id: "team-docs",
        enabled: true,
        pattern: "docs/**",
        decision: "recommended",
        reason: "",
      },
    ]);
  });

  it("version 不支持时整层失败", () => {
    const result = validateCommitSelectionLayerConfig(
      { version: 2 },
      "用户默认",
    );
    expect(result.config).toBeUndefined();
    expect(result.errors[0]).toContain("version");
  });

  it("无效决策与 blocked 决策使整层失败", () => {
    for (const decision of ["blocked", "include", 1]) {
      const byStatus = validateCommitSelectionLayerConfig(
        { statusRules: { modified: decision } },
        "用户默认",
      );
      expect(byStatus.config).toBeUndefined();
      const byPath = validateCommitSelectionLayerConfig(
        { pathRules: [{ id: "x", pattern: "a/**", decision }] },
        "用户默认",
      );
      expect(byPath.config).toBeUndefined();
    }
  });

  it("同层重复规则 ID 使整层失败", () => {
    const result = validateCommitSelectionLayerConfig(
      {
        pathRules: [
          { id: "dup", pattern: "a/**", decision: "excluded" },
          { id: "dup", pattern: "b/**", decision: "excluded" },
        ],
      },
      "当前仓库",
    );
    expect(result.config).toBeUndefined();
    expect(result.errors[0]).toContain("重复");
  });

  it("非法规则 ID、非法 glob 使整层失败", () => {
    const badId = validateCommitSelectionLayerConfig(
      { pathRules: [{ id: "bad id", pattern: "a/**", decision: "excluded" }] },
      "当前工作区",
    );
    expect(badId.config).toBeUndefined();
    expect(badId.errors[0]).toContain("规则 ID 无效");
    const badGlob = validateCommitSelectionLayerConfig(
      { pathRules: [{ id: "ok", pattern: "[unclosed", decision: "excluded" }] },
      "当前工作区",
    );
    expect(badGlob.config).toBeUndefined();
    expect(badGlob.errors[0]).toContain("不是合法");
  });

  it("规则数量超过上限使整层失败", () => {
    const pathRules = Array.from(
      { length: MAX_COMMIT_SELECTION_PATH_RULES + 1 },
      (_, index) => ({
        id: `rule-${index}`,
        pattern: `dir${index}/**`,
        decision: "excluded",
      }),
    );
    const result = validateCommitSelectionLayerConfig(
      { pathRules },
      "当前仓库",
    );
    expect(result.config).toBeUndefined();
    expect(result.errors[0]).toContain("上限");
  });

  it("安全状态键与未知状态键产生警告但不失败", () => {
    const result = validateCommitSelectionLayerConfig(
      {
        statusRules: {
          conflicted: "recommended",
          ignored: "recommended",
          somethingElse: "excluded",
          modified: "excluded",
        },
      },
      "用户默认",
    );
    expect(result.errors).toEqual([]);
    expect(result.config?.statusRules).toEqual({ modified: "excluded" });
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings[0]).toContain("不可覆盖的安全状态");
    expect(result.warnings[1]).toContain("不可覆盖的安全状态");
    expect(result.warnings[2]).toContain("未识别的状态键");
  });
});

describe("detectShadowedCommitSelectionPathRules", () => {
  function rule(
    id: string,
    pattern: string,
    extra: Partial<ResolvedCommitSelectionPathRule> = {},
  ): ResolvedCommitSelectionPathRule {
    return {
      id,
      enabled: true,
      pattern,
      decision: "excluded",
      reason: "",
      source: "user",
      normalizedPattern: normalizeCommitSelectionPattern(pattern),
      ...extra,
    };
  }

  it("重复 pattern 产生遮蔽警告", () => {
    const warnings = detectShadowedCommitSelectionPathRules([
      rule("first", "**/dist/**"),
      rule("second", "**/dist/**"),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"second"');
    expect(warnings[0]).toContain('"first"');
  });

  it("明显的目录前缀包含产生遮蔽警告", () => {
    const warnings = detectShadowedCommitSelectionPathRules([
      rule("wide", "**/dist/**"),
      rule("narrow", "**/dist/app/**"),
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"narrow"');
  });

  it("更具体的规则在前不算遮蔽；禁用规则不参与遮蔽", () => {
    expect(
      detectShadowedCommitSelectionPathRules([
        rule("narrow", "**/dist/app/**"),
        rule("wide", "**/dist/**"),
      ]),
    ).toEqual([]);
    expect(
      detectShadowedCommitSelectionPathRules([
        rule("off", "**/dist/**", { enabled: false }),
        rule("same", "**/dist/**"),
      ]),
    ).toEqual([]);
  });

  it("大小写敏感性不同不误判包含", () => {
    expect(
      detectShadowedCommitSelectionPathRules([
        rule("sensitive", "**/dist/**"),
        rule("insensitive", "**/dist/app/**", { caseSensitive: false }),
      ]),
    ).toEqual([]);
  });
});
