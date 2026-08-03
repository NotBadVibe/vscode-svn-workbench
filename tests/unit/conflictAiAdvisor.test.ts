import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildConflictAiRequest,
  containsSvnConflictMarkers,
  createMockConflictAdvice,
  normalizeConflictAdvice,
} from "../../src/ai/conflictAiAdvisor";
import type { SvnConflictItem } from "../../src/conflict/conflictCollector";

const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true })),
  ),
);

describe("冲突 AI 内容边界", () => {
  it("区分冲突标记、一致两侧、可用 Working 与无安全建议", () => {
    const base = {
      relativePath: "x",
      operation: "update",
      type: "text",
    } as const;
    expect(
      createMockConflictAdvice({
        ...base,
        contents: {
          working: {
            path: "x",
            content: "<<<<<<< mine\na\n=======\nb\n>>>>>>> theirs",
            truncated: false,
          },
        },
      }).recommendation,
    ).toBe("manualMerge");
    expect(containsSvnConflictMarkers("<<<<<<<\na\n=======\nb\n>>>>>>>")).toBe(
      true,
    );
    expect(containsSvnConflictMarkers("<<<<<<< only")).toBe(false);
    expect(
      createMockConflictAdvice({
        ...base,
        contents: {
          mine: { path: "m", content: "same\r\n", truncated: false },
          theirs: { path: "t", content: "same\n", truncated: false },
          working: { path: "w", content: "same", truncated: false },
        },
      }).confidence,
    ).toBe("high");
    expect(
      createMockConflictAdvice({
        ...base,
        contents: {
          working: { path: "w", content: "merged", truncated: false },
        },
      }).confidence,
    ).toBe("medium");
    expect(
      createMockConflictAdvice({ ...base, contents: {} }).recommendation,
    ).toBe("noSafeSuggestion");
  });

  it("读取文本、截断二进制并把缺失文件转为可解释错误", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "conflict-ai-"));
    roots.push(root);
    const text = path.join(root, "text.txt");
    const binary = path.join(root, "binary.bin");
    await fs.writeFile(text, "abcdef");
    await fs.writeFile(binary, Buffer.from([1, 0, 2]));
    const item: SvnConflictItem = {
      absolutePath: text,
      relativePath: "text.txt",
      workingFile: text,
      mineFile: binary,
      baseFile: path.join(root, "missing"),
      theirsFile: undefined,
    };
    const request = await buildConflictAiRequest(item, 3);
    expect(request.contents.working).toEqual(
      expect.objectContaining({ content: "abc", truncated: true }),
    );
    expect(request.contents.mine).toEqual(
      expect.objectContaining({
        readError: "binary-or-null-byte-content",
        truncated: false,
      }),
    );
    expect(request.contents.base?.readError).toBeTruthy();
    expect(request.contents.theirs).toBeUndefined();
  });

  it("规范化模型返回的枚举、单行文本和数组", () => {
    expect(
      normalizeConflictAdvice({
        recommendation: "invented" as never,
        confidence: "certain" as never,
        summary: "  多行\n 摘要 ",
        risks: [" r ", 1, ""],
        steps: "bad" as never,
      }),
    ).toEqual({
      recommendation: "noSafeSuggestion",
      confidence: "low",
      summary: "多行 摘要",
      risks: ["r"],
      steps: [],
    });
    expect(
      normalizeConflictAdvice({
        recommendation: "acceptMine",
        confidence: "high",
      }).summary,
    ).toBe("AI 未返回明确摘要。");
  });
});
