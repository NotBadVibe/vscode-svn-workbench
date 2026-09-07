import { describe, expect, it } from "vitest";
import {
  isFileTargetView,
  isHistoryQueryView,
  isHistorySnapshot,
} from "../../src/protocol/workbenchProtocol";

const validHistory = {
  kind: "history",
  revisions: [],
  compareRevisions: [],
  limit: 100,
  fileActionsAvailable: true,
};

describe("historyProtocolGuards: isHistoryQueryView", () => {
  it("接受空条件与完整合法条件", () => {
    expect(isHistoryQueryView({})).toBe(true);
    expect(
      isHistoryQueryView({
        revisionFrom: "10",
        revisionTo: "20",
        author: "alice",
        dateFrom: "2026-07-01",
        dateTo: "2026-07-30",
      }),
    ).toBe(true);
    expect(isHistoryQueryView({ author: "bob" })).toBe(true);
  });

  it("拒绝非 record", () => {
    expect(isHistoryQueryView(null)).toBe(false);
    expect(isHistoryQueryView([])).toBe(false);
    expect(isHistoryQueryView("author=alice")).toBe(false);
    expect(isHistoryQueryView(42)).toBe(false);
  });

  it("逐字段拒绝类型错误", () => {
    expect(isHistoryQueryView({ revisionFrom: 42 })).toBe(false);
    expect(isHistoryQueryView({ revisionTo: 42 })).toBe(false);
    expect(isHistoryQueryView({ author: 42 })).toBe(false);
    expect(isHistoryQueryView({ dateFrom: 42 })).toBe(false);
    expect(isHistoryQueryView({ dateTo: 42 })).toBe(false);
    expect(isHistoryQueryView({ revisionFrom: null })).toBe(false);
    expect(isHistoryQueryView({ author: ["alice"] })).toBe(false);
    expect(isHistoryQueryView({ dateFrom: {} })).toBe(false);
  });
});

describe("historyProtocolGuards: isFileTargetView", () => {
  it("接受合法目标（含失效原因）", () => {
    expect(isFileTargetView({ relativePath: "src/a.ts" })).toBe(true);
    expect(
      isFileTargetView({ relativePath: "src/a.ts", notice: "已显示目录历史" }),
    ).toBe(true);
  });

  it("拒绝非 record 与 relativePath 畸形（P1-1 缺口：relativePath=42）", () => {
    expect(isFileTargetView(null)).toBe(false);
    expect(isFileTargetView([])).toBe(false);
    expect(isFileTargetView({})).toBe(false);
    expect(isFileTargetView({ relativePath: 42 })).toBe(false);
    expect(isFileTargetView({ relativePath: "" })).toBe(false);
    expect(isFileTargetView({ relativePath: null })).toBe(false);
    expect(isFileTargetView({ relativePath: ["src/a.ts"] })).toBe(false);
  });

  it("拒绝 notice 类型错误", () => {
    expect(isFileTargetView({ relativePath: "src/a.ts", notice: 42 })).toBe(
      false,
    );
  });
});

describe("historyProtocolGuards: isHistorySnapshot", () => {
  it("旧快照缺省兼容：无 query/fileTarget 接受", () => {
    expect(isHistorySnapshot(validHistory)).toBe(true);
    expect(
      isHistorySnapshot({ ...validHistory, revisions: [{ revision: "12" }] }),
    ).toBe(true);
  });

  it("合法 query/fileTarget 接受", () => {
    expect(
      isHistorySnapshot({
        ...validHistory,
        query: { author: "alice" },
        fileTarget: { relativePath: "src/a.ts" },
      }),
    ).toBe(true);
    expect(
      isHistorySnapshot({
        ...validHistory,
        query: {},
        fileTarget: { relativePath: "src/a.ts", notice: "已回退目录历史" },
      }),
    ).toBe(true);
  });

  it("畸形 query/fileTarget 导致整快照拒绝", () => {
    expect(
      isHistorySnapshot({
        ...validHistory,
        query: { revisionFrom: 42 },
      }),
    ).toBe(false);
    expect(
      isHistorySnapshot({
        ...validHistory,
        query: { author: ["alice"] },
      }),
    ).toBe(false);
    expect(
      isHistorySnapshot({
        ...validHistory,
        fileTarget: { relativePath: 42 },
      }),
    ).toBe(false);
    expect(
      isHistorySnapshot({
        ...validHistory,
        fileTarget: { relativePath: "src/a.ts", notice: 42 },
      }),
    ).toBe(false);
  });

  it("拒绝非 record 与基础字段非法", () => {
    expect(isHistorySnapshot(null)).toBe(false);
    expect(isHistorySnapshot([])).toBe(false);
    expect(isHistorySnapshot({ ...validHistory, kind: "diff" })).toBe(false);
    expect(isHistorySnapshot({ ...validHistory, revisions: "x" })).toBe(false);
    expect(isHistorySnapshot({ ...validHistory, compareRevisions: "x" })).toBe(
      false,
    );
    expect(isHistorySnapshot({ ...validHistory, limit: "100" })).toBe(false);
    expect(isHistorySnapshot({ ...validHistory, limit: NaN })).toBe(false);
    expect(
      isHistorySnapshot({ ...validHistory, fileActionsAvailable: "yes" }),
    ).toBe(false);
  });
});
