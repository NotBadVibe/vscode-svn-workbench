import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspace, ConfigurationTarget } from "vscode";
import {
  AI_API_KEY_SECRET_KEY,
  getAiProviderPreset,
  getScenarioModel,
  normalizeAiBaseUrl,
  readStoredAiConfiguration,
  resolveAiProviderConfig,
  saveAiConfiguration,
  validateAiProviderConfig,
} from "../../src/ai/aiModelConfiguration";
import {
  normalizeAiSelectionResult,
  validateAiSelectionResult,
} from "../../src/ai/aiResultValidator";
import { OpenAiCompatibleProvider } from "../../src/ai/openAiCompatibleProvider";
import type { OperationScope } from "../../src/scope/operationScope";

function response(body: unknown, ok = true, status = 200, statusText = "OK") {
  return { ok, status, statusText, json: async () => body } as Response;
}

function memoryContext(initialSecret = "") {
  let secret = initialSecret;
  return {
    secrets: {
      get: vi.fn(async () => secret || undefined),
      store: vi.fn(async (_key: string, value: string) => {
        secret = value;
      }),
      delete: vi.fn(async () => {
        secret = "";
      }),
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("AI 配置与结果安全边界", () => {
  it("规范化不可信选择并同时应用范围与候选白名单", () => {
    const root = path.resolve("/workspace/repo");
    const sourceFile = path.join(root, "src", "a.ts");
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
    // V003-CR-04：结构无效（缺分类字段、字段非数组、条目缺 path）现在
    // 整体抛错拒绝，宽松输入的拒绝用例见 aiSelectionResultValidation.test.ts；
    // 此处保留合法输入的规范化（trim、空 reason 兜底）与范围/候选校验。
    const normalized = normalizeAiSelectionResult({
      recommended: [{ path: " src/a.ts ", reason: " " }],
      excluded: [],
      needsReview: [],
      blocked: [],
    });
    expect(normalized.recommended).toEqual([
      { path: "src/a.ts", reason: "AI 未提供原因" },
    ]);
    expect(normalized.excluded).toEqual([]);
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

  it("读取、保存并按场景解析 SecretStorage 中的 AI 配置", async () => {
    const values = new Map<string, unknown>([
      ["providerPreset", "custom"],
      ["baseUrl", "https://ai.example.test/v1/"],
      ["model", "default-model"],
      ["scenarioModels", { conflictAdvice: "strong-model", unknown: "drop" }],
      ["apiKey", ""],
    ]);
    const update = vi.fn(
      async (key: string, value: unknown, target: unknown) => {
        expect(target).toBe(ConfigurationTarget.Global);
        values.set(key, value);
      },
    );
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: ((key: string, fallback?: unknown) =>
        values.get(key) ?? fallback) as never,
      update,
    } as never);
    const context = memoryContext("secret-key");

    expect(
      (await readStoredAiConfiguration(context as never)).scenarioModels,
    ).toEqual({ conflictAdvice: "strong-model" });
    await saveAiConfiguration(context as never, {
      providerPreset: "custom",
      baseUrl: "https://next.example.test/v1///",
      model: " next ",
      scenarioModels: { commitMessage: " writer ", conflictAdvice: " " },
      apiKey: " replacement ",
      includeCommitHistory: true,
      historyLimit: 25,
    });
    expect(update).toHaveBeenCalledTimes(6);
    expect(values.get("includeCommitHistory")).toBe(true);
    expect(values.get("historyLimit")).toBe(20);
    expect(context.secrets.store).toHaveBeenCalledWith(
      AI_API_KEY_SECRET_KEY,
      "replacement",
    );
    expect(
      await resolveAiProviderConfig(context as never, "commitMessage"),
    ).toEqual({
      baseUrl: "https://next.example.test/v1",
      model: "writer",
      apiKey: "replacement",
    });
    await saveAiConfiguration(context as never, {
      providerPreset: "custom",
      baseUrl: "https://next.example.test",
      model: "next",
      clearApiKey: true,
    });
    expect(context.secrets.delete).toHaveBeenCalled();
  });

  it("覆盖预设、URL、场景模型和缺失配置分支", async () => {
    expect(getAiProviderPreset("missing").id).toBe("deepseek");
    expect(normalizeAiBaseUrl(" https://a.test/// ")).toBe("https://a.test");
    expect(
      getScenarioModel(
        " base ",
        { commitMessage: " chosen " },
        "commitMessage",
      ),
    ).toBe("chosen");
    expect(getScenarioModel(" base ", undefined)).toBe("base");
    expect(validateAiProviderConfig({}).issues).toHaveLength(3);
    vi.spyOn(workspace, "getConfiguration").mockReturnValue({
      get: () => "",
    } as never);
    await expect(
      resolveAiProviderConfig(memoryContext() as never),
    ).rejects.toThrow("AI 提供方尚未配置");
  });
});

describe("OpenAI-compatible Provider", () => {
  const provider = () =>
    new OpenAiCompatibleProvider({
      baseUrl: "https://ai.test/v1/",
      model: "m",
      apiKey: "k",
    });

  it("覆盖模型、连接和全部结构化场景", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        response({ data: [{ id: "z", owner: "o" }, { id: 1 }, { id: "a" }] }),
      )
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: '{"ok":true}' } }] }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                // V003-CR-04：四分类字段必须齐全，缺字段的响应会被拒绝。
                content:
                  '```json\n{"recommended":[{"path":"a","reason":"r"}],"excluded":[],"needsReview":[],"blocked":[]}\n```',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                content: '{"message":"feat: x","summary":"x","warnings":[]}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [{ message: { content: '{"splits":[],"warnings":[]}' } }],
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                content:
                  '{"summary":"s","reasons":[],"warnings":[],"confidence":"high","commitConvention":{}}',
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          choices: [
            {
              message: {
                content:
                  '{"recommendation":"manualMerge","confidence":"medium","summary":"s","risks":[],"steps":[]}',
              },
            },
          ],
        }),
      );
    const value = provider();
    expect(await value.listModels()).toEqual([
      { id: "a", owner: undefined },
      { id: "z", owner: "o" },
    ]);
    await expect(value.testConnection()).resolves.toBeUndefined();
    expect((await value.selectFiles({} as never)).recommended[0].path).toBe(
      "a",
    );
    expect((await value.generateCommitMessage({} as never)).message).toBe(
      "feat: x",
    );
    expect((await value.suggestCommitSplits({} as never)).splits).toEqual([]);
    expect((await value.recommendTeamRules({} as never)).confidence).toBe(
      "high",
    );
    expect((await value.adviseConflict({} as never)).recommendation).toBe(
      "manualMerge",
    );
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(fetchMock.mock.calls[0][0]).toBe("https://ai.test/v1/models");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://ai.test/v1/chat/completions",
    );
  });

  it("拒绝 HTTP 错误、空响应和非法 JSON", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({}, false, 401, "Unauthorized"))
      .mockResolvedValueOnce(response({}, false, 503, "Unavailable"))
      .mockResolvedValueOnce(response({ choices: [] }))
      .mockResolvedValueOnce(
        response({ choices: [{ message: { content: "not json" } }] }),
      );
    const value = provider();
    await expect(value.listModels()).rejects.toThrow("401 Unauthorized");
    await expect(value.testConnection()).rejects.toThrow("503 Unavailable");
    await expect(value.testConnection()).rejects.toThrow("没有消息正文");
    await expect(value.selectFiles({} as never)).rejects.toThrow();
  });
});
