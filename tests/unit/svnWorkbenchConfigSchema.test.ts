/**
 * .svn-workbench.json JSON Schema 单元测试：schema 文件可解析、package.json
 * 的 jsonValidation contribution 指向包内 schema，且关键约束（状态键、决策
 * 枚举、数量与长度上限、规则 ID 格式）与 commitSelectionRules.ts 的领域常量
 * 逐一对比，避免 schema 与运行期校验双写漂移。未引入 ajv，使用纯 JSON 断言。
 * 规划依据：docs/releases/v0.0.3/README.md 第 6、11 节。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMIT_SELECTION_CONFIG_VERSION,
  MAX_COMMIT_SELECTION_PATH_RULES,
  MAX_COMMIT_SELECTION_PATTERN_LENGTH,
  builtinCommitSelectionPathRules,
  configurableCommitSelectionStatusKeys,
  isConfigurableCommitSelectionDecision,
  isValidCommitSelectionPathRuleId,
  validateCommitSelectionPattern,
} from "../../src/commit/commitSelectionRules";
import { SVN_WORKBENCH_CONFIG_FILE } from "../../src/config/svnWorkbenchConfig";

interface JsonSchemaObject {
  $ref?: string;
  additionalProperties?: boolean;
  definitions?: Record<string, JsonSchemaObject>;
  enum?: unknown[];
  items?: { [key: string]: unknown } & JsonSchemaObject;
  maxItems?: number;
  maxLength?: number;
  pattern?: string;
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  type?: string;
}

/** 解析 schema 内部的 #/definitions/... 本地引用，非引用节点原样返回。 */
function deref(
  rootSchema: JsonSchemaObject,
  node: JsonSchemaObject | undefined,
): JsonSchemaObject | undefined {
  const prefix = "#/definitions/";
  if (node?.$ref?.startsWith(prefix)) {
    return rootSchema.definitions?.[node.$ref.slice(prefix.length)];
  }
  return node;
}

const root = process.cwd();
const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as {
  contributes?: {
    jsonValidation?: { fileMatch: string; url: string }[];
  };
};

const jsonValidation = manifest.contributes?.jsonValidation ?? [];
const configValidation = jsonValidation.find(
  (entry) => entry.fileMatch === SVN_WORKBENCH_CONFIG_FILE,
);

function readConfigSchema(): JsonSchemaObject {
  expect(
    configValidation,
    "package.json 需要为 .svn-workbench.json 声明 jsonValidation",
  ).toBeDefined();
  expect(configValidation?.url).toMatch(/^\.\//);
  return JSON.parse(
    readFileSync(resolve(root, configValidation!.url), "utf8"),
  ) as JsonSchemaObject;
}

const schema = readConfigSchema();
const commitSelection = schema.properties?.commitSelection;
const statusRules = commitSelection?.properties?.statusRules;
const pathRules = commitSelection?.properties?.pathRules;
const pathRuleItem = pathRules?.items;

describe(".svn-workbench.json JSON Schema", () => {
  it("顶层允许未知字段，并覆盖现有配置键", () => {
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(true);
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining([
        "commitConvention",
        "commitCandidateFilterPresets",
        "commitSelection",
      ]),
    );
  });

  it("commitSelection.version 与配置格式版本常量一致", () => {
    expect(commitSelection?.type).toBe("object");
    expect(commitSelection?.properties?.version?.enum).toEqual([
      COMMIT_SELECTION_CONFIG_VERSION,
    ]);
  });

  it("statusRules 的状态键与可配置决策枚举和领域常量一致", () => {
    expect(Object.keys(statusRules?.properties ?? {}).sort()).toEqual(
      [...configurableCommitSelectionStatusKeys].sort(),
    );
    for (const key of configurableCommitSelectionStatusKeys) {
      const values = deref(schema, statusRules?.properties?.[key])?.enum;
      expect(values).toBeDefined();
      expect(values).not.toContain("blocked");
      for (const value of values ?? []) {
        expect(isConfigurableCommitSelectionDecision(value)).toBe(true);
      }
    }
  });

  it("pathRules 的数量、长度、必填项与决策约束和领域校验一致", () => {
    expect(pathRules?.maxItems).toBe(MAX_COMMIT_SELECTION_PATH_RULES);
    expect(pathRuleItem?.required).toEqual(
      expect.arrayContaining(["id", "pattern", "decision"]),
    );
    expect(pathRuleItem?.properties?.pattern?.maxLength).toBe(
      MAX_COMMIT_SELECTION_PATTERN_LENGTH,
    );
    const decisions = deref(schema, pathRuleItem?.properties?.decision)?.enum;
    expect(decisions).toBeDefined();
    expect(decisions).not.toContain("blocked");
    for (const value of decisions ?? []) {
      expect(isConfigurableCommitSelectionDecision(value)).toBe(true);
    }
    const enabled = pathRuleItem?.properties?.enabled;
    const caseSensitive = pathRuleItem?.properties?.caseSensitive;
    expect(enabled?.type).toBe("boolean");
    expect(caseSensitive?.type).toBe("boolean");
  });

  it("内置路径规则全部满足 schema 的 ID 与 pattern 约束", () => {
    const idPattern = new RegExp(pathRuleItem?.properties?.id?.pattern ?? "");
    const maxLength = pathRuleItem?.properties?.pattern?.maxLength ?? 0;
    expect(builtinCommitSelectionPathRules.length).toBeGreaterThan(0);
    for (const rule of builtinCommitSelectionPathRules) {
      expect(idPattern.test(rule.id)).toBe(true);
      expect(isValidCommitSelectionPathRuleId(rule.id)).toBe(true);
      expect(rule.pattern.length).toBeLessThanOrEqual(maxLength);
      expect(validateCommitSelectionPattern(rule.pattern)).toBeUndefined();
    }
  });
});
