import { describe, expect, it } from "vitest";
import {
  COMMIT_HANDOFF_SELECTION_VERSION,
  buildCommitHandoff,
  createCommitHandoffView,
  isStaleCommitHandoff,
  selectCommitHandoffForSnapshot,
} from "../../src/commit/commitHandoff";
import {
  isCommitHandoffView,
  isCommitSnapshot,
} from "../../src/protocol/workbenchProtocol";
import type { CommitSelectionCandidateView } from "../../src/commit/commitSelectionValidation";

function candidate(
  relativePath: string,
  selection: CommitSelectionCandidateView["selection"] = "selected",
): CommitSelectionCandidateView {
  return { relativePath, selection };
}

const candidates = [
  candidate("a.ts"),
  candidate("b.ts", "needsReview"),
  candidate("excluded.ts", "excluded"),
  candidate("blocked.ts", "blocked"),
];

describe("buildCommitHandoff 整批复验", () => {
  it("全合法 → accepted，原样保留", () => {
    const result = buildCommitHandoff(["a.ts", "b.ts"], candidates);
    expect(result.verdict).toBe("accepted");
    expect(result.kept).toEqual(["a.ts", "b.ts"]);
    expect(result.removedEntries).toEqual([]);
    expect(result.requestedCount).toBe(2);
    expect(result.keptCount).toBe(2);
  });

  it("部分非法 → shrunk，收缩为合法交集并逐项给中文原因", () => {
    const result = buildCommitHandoff(
      ["a.ts", "ghost.ts", "excluded.ts", "blocked.ts"],
      candidates,
    );
    expect(result.verdict).toBe("shrunk");
    expect(result.kept).toEqual(["a.ts"]);
    expect(result.requestedCount).toBe(4);
    expect(result.keptCount).toBe(1);
    expect(result.removedEntries).toEqual([
      {
        path: "ghost.ts",
        reason: "disappeared",
        message: "“ghost.ts”已从工作副本快照中消失",
      },
      {
        path: "excluded.ts",
        reason: "excluded",
        message: "“excluded.ts”已变为排除项",
      },
      {
        path: "blocked.ts",
        reason: "blocked",
        message: "“blocked.ts”为阻止项，暂不能提交",
      },
    ]);
  });

  it("全部非法 → rejected，kept 为空", () => {
    const result = buildCommitHandoff(
      ["ghost.ts", "excluded.ts", "blocked.ts"],
      candidates,
    );
    expect(result.verdict).toBe("rejected");
    expect(result.kept).toEqual([]);
    expect(result.removedEntries).toHaveLength(3);
  });

  it("空交接 → accepted（调用方按非交接处理）", () => {
    const result = buildCommitHandoff([], candidates);
    expect(result.verdict).toBe("accepted");
    expect(result.kept).toEqual([]);
  });

  it("重复路径去重（保持首次顺序），不虚构移除原因", () => {
    const result = buildCommitHandoff(["a.ts", "a.ts", "b.ts"], candidates);
    expect(result.verdict).toBe("accepted");
    expect(result.kept).toEqual(["a.ts", "b.ts"]);
    expect(result.requestedCount).toBe(2);
  });

  it("kept 恒为 requested 子集：只缩不扩，不补入新文件", () => {
    const result = buildCommitHandoff(["a.ts", "ghost.ts"], candidates);
    const requested = new Set(["a.ts", "ghost.ts"]);
    for (const kept of result.kept) {
      expect(requested.has(kept)).toBe(true);
    }
    // 候选中合法但未请求的 b.ts 不得自动加入。
    expect(result.kept).not.toContain("b.ts");
  });

  it("跨仓库交接不合并：另一仓库的候选在当前仓库全为消失 → rejected", () => {
    const repoBCandidates = [candidate("other/b.ts")];
    const result = buildCommitHandoff(["a.ts", "b.ts"], repoBCandidates);
    expect(result.verdict).toBe("rejected");
    expect(result.kept).toEqual([]);
    expect(
      result.removedEntries.every((entry) => entry.reason === "disappeared"),
    ).toBe(true);
  });

  it("V014-E3 必修 4：同名路径异仓库 → cross-repository 整批拒绝", () => {
    // 同名 a.ts 在当前仓库合法，但来源仓库不同：不得误判 accepted。
    const result = buildCommitHandoff(["a.ts"], candidates, {
      currentRepositoryUuid: "uuid-A",
      originRepositoryUuid: "uuid-B",
    });
    expect(result.verdict).toBe("rejected");
    expect(result.kept).toEqual([]);
    expect(result.requestedCount).toBe(1);
    expect(result.keptCount).toBe(0);
    expect(result.removedEntries).toEqual([
      {
        path: "a.ts",
        reason: "cross-repository",
        message: '"a.ts"属于其他仓库，不能与当前仓库合并提交',
      },
    ]);
  });

  it("V014-E3 必修 4：仓库 UUID 一致时不受跨仓库分支影响", () => {
    const result = buildCommitHandoff(["a.ts"], candidates, {
      currentRepositoryUuid: "uuid-A",
      originRepositoryUuid: "uuid-A",
    });
    expect(result.verdict).toBe("accepted");
    expect(result.kept).toEqual(["a.ts"]);
  });

  it("V014-E3 必修 4：缺省仓库信息时保持原有消失口径", () => {
    const result = buildCommitHandoff(["ghost.ts"], candidates);
    expect(result.verdict).toBe("rejected");
    expect(result.removedEntries[0].reason).toBe("disappeared");
  });
});

