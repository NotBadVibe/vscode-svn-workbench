import { describe, expect, it } from "vitest";
import {
  NativeDiffContentProvider,
  SVN_BASE_DOCUMENT_SCHEME,
} from "../../src/extension/workbench/nativeDiffContentProvider";

describe("NativeDiffContentProvider", () => {
  it("URI 仅包含不透明随机句柄，内容可按句柄读取", () => {
    const provider = new NativeDiffContentProvider();
    const uri = provider.createBaseUri("session-a", "BASE 内容");

    expect(uri.scheme).toBe(SVN_BASE_DOCUMENT_SCHEME);
    expect(uri.toString()).not.toContain("BASE 内容");
    expect(uri.toString()).not.toContain("session-a");
    expect(uri.path).toMatch(/^\/[0-9a-f-]{36}$/i);
    expect(provider.provideTextDocumentContent(uri)).toBe("BASE 内容");
    provider.dispose();
  });

  it("替换或释放会话后旧 URI 明确过期", () => {
    const provider = new NativeDiffContentProvider();
    const oldUri = provider.createBaseUri("session-a", "old");
    const nextUri = provider.createBaseUri("session-a", "next");

    expect(() => provider.provideTextDocumentContent(oldUri)).toThrow(/已过期/);
    expect(provider.provideTextDocumentContent(nextUri)).toBe("next");
    provider.releaseSession("session-a");
    expect(() => provider.provideTextDocumentContent(nextUri)).toThrow(
      /已过期/,
    );
    provider.dispose();
  });
});
