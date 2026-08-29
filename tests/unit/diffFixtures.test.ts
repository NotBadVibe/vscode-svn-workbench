import { describe, expect, it } from "vitest";
import {
  generateDiffFixture,
  parseDiffFixtureId,
} from "../../src/webview/mocks/diffFixtures";

describe("diffFixtures（v0.1.0 V010-A 性能 fixture 生成器）", () => {
  it("解析合法 fixture ID（含可选标志）", () => {
    expect(parseDiffFixtureId("ts-5000-mid")).toEqual({
      language: "ts",
      lines: 5000,
      ratio: "mid",
      longLines: false,
      crlf: false,
      noTrailingNewline: false,
    });
    expect(parseDiffFixtureId("xml-100-large-longline-crlf-noeol")).toEqual({
      language: "xml",
      lines: 100,
      ratio: "large",
      longLines: true,
      crlf: true,
      noTrailingNewline: true,
    });
  });

  it("拒绝非法 ID（语言/行数/比例/标志越界）", () => {
    expect(parseDiffFixtureId("")).toBeUndefined();
    expect(parseDiffFixtureId("ts-100")).toBeUndefined();
    expect(parseDiffFixtureId("py-100-mid")).toBeUndefined();
    expect(parseDiffFixtureId("ts-0-mid")).toBeUndefined();
    expect(parseDiffFixtureId("ts-100-huge")).toBeUndefined();
    expect(parseDiffFixtureId("ts-100-mid-bogus")).toBeUndefined();
  });

  it("同一 ID 生成字节级一致的内容（确定性）", () => {
    const spec = parseDiffFixtureId("ts-1000-mid");
    expect(spec).toBeDefined();
    const first = generateDiffFixture(spec!);
    const second = generateDiffFixture(spec!);
    expect(first.original).toBe(second.original);
    expect(first.modified).toBe(second.modified);
    expect(first.hunkCount).toBeGreaterThan(0);
  });

  it("不同比例产生不同变更规模，大行数 fixture 行数正确", () => {
    const small = generateDiffFixture(parseDiffFixtureId("text-100-small")!);
    const large = generateDiffFixture(parseDiffFixtureId("text-100-large")!);
    expect(large.hunkCount).toBeGreaterThan(small.hunkCount);
    const big = generateDiffFixture(parseDiffFixtureId("ts-10000-mid")!);
    expect(big.original.split("\n")).toHaveLength(10001); // 含末尾空行
  });

  it("CRLF 与无末尾换行标志生效", () => {
    const crlf = generateDiffFixture(parseDiffFixtureId("json-100-mid-crlf")!);
    expect(crlf.original).toContain("\r\n");
    const noeol = generateDiffFixture(parseDiffFixtureId("ts-100-mid-noeol")!);
    expect(noeol.original.endsWith("\n")).toBe(false);
    const longline = generateDiffFixture(
      parseDiffFixtureId("ts-100-mid-longline")!,
    );
    expect(longline.original.split("\n")[0].length).toBeGreaterThanOrEqual(300);
  });
});
