import { describe, expect, it } from "vitest";
import {
  filterCommitSelectionByCandidates,
  validateCommitSelection,
  type CommitSelectionCandidateView,
} from "../../src/commit/commitSelectionValidation";

function candidate(
  relativePath: string,
  selection: CommitSelectionCandidateView["selection"] = "selected",
): CommitSelectionCandidateView {
  return { relativePath, selection };
}

describe("validateCommitSelection（批次 2 fail-closed）", () => {
  const candidates = [
    candidate("a.ts"),
    candidate("b.ts", "needsReview"),
    candidate("excluded.ts", "excluded"),
    candidate("blocked.ts", "blocked"),
  ];

  it("合法选择原样通过（保持顺序）", () => {
    expect(validateCommitSelection(["a.ts", "b.ts"], candidates)).toEqual({
      selectedPaths: ["a.ts", "b.ts"],
      missing: [],
      notSubmittable: [],
    });
  });

  it("候选缺失路径计入 missing", () => {
    const result = validateCommitSelection(["a.ts", "ghost.ts"], candidates);
    expect(result.missing).toEqual(["ghost.ts"]);
    expect(result.notSubmittable).toEqual([]);
  });

  it("excluded/blocked 计入 notSubmittable（不可提交）", () => {
    const result = validateCommitSelection(
      ["a.ts", "excluded.ts", "blocked.ts"],
      candidates,
    );
    expect(result.notSubmittable).toEqual(["excluded.ts", "blocked.ts"]);
    expect(result.missing).toEqual([]);
  });

  it("重复路径规范化为唯一（保持首次出现顺序），确定行为", () => {
    const result = validateCommitSelection(
      ["a.ts", "a.ts", "b.ts", "a.ts"],
      candidates,
    );
    expect(result.selectedPaths).toEqual(["a.ts", "b.ts"]);
    expect(result.missing).toEqual([]);
    expect(result.notSubmittable).toEqual([]);
  });

  it("空请求与空候选确定返回", () => {
    expect(validateCommitSelection([], candidates).selectedPaths).toEqual([]);
    expect(validateCommitSelection(["x.ts"], [])).toEqual({
      selectedPaths: ["x.ts"],
      missing: ["x.ts"],
      notSubmittable: [],
    });
  });

  it("不修改入参数组", () => {
    const requested = ["a.ts", "a.ts"];
    const snapshot = [...requested];
    validateCommitSelection(requested, candidates);
    expect(requested).toEqual(snapshot);
  });
});

describe("filterCommitSelectionByCandidates（旧状态清理）", () => {
  const candidates = [
    candidate("a.ts"),
    candidate("excluded.ts", "excluded"),
    candidate("blocked.ts", "blocked"),
  ];

  it("保留有效项，移除消失/excluded/blocked 并给出中文原因", () => {
    const result = filterCommitSelectionByCandidates(
      ["a.ts", "excluded.ts", "blocked.ts", "ghost.ts"],
      candidates,
    );
    expect(result.kept).toEqual(["a.ts"]);
    expect(result.removedReasons).toEqual([
      "“excluded.ts”已变为排除项",
      "“blocked.ts”已变为阻止项",
      "“ghost.ts”已从工作副本快照中消失",
    ]);
  });

  it("重复 relativePath 规范化为唯一：合法重复不在 kept 中重复（Task B）", () => {
    const result = filterCommitSelectionByCandidates(
      ["a.ts", "a.ts", "b.ts", "a.ts"],
      [candidate("a.ts"), candidate("b.ts")],
    );
    expect(result.kept).toEqual(["a.ts", "b.ts"]);
    expect(result.removedReasons).toEqual([]);
  });

  it("重复失效项只产生一条移除原因，不虚构重复 reason（Task B）", () => {
    const result = filterCommitSelectionByCandidates(
      ["x.ts", "x.ts", "blocked.ts", "blocked.ts"],
      [candidate("blocked.ts", "blocked")],
    );
    expect(result.kept).toEqual([]);
    expect(result.removedReasons).toEqual([
      "“x.ts”已从工作副本快照中消失",
      "“blocked.ts”已变为阻止项",
    ]);
  });

  it("新文件绝不自动加入", () => {
    const result = filterCommitSelectionByCandidates(
      ["a.ts"],
      [candidate("a.ts"), candidate("brand-new.ts")],
    );
    expect(result.kept).toEqual(["a.ts"]);
  });

  it("空选择与空候选确定返回", () => {
    expect(filterCommitSelectionByCandidates([], candidates).kept).toEqual([]);
    const allGone = filterCommitSelectionByCandidates(["x.ts"], []);
    expect(allGone.kept).toEqual([]);
    expect(allGone.removedReasons).toEqual(["“x.ts”已从工作副本快照中消失"]);
  });

  it("needsReview 保留（未变 blocked/excluded 时不自动移除）", () => {
    const result = filterCommitSelectionByCandidates(
      ["review.ts"],
      [candidate("review.ts", "needsReview")],
    );
    expect(result.kept).toEqual(["review.ts"]);
    expect(result.removedReasons).toEqual([]);
  });
});
