import { describe, expect, it } from "vitest";
import {
  establishReviewQueue,
  hashReviewContent,
  intersectReviewQueue,
  isReviewFresh,
  navigateReviewQueue,
  normalizeReviewPath,
  toReviewQueueView,
} from "../../src/diff/reviewQueue";
import {
  isDiffReviewQueueView,
  isDiffSnapshot,
  webviewActions,
} from "../../src/protocol/workbenchProtocol";

/*
 * V023-R18 · 连续多文件审阅队列纯领域契约。
 * 平台无关：只用字符串字面量断言，不用宿主 path.resolve 构造期望。
 */
describe("reviewQueue 领域模型（V023-R18）", () => {
  it("内容指纹稳定且区分内容（平台无关 FNV-1a）", () => {
    expect(hashReviewContent("const a = 1;\n")).toBe(
      hashReviewContent("const a = 1;\n"),
    );
    expect(hashReviewContent("const a = 1;\n")).not.toBe(
      hashReviewContent("const a = 2;\n"),
    );
    expect(hashReviewContent("")).toMatch(/^[0-9a-f]{8}$/);
  });

  it("路径归一：反斜杠统一、去空白与 ./ 前缀，非法拒绝", () => {
    expect(normalizeReviewPath("src/a.ts")).toBe("src/a.ts");
    expect(normalizeReviewPath("src\\a.ts")).toBe("src/a.ts");
    expect(normalizeReviewPath("  src/a.ts  ")).toBe("src/a.ts");
    expect(normalizeReviewPath("./src/a.ts")).toBe("src/a.ts");
    expect(normalizeReviewPath("")).toBeUndefined();
    expect(normalizeReviewPath("..")).toBeUndefined();
    expect(normalizeReviewPath("src/../etc/passwd")).toBeUndefined();
    expect(normalizeReviewPath(42)).toBeUndefined();
  });

  it("从明确选择建队列：保序去重，不补不排序", () => {
    const { queue, removed } = establishReviewQueue([
      "src/b.ts",
      "src/a.ts",
      "src/b.ts",
      "",
      "src/a.ts",
    ]);
    expect(queue).toEqual(["src/b.ts", "src/a.ts"]);
    expect(removed.map((entry) => entry.reason)).toEqual([
      "duplicate",
      "invalid",
      "duplicate",
    ]);
  });

  it("范围刷新只求交缩小：永不新增，逐项说明", () => {
    const { kept, removed } = intersectReviewQueue(
      ["src/a.ts", "src/deleted.ts", "src/b.ts"],
      (item) => item !== "src/deleted.ts",
    );
    expect(kept).toEqual(["src/a.ts", "src/b.ts"]);
    expect(removed).toHaveLength(1);
    expect(removed[0].path).toBe("src/deleted.ts");
  });

  it("已看绑定指纹：一致才已看，变化即待审阅", () => {
    expect(isReviewFresh("abc123", "abc123")).toBe(true);
    expect(isReviewFresh("abc123", "def456")).toBe(false);
    expect(isReviewFresh(undefined, "abc123")).toBe(false);
  });

  it("队列导航：越界返回 undefined（调用方给非阻塞反馈）", () => {
    const queue = ["src/a.ts", "src/b.ts", "src/c.ts"];
    expect(navigateReviewQueue(queue, "src/a.ts", -1)).toBeUndefined();
    expect(navigateReviewQueue(queue, "src/a.ts", 1)).toBe("src/b.ts");
    expect(navigateReviewQueue(queue, "src/c.ts", 1)).toBeUndefined();
    expect(navigateReviewQueue(queue, "src/missing.ts", 1)).toBeUndefined();
  });

  it("下发视图：第 N/M 个与已看/未看计数", () => {
    const view = toReviewQueueView({
      queue: ["src/a.ts", "src/b.ts", "src/c.ts"],
      currentRelativePath: "src/b.ts",
      currentContentHash: "hash-b",
      reviewedHashes: { "src/a.ts": "hash-a", "src/b.ts": "hash-b" },
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
    });
    expect(view.index).toBe(1);
    expect(view.total).toBe(3);
    expect(view.reviewedCount).toBe(2);
    expect(view.unreviewedCount).toBe(1);
    // 当前项经指纹比对；非当前项仅表示曾标记（打开时 Host 复验）。
    expect(view.queue[1]).toMatchObject({
      relativePath: "src/b.ts",
      contentHash: "hash-b",
      current: true,
      reviewed: true,
    });
    expect(view.queue[0]).toMatchObject({
      relativePath: "src/a.ts",
      contentHash: "",
      current: false,
      reviewed: true,
    });
    expect(view.queue[2].reviewed).toBe(false);
  });
});

/*
 * V023-R18 · 协议守卫：review 可选、畸形 fail-closed；动作清单同步。
 */
describe("reviewQueue 协议守卫（V023-R18）", () => {
  const baseSnapshot = {
    kind: "diff",
    relativePath: "src/a.ts",
    original: "a",
    modified: "b",
    language: "typescript",
    truncated: false,
    binary: false,
  };

  function validReview(): Record<string, unknown> {
    return {
      queue: [
        {
          relativePath: "src/a.ts",
          contentHash: "h1",
          current: true,
          reviewed: false,
        },
        {
          relativePath: "src/b.ts",
          contentHash: "",
          current: false,
          reviewed: true,
        },
      ],
      index: 0,
      total: 2,
      reviewedCount: 1,
      unreviewedCount: 1,
      scopeHash: "scope-1",
      repositoryUuid: "repo-1",
    };
  }

  it("无 review 的旧快照继续接受（单文件模式向后兼容）", () => {
    expect(isDiffSnapshot(baseSnapshot)).toBe(true);
  });

  it("合法 review 通过守卫", () => {
    expect(isDiffReviewQueueView(validReview())).toBe(true);
    expect(isDiffSnapshot({ ...baseSnapshot, review: validReview() })).toBe(
      true,
    );
  });

  it("畸形 review 一律拒绝（fail-closed，不扩大范围）", () => {
    const cases: unknown[] = [
      { ...validReview(), queue: [] },
      { ...validReview(), total: 3 },
      { ...validReview(), index: 5 },
      { ...validReview(), reviewedCount: 2, unreviewedCount: 2 },
      {
        ...validReview(),
        queue: [
          { relativePath: "", contentHash: "", current: true, reviewed: false },
        ],
        index: 0,
        total: 1,
        reviewedCount: 0,
        unreviewedCount: 1,
      },
      { ...validReview(), scopeHash: 42 },
      "not-an-object",
    ];
    for (const review of cases) {
      expect(isDiffReviewQueueView(review)).toBe(false);
      expect(isDiffSnapshot({ ...baseSnapshot, review })).toBe(false);
    }
    // review 缺省（undefined）即单文件模式，旧快照继续接受。
    expect(isDiffReviewQueueView(undefined)).toBe(false);
    expect(isDiffSnapshot({ ...baseSnapshot, review: undefined })).toBe(true);
  });

  it("diff/mark-reviewed 在字面量联合与运行时清单双处同步", () => {
    expect(webviewActions).toContain("diff/mark-reviewed");
  });
});
