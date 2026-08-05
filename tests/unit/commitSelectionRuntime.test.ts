/**
 * 统一运行时一致性测试（v0.0.3 阶段 2）：
 * - 经服务解析的有效规则传入 collector 后，候选决策与直接 evaluate 一致；
 * - 多个调用入口（提交页/SCM/仓库动作的最小模拟）共享同一有效规则；
 * - collector 缺省参数行为保持内置默认（与 v0.0.2 兼容红线一致）。
 *
 * I/O 处理方式与 commitSelectionGolden.test.ts 相同：mock runSvnCommand，
 * 向真实解析与评估链路喂入 fixture。
 */
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import type { SvnCommandResult } from "../../src/svn/svnTypes";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import { collectCommitCandidates } from "../../src/commit/commitCandidateCollector";
import { CommitSelectionRuleService } from "../../src/commit/commitSelectionRuleService";
import { createCommitSelectionEvaluator } from "../../src/commit/commitSelectionRuleEvaluator";

const repositoryRoot = path.join(os.tmpdir(), "svn-workbench-runtime-wc");

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
    id: "runtime-scope",
    repositoryRoot,
    source: "workspace",
    roots: [{ absolutePath: repositoryRoot, relativePath: "", kind: "folder" }],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

const statusXml = buildStatusXml([
  { path: "src/modified.ts", item: "modified" },
  { path: "src/new.ts", item: "unversioned" },
  { path: "vendor/lib/index.js", item: "unversioned" },
  { path: "src/conflicted.ts", item: "conflicted" },
  { path: "src/prop-only.ts", item: "normal", props: "modified" },
]);

describe("服务解析规则与 collector 决策一致性", () => {
  beforeEach(() => {
    runSvnCommand.mockReset();
    runSvnCommand.mockResolvedValue(buildSvnResult(statusXml));
  });

  it("collector 使用服务解析的有效规则时，每个候选决策与直接 evaluate 一致", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({
        layer: {
          statusRules: { unversioned: "recommended" },
          pathRules: [
            {
              id: "team-vendor",
              enabled: true,
              pattern: "vendor/**",
              decision: "excluded",
              reason: "第三方目录",
            },
          ],
        },
        warnings: [],
      }),
    });
    const rules = await service.getEffectiveRules(repositoryRoot);

    const candidates = await collectCommitCandidates("svn", createScope(), {
      rules,
    });
    const evaluator = createCommitSelectionEvaluator(rules);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const direct = evaluator.evaluate({
        relativePath: candidate.relativePath,
        status: candidate.status,
        propStatus: candidate.propStatus,
      });
      expect(candidate.evaluation).toEqual(direct);
    }
    // 配置确实生效：仓库层策略与路径规则改变了内置默认结论。
    const byPath = new Map(
      candidates.map((candidate) => [candidate.relativePath, candidate]),
    );
    expect(byPath.get("src/new.ts")?.selection).toBe("selected");
    expect(byPath.get("src/new.ts")?.reason).toBe("常规可提交变更");
    expect(byPath.get("vendor/lib/index.js")?.selection).toBe("excluded");
    expect(byPath.get("vendor/lib/index.js")?.reason).toBe("第三方目录");
    expect(byPath.get("src/conflicted.ts")?.selection).toBe("blocked");
    expect(byPath.get("src/conflicted.ts")?.evaluation.safetyLocked).toBe(true);
    expect(byPath.get("src/prop-only.ts")?.selection).toBe("selected");
  });

  it("两个调用入口经服务解析出同一有效规则对象，候选决策一致", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({
        layer: { statusRules: { unversioned: "excluded" } },
        warnings: [],
      }),
    });

    // 模拟两个调用入口（如提交页与 SCM 摘要）共享同一服务。
    const [rulesFromEntryA, rulesFromEntryB] = await Promise.all([
      service.getEffectiveRules(repositoryRoot),
      service.getEffectiveRules(repositoryRoot),
    ]);
    expect(rulesFromEntryA).toBe(rulesFromEntryB);

    const [candidatesA, candidatesB] = await Promise.all([
      collectCommitCandidates("svn", createScope(), { rules: rulesFromEntryA }),
      collectCommitCandidates("svn", createScope(), { rules: rulesFromEntryB }),
    ]);
    expect(
      candidatesA.map((candidate) => [
        candidate.relativePath,
        candidate.selection,
      ]),
    ).toEqual(
      candidatesB.map((candidate) => [
        candidate.relativePath,
        candidate.selection,
      ]),
    );
  });

  it("collector 缺省参数与显式传入内置默认规则产出一致", async () => {
    const service = new CommitSelectionRuleService({
      readVscodeLayers: () => ({}),
      readRepositoryLayer: async () => ({ warnings: [] }),
    });
    const builtinRules = await service.getEffectiveRules(repositoryRoot);

    const withDefault = await collectCommitCandidates("svn", createScope());
    const withExplicitBuiltin = await collectCommitCandidates(
      "svn",
      createScope(),
      { rules: builtinRules },
    );

    expect(
      withDefault.map((candidate) => [
        candidate.relativePath,
        candidate.selection,
        candidate.reason,
      ]),
    ).toEqual(
      withExplicitBuiltin.map((candidate) => [
        candidate.relativePath,
        candidate.selection,
        candidate.reason,
      ]),
    );
  });
});
