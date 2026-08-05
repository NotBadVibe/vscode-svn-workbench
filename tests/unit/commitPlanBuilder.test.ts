/**
 * buildCommitPlanPreview 集成测试（V003-CR-02 回归，规划 5.4、9.1、9.4）：
 * 仅 SVN 属性变化候选（status=normal 且 propStatus=modified）从规则评估、
 * 候选采集到提交计划的完整链路 —— commitPaths 包含、addPaths/removePaths
 * 不包含、canCommit=true；并覆盖执行前状态复验路径（对应
 * WorkbenchController.executeCommit：执行前重新采集候选并用
 * hashCandidateState 与预览哈希比较），propStatus 变为冲突时旧预览失效、
 * 基于新候选重建的计划恢复阻止。
 *
 * I/O 处理方式与 commitSelectionRuntime.test.ts 相同：mock runSvnCommand，
 * 向真实采集、评估与计划构建链路喂入 fixture。
 */
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import type { SvnCommandResult } from "../../src/svn/svnTypes";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import { collectCommitCandidates } from "../../src/commit/commitCandidateCollector";
import { buildCommitPlanPreview } from "../../src/commit/commitPlanBuilder";
import { hashCandidateState } from "../../src/extension/workbench/workbenchSupport";

const repositoryRoot = path.join(os.tmpdir(), "svn-workbench-plan-wc");

