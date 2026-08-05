/**
 * V003-CR-04 回归测试：无效 AI 提交选择结构必须被拒绝（抛出结构化错误），
 * 不得静默规范化为四个空数组——空结果会被 Controller 当成模型分析成功
 * 并清空用户当前选择。合法结果仍正常通过，且后续范围/候选集合校验
 * （validateAiSelectionResult）不受影响。
 */
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiSelectionResultStructureError,
  normalizeAiSelectionResult,
  validateAiSelectionResult,
} from "../../src/ai/aiResultValidator";
import { OpenAiCompatibleProvider } from "../../src/ai/openAiCompatibleProvider";
import type { AiSelectionResult } from "../../src/ai/aiProvider";
import type { OperationScope } from "../../src/scope/operationScope";

const root = path.resolve("/workspace/repo");
const scope: OperationScope = {
  id: "scope",
  repositoryRoot: root,
  source: "workspace",
  roots: [
    {
      absolutePath: path.join(root, "src"),
      relativePath: "src",
      kind: "folder",
    },
  ],
  allowExpandScope: false,
  includeExternals: false,
  includeNestedWorkingCopies: false,
  createdAt: 0,
};

const emptyResult = (): AiSelectionResult => ({
  recommended: [],
  excluded: [],
  needsReview: [],
  blocked: [],
});

const expectStructureError = (input: unknown, issueFragment: string) => {
  try {
    normalizeAiSelectionResult(input);
    expect.unreachable("无效结构必须抛出 AiSelectionResultStructureError");
  } catch (error) {
    expect(error).toBeInstanceOf(AiSelectionResultStructureError);
    const issues = (error as AiSelectionResultStructureError).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join("；")).toContain(issueFragment);
  }
};

afterEach(() => vi.restoreAllMocks());

describe("AI 提交选择结果结构校验（V003-CR-04）", () => {
  it("空对象 {} 被拒绝：四个分类字段均缺失", () => {
    expectStructureError({}, "recommended");
    expectStructureError({}, "blocked");
  });

  it("缺失任一分类字段被拒绝", () => {
    expectStructureError(
      { recommended: [], excluded: [], needsReview: [] },
      "blocked",
    );
    expectStructureError({ blocked: [] }, "recommended");
  });

  it("分类字段非数组被拒绝", () => {
    expectStructureError({ ...emptyResult(), excluded: "bad" }, "excluded");
    expectStructureError(
      { ...emptyResult(), recommended: null },
      "recommended",
    );
    expectStructureError({ ...emptyResult(), needsReview: {} }, "needsReview");
  });

  it("顶层不是 JSON 对象被拒绝", () => {
    for (const input of [null, [], "bad", 42]) {
      expectStructureError(input, "JSON 对象");
    }
  });

  it("条目缺失 path、path 为空或 path 非字符串被拒绝", () => {
    expectStructureError(
      { ...emptyResult(), recommended: [{ reason: "r" }] },
      "recommended[0]",
    );
    expectStructureError(
      { ...emptyResult(), recommended: [{ path: "   ", reason: "r" }] },
      "path",
    );
    expectStructureError(
      { ...emptyResult(), recommended: [{ path: 1, reason: null }] },
      "recommended[0]",
    );
  });

  it("条目 reason 缺失或不是字符串被拒绝", () => {
    expectStructureError(
      { ...emptyResult(), recommended: [{ path: "src/a.ts" }] },
      "reason",
    );
    expectStructureError(
      { ...emptyResult(), blocked: [{ path: "src/a.ts", reason: 1 }] },
      "blocked[0]",
    );
  });

  it("同一路径跨分类重复被拒绝", () => {
    expectStructureError(
      {
        ...emptyResult(),
        recommended: [{ path: "src/a.ts", reason: "推荐" }],
        blocked: [{ path: "src/a.ts", reason: "阻止" }],
      },
      "跨分类重复",
    );
    expectStructureError(
      {
        ...emptyResult(),
        excluded: [{ path: "src/a.ts", reason: "排除" }],
        needsReview: [{ path: " src/a.ts ", reason: "待确认" }],
      },
      "src/a.ts",
    );
  });

  it("合法结果正常通过：path 去空白、空 reason 使用默认文案", () => {
    const normalized = normalizeAiSelectionResult({
      recommended: [{ path: " src/a.ts ", reason: " " }],
      excluded: [{ path: "dist/app.js", reason: "生成物" }],
      needsReview: [],
      blocked: [],
    });
    expect(normalized).toEqual({
      recommended: [{ path: "src/a.ts", reason: "AI 未提供原因" }],
      excluded: [{ path: "dist/app.js", reason: "生成物" }],
      needsReview: [],
      blocked: [],
    });
  });

  it("合法结果的后续范围与候选集合校验不受影响", () => {
    const sourceFile = path.join(root, "src", "a.ts");
    const validated = validateAiSelectionResult(
      scope,
      {
        recommended: [
          { path: "src/a.ts", reason: "ok" },
          { path: "src/invented.ts", reason: "not allowed" },
          { path: "../outside.ts", reason: "outside" },
        ],
        excluded: [],
        needsReview: [],
        blocked: [],
      },
      [sourceFile],
    );
    expect(validated.recommended.map((item) => item.path)).toEqual([
      sourceFile,
    ]);
  });
});

describe("OpenAiCompatibleProvider.selectFiles 无效结构降级（V003-CR-04）", () => {
  const provider = () =>
    new OpenAiCompatibleProvider({
      baseUrl: "https://ai.test/v1/",
      model: "m",
      apiKey: "k",
    });

  const completion = (content: string) =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ choices: [{ message: { content } }] }),
    }) as Response;

  it("模型返回 {} 时 selectFiles 抛结构化错误，而不是返回四个空数组", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(completion("{}"));
    const error = await provider()
      .selectFiles({} as never)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AiSelectionResultStructureError);
    expect((error as AiSelectionResultStructureError).message).toContain(
      "recommended",
    );
  });

  it("模型返回跨分类重复路径时 selectFiles 抛结构化错误", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      completion(
        JSON.stringify({
          recommended: [{ path: "src/a.ts", reason: "推荐" }],
          excluded: [],
          needsReview: [{ path: "src/a.ts", reason: "待确认" }],
          blocked: [],
        }),
      ),
    );
    await expect(provider().selectFiles({} as never)).rejects.toThrow(
      "跨分类重复",
    );
  });

  it("模型返回完整四分类结构时 selectFiles 正常解析", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      completion(
        '```json\n{"recommended":[{"path":"src/a.ts","reason":"常规变更"}],"excluded":[],"needsReview":[],"blocked":[]}\n```',
      ),
    );
    const result = await provider().selectFiles({} as never);
    expect(result.recommended).toEqual([
      { path: "src/a.ts", reason: "常规变更" },
    ]);
    expect(result.blocked).toEqual([]);
  });
});
