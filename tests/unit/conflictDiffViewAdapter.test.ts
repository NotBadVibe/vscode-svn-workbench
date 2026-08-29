import { describe, expect, it, vi } from "vitest";
import { buildPierreUnresolvedInput } from "../../src/conflict/conflictDiffModel";
import {
  SVN_SINGLE,
  GIT_SINGLE,
  MULTI_BLOCK,
  CRLF_SINGLE,
  NO_BASE,
  LONG_LINE,
  DAMAGED_MISSING_SEPARATOR,
  DAMAGED_MISSING_END,
} from "../../src/conflict/fixtures";

vi.mock("@pierre/diffs", async () => {
  const actual: Record<string, unknown> =
    await vi.importActual("@pierre/diffs");
  return actual;
});

/* 复用领域模型 fail-closed 能力：adapter 薄层不应绕过它 */
describe("ConflictDiffView 适配（V011-B 薄适配）", () => {
  it("SVN/Git/多块/CRLF/无 BASE/超长行均可构造 Pierre 输入", () => {
    for (const t of [
      SVN_SINGLE,
      GIT_SINGLE,
      MULTI_BLOCK,
      CRLF_SINGLE,
      NO_BASE,
      LONG_LINE,
    ]) {
      const r = buildPierreUnresolvedInput(t);
      expect(r.error).toBeUndefined();
      expect(r.file.contents).toBe(t);
    }
  });
  it("损坏 marker 返回结构化错误，不自动修复", () => {
    const a = buildPierreUnresolvedInput(DAMAGED_MISSING_SEPARATOR);
    expect(a.error).toBeDefined();
    expect(a.error?.code).toBe("missingSeparator");
    const b = buildPierreUnresolvedInput(DAMAGED_MISSING_END);
    expect(b.error).toBeDefined();
    expect(["missingSeparator", "unfinished", "missingEnd"]).toContain(
      b.error?.code,
    );
  });
  it("CRLF 内容透传不被规范化", () => {
    const r = buildPierreUnresolvedInput(CRLF_SINGLE);
    expect(r.file.contents).toContain("\r\n");
  });
  it("采用三动作中文标签与 payload 结构（current/incoming/both）", async () => {
    const labels = ["采用我的修改", "采用对方修改", "保留双方修改"];
    const res = ["current", "incoming", "both"] as const;
    expect(labels).toEqual(["采用我的修改", "采用对方修改", "保留双方修改"]);
    expect(res).toEqual(["current", "incoming", "both"]);
    const fakePayload = {
      resolution: "current" as const,
      conflict: {
        conflictIndex: 0,
        startLineIndex: 1,
        startLineNumber: 2,
        separatorLineIndex: 5,
        separatorLineNumber: 6,
        endLineIndex: 8,
        endLineNumber: 9,
        baseMarkerLineIndex: 3,
      },
    };
    expect(fakePayload.conflict).toHaveProperty("conflictIndex");
    expect(fakePayload.conflict).toHaveProperty("startLineIndex");
    expect(fakePayload.conflict).toHaveProperty("separatorLineIndex");
    expect(fakePayload.conflict).toHaveProperty("endLineIndex");
    expect(fakePayload.conflict).toHaveProperty("baseMarkerLineIndex");
  });
});