describe("createCommitHandoffView 与版本", () => {
  it("来源固定 changes，版本与当前常量一致", () => {
    const view = createCommitHandoffView(
      buildCommitHandoff(["a.ts", "ghost.ts"], candidates),
      "2026-09-03T00:00:00.000Z",
    );
    expect(view.source).toBe("changes");
    expect(view.selectionVersion).toBe(COMMIT_HANDOFF_SELECTION_VERSION);
    expect(view.requestedCount).toBe(2);
    expect(view.keptCount).toBe(1);
    expect(view.receivedAt).toBe("2026-09-03T00:00:00.000Z");
    expect(isCommitHandoffView(view)).toBe(true);
  });

  it("旧版本/未来版本一律 stale，快照挂载时忽略", () => {
    const view = createCommitHandoffView(
      buildCommitHandoff(["a.ts"], candidates),
    );
    expect(isStaleCommitHandoff(view)).toBe(false);
    expect(isStaleCommitHandoff(undefined)).toBe(false);
    expect(selectCommitHandoffForSnapshot(undefined)).toBeUndefined();
    expect(selectCommitHandoffForSnapshot(view)).toBe(view);
    const stale = { ...view, selectionVersion: 999 };
    expect(isStaleCommitHandoff(stale)).toBe(true);
    expect(selectCommitHandoffForSnapshot(stale)).toBeUndefined();
  });
});

describe("isCommitHandoffView 守卫（缺省合法/非法拒绝）", () => {
  const valid = createCommitHandoffView(
    buildCommitHandoff(["a.ts"], candidates),
  );

  it("接受合法交接", () => {
    expect(isCommitHandoffView(valid)).toBe(true);
    expect(isCommitHandoffView({ ...valid, removedEntries: [] })).toBe(true);
  });

  it("拒绝来源/版本/数量非法", () => {
    expect(isCommitHandoffView({ ...valid, source: "history" })).toBe(false);
    expect(isCommitHandoffView({ ...valid, selectionVersion: NaN })).toBe(
      false,
    );
    expect(isCommitHandoffView({ ...valid, requestedCount: "2" })).toBe(false);
    expect(isCommitHandoffView({ ...valid, receivedAt: 42 })).toBe(false);
    expect(isCommitHandoffView(undefined)).toBe(false);
    expect(isCommitHandoffView(null)).toBe(false);
  });

  it("拒绝移除项原因非法或中文说明缺失", () => {
    expect(
      isCommitHandoffView({
        ...valid,
        removedEntries: [{ path: "x", reason: "nope", message: "错" }],
      }),
    ).toBe(false);
    expect(
      isCommitHandoffView({
        ...valid,
        removedEntries: [{ path: "x", reason: "blocked" }],
      }),
    ).toBe(false);
  });
});

describe("isCommitSnapshot 交接字段兼容", () => {
  const base = {
    kind: "commit",
    files: [],
    summary: {},
    selectedPaths: [],
    message: "",
  };

  it("无 handoff 的旧快照继续接受", () => {
    expect(isCommitSnapshot(base)).toBe(true);
  });

  it("携带合法 handoff 接受，非法 handoff 整快照拒绝", () => {
    const valid = createCommitHandoffView(
      buildCommitHandoff(["a.ts"], candidates),
    );
    expect(isCommitSnapshot({ ...base, handoff: valid })).toBe(true);
    expect(
      isCommitSnapshot({ ...base, handoff: { ...valid, source: "diff" } }),
    ).toBe(false);
  });
});