function buildStatusXml(
  entries: Array<{ path: string; item: string; props?: string }>,
): string {
  const body = entries
    .map((entry) => {
      const props = entry.props ? ` props="${entry.props}"` : "";
      return `<entry path="${entry.path}"><wc-status item="${entry.item}"${props}></wc-status></entry>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><status><target path=".">${body}</target></status>`;
}

function buildSvnResult(stdout: string): SvnCommandResult {
  return {
    command: "svn",
    args: ["status", "--xml"],
    exitCode: 0,
    stdout,
    stderr: "",
    durationMs: 1,
  };
}

function createScope(): OperationScope {
  return {
    id: "plan-scope",
    repositoryRoot,
    source: "workspace",
    roots: [{ absolutePath: repositoryRoot, relativePath: "", kind: "folder" }],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

function requireCandidate(
  candidates: Awaited<ReturnType<typeof collectCommitCandidates>>,
  relativePath: string,
) {
  const found = candidates.find(
    (candidate) => candidate.relativePath === relativePath,
  );
  if (!found) {
    throw new Error(`fixture 缺少候选 ${relativePath}`);
  }
  return found;
}

describe("仅属性变化候选的提交计划（V003-CR-02）", () => {
  beforeEach(() => {
    runSvnCommand.mockReset();
  });

  it("normal + propStatus=modified：commitPaths 包含、addPaths/removePaths 不包含、canCommit=true", async () => {
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          { path: "src/prop-only.ts", item: "normal", props: "modified" },
        ]),
      ),
    );
    const scope = createScope();
    const candidates = await collectCommitCandidates("svn", scope);
    const propOnly = requireCandidate(candidates, "src/prop-only.ts");
    // 链路前提：规则评估把仅属性变化分类为推荐（V003-CR-01 不回退）。
    expect(propOnly.selection).toBe("selected");
    expect(propOnly.evaluation).toMatchObject({
      decision: "recommended",
      reasonKey: "statusPolicy",
      statusPolicyKey: "propertyModified",
      safetyLocked: false,
    });

    const preview = buildCommitPlanPreview(scope, candidates, [
      propOnly.absolutePath,
    ]);

    expect(preview.issues).toEqual([]);
    expect(preview.commitPaths).toEqual([path.resolve(propOnly.absolutePath)]);
    expect(preview.addPaths).toEqual([]);
    expect(preview.removePaths).toEqual([]);
    expect(preview.canCommit).toBe(true);
    expect(
      preview.commands.some((command) => command.startsWith("svn commit ")),
    ).toBe(true);
  });

  it("普通 normal（无属性变化）仍不可提交，二元组修复不放宽普通状态", async () => {
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([{ path: "src/plain.ts", item: "normal" }]),
      ),
    );
    const scope = createScope();
    const candidates = await collectCommitCandidates("svn", scope);
    const plain = requireCandidate(candidates, "src/plain.ts");
    expect(plain.selection).toBe("excluded");

    const preview = buildCommitPlanPreview(scope, candidates, [
      plain.absolutePath,
    ]);

    expect(preview.canCommit).toBe(false);
    expect(preview.commitPaths).toEqual([]);
    expect(preview.issues).toHaveLength(1);
    expect(preview.issues[0]?.reason).toContain("排除");
  });

  it("属性冲突候选被阻止：normal+conflicted 与 modified+conflicted 均不进入提交计划", async () => {
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          {
            path: "src/prop-conflicted.ts",
            item: "normal",
            props: "conflicted",
          },
          {
            path: "src/both-conflicted.ts",
            item: "modified",
            props: "conflicted",
          },
        ]),
      ),
    );
    const scope = createScope();
    const candidates = await collectCommitCandidates("svn", scope);
    const propConflicted = requireCandidate(
      candidates,
      "src/prop-conflicted.ts",
    );
    const bothConflicted = requireCandidate(
      candidates,
      "src/both-conflicted.ts",
    );
    expect(propConflicted.selection).toBe("blocked");
    expect(bothConflicted.selection).toBe("blocked");

    const preview = buildCommitPlanPreview(scope, candidates, [
      propConflicted.absolutePath,
      bothConflicted.absolutePath,
    ]);

    expect(preview.canCommit).toBe(false);
    expect(preview.commitPaths).toEqual([]);
    expect(preview.issues).toHaveLength(2);
    for (const issue of preview.issues) {
      expect(issue.reason).toBe("文件处于阻止状态，需要先处理冲突或异常。");
    }
  });

  it("执行前复验不依赖上游 selection：选择状态滞后为 selected 时仍按二元组阻止属性冲突", async () => {
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          {
            path: "src/prop-conflicted.ts",
            item: "normal",
            props: "conflicted",
          },
        ]),
      ),
    );
    const scope = createScope();
    const candidates = await collectCommitCandidates("svn", scope);
    // 模拟选择状态滞后或异常：selection 被外部置为 selected。计划构建器是
    // 写操作前最后防线，必须直接按 (status, propStatus) 复验安全状态。
    const staleSelectionCandidates = candidates.map((candidate) =>
      candidate.relativePath === "src/prop-conflicted.ts"
        ? { ...candidate, selection: "selected" as const }
        : candidate,
    );
    const propConflicted = requireCandidate(
      staleSelectionCandidates,
      "src/prop-conflicted.ts",
    );

    const preview = buildCommitPlanPreview(scope, staleSelectionCandidates, [
      propConflicted.absolutePath,
    ]);

    expect(preview.canCommit).toBe(false);
    expect(preview.commitPaths).toEqual([]);
    expect(preview.issues).toHaveLength(1);
    expect(preview.issues[0]?.reason).toBe(
      "文件处于阻止状态，需要先处理冲突或异常。",
    );
  });

  it("执行前状态复验：propStatus 变化使候选哈希失效，重建计划恢复阻止", async () => {
    // 对应 WorkbenchController.executeCommit 的复验路径：执行前重新采集候选，
    // 用 hashCandidateState 与预览时的 stateHash 比较，不一致则旧预览失效。
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          { path: "src/prop-only.ts", item: "normal", props: "modified" },
        ]),
      ),
    );
    const scope = createScope();
    const message = "feat: 仅属性变化";
    const selectedRelativePaths = ["src/prop-only.ts"];

    // 1) 预览时：仅属性变化可提交，记录预览哈希。
    const previewCandidates = await collectCommitCandidates("svn", scope);
    const previewHash = hashCandidateState(
      previewCandidates,
      message,
      selectedRelativePaths,
    );
    const propOnly = requireCandidate(previewCandidates, "src/prop-only.ts");
    const preview = buildCommitPlanPreview(scope, previewCandidates, [
      propOnly.absolutePath,
    ]);
    expect(preview.canCommit).toBe(true);

    // 2) 执行前状态未变：重新采集哈希一致，预览仍然有效。
    const unchangedCandidates = await collectCommitCandidates("svn", scope);
    expect(
      hashCandidateState(unchangedCandidates, message, selectedRelativePaths),
    ).toBe(previewHash);

    // 3) 执行前属性状态变为冲突：哈希变化 → 旧预览必须失效；
    //    基于新候选重建的计划恢复阻止。
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          { path: "src/prop-only.ts", item: "normal", props: "conflicted" },
        ]),
      ),
    );
    const changedCandidates = await collectCommitCandidates("svn", scope);
    expect(
      hashCandidateState(changedCandidates, message, selectedRelativePaths),
    ).not.toBe(previewHash);

    const changedPropOnly = requireCandidate(
      changedCandidates,
      "src/prop-only.ts",
    );
    expect(changedPropOnly.selection).toBe("blocked");
    const rebuilt = buildCommitPlanPreview(scope, changedCandidates, [
      changedPropOnly.absolutePath,
    ]);
    expect(rebuilt.canCommit).toBe(false);
    expect(rebuilt.commitPaths).toEqual([]);
    expect(rebuilt.issues).toHaveLength(1);
    expect(rebuilt.issues[0]?.reason).toContain("阻止");
  });
});
