/**
 * v0.0.2 候选分类行为金样。
 *
 * 目的：在 v0.0.3 提交选择规则改造（见 docs/releases/v0.0.3/README.md 第 10 节）
 * 开始之前，以显式期望固化 `classifyGeneratedFile` 与 `collectCommitCandidates`
 * 的现有分类行为，作为阶段 1+ 的无损兼容红线。改造若需变更本文件中的期望，
 * 必须先确认属于规划内的行为修正（例如仅属性变化），并在提交说明中解释。
 *
 * 覆盖方式：`collectCommitCandidates` 依赖 SVN I/O，这里按 commitFlow.test.ts
 * 的既有模式 mock `runSvnCommand`，向真实的状态 XML 解析、范围判断与候选
 * 转换链路喂入 fixture，不改变被测代码的任何行为。
 */
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationScope } from "../../src/scope/operationScope";
import type { SvnCommandResult } from "../../src/svn/svnTypes";

const { runSvnCommand } = vi.hoisted(() => ({ runSvnCommand: vi.fn() }));
vi.mock("../../src/svn/svnCommandRunner", () => ({ runSvnCommand }));

import {
  collectCommitCandidates,
  summarizeCommitCandidates,
} from "../../src/commit/commitCandidateCollector";
import {
  GeneratedFileDecision,
  classifyGeneratedFile,
} from "../../src/commit/generatedFilePolicy";

describe("classifyGeneratedFile 金样", () => {
  const generatedCases: Array<[string, GeneratedFileDecision]> = [
    // 内置生成物目录段：任意路径深度命中即排除。
    ["node_modules/lodash/index.js", "exclude"],
    ["dist/app.js", "exclude"],
    ["build/output.js", "exclude"],
    ["target/classes/Main.class", "exclude"],
    [".next/static/chunks/main.js", "exclude"],
    [".nuxt/dist/server.js", "exclude"],
    ["__pycache__/module.cpython-312.txt", "exclude"],
    ["obj/Debug/net8.0/app.dll", "exclude"],
    ["packages/web/dist/bundle.js", "exclude"],
    // bin 首段下的 Debug/Release 排除，其余内容待确认。
    ["bin/Debug/app.dll", "exclude"],
    ["bin/Release/app.dll", "exclude"],
    ["bin/deploy.sh", "review"],
    ["bin/tools/setup.exe", "review"],
    // 内置生成物扩展名（大小写不敏感）。
    ["logs/server.log", "exclude"],
    ["work/cache.tmp", "exclude"],
    ["src/utils/cache.pyc", "exclude"],
    ["logs/ERROR.LOG", "exclude"],
    // 普通源码与文档文件默认纳入。
    ["src/pages/order/OrderList.vue", "include"],
    ["src/main.ts", "include"],
    ["README.md", "include"],
    // 以下三条固化当前实现的边界行为，后续阶段如调整需显式评审：
    // bin 规则只在 bin 为首个路径段时生效，嵌套 bin/Debug 不命中。
    ["src/bin/Debug/app.dll", "include"],
    // 生成物目录段比较大小写敏感，DIST 不命中。
    ["DIST/app.js", "include"],
    // 但 bin 段比较大小写不敏感，BIN/Debug 命中。
    ["BIN/Debug/app.dll", "exclude"],
  ];

  it.each(generatedCases)(
    "classifyGeneratedFile(%s) 当前行为为 %s",
    (relativePath, expected) => {
      expect(classifyGeneratedFile(relativePath)).toBe(expected);
    },
  );
});

interface GoldenEntry {
  path: string;
  item: string;
  props?: string;
}

function buildStatusXml(entries: GoldenEntry[]): string {
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

function createGoldenScope(repositoryRoot: string): OperationScope {
  return {
    id: "golden-scope",
    repositoryRoot,
    source: "workspace",
    roots: [{ absolutePath: repositoryRoot, relativePath: "", kind: "folder" }],
    allowExpandScope: false,
    includeExternals: false,
    includeNestedWorkingCopies: false,
    createdAt: 0,
  };
}

describe("collectCommitCandidates 选择决策金样", () => {
  // 该目录不存在于磁盘，inferFileType 因此稳定走扩展名分支，保证金样可重复。
  const repositoryRoot = path.join(os.tmpdir(), "svn-workbench-golden-wc");

  beforeEach(() => {
    runSvnCommand.mockReset();
  });

  it("固化各 SVN 状态与生成物规则的当前选择决策与原因", async () => {
    runSvnCommand.mockResolvedValue(
      buildSvnResult(
        buildStatusXml([
          { path: "src/modified.ts", item: "modified" },
          { path: "src/added.ts", item: "added" },
          { path: "src/deleted.ts", item: "deleted" },
          { path: "src/replaced.ts", item: "replaced" },
          { path: "src/missing.ts", item: "missing" },
          { path: "src/unversioned.ts", item: "unversioned" },
          { path: "src/unknown.txt", item: "none" },
          { path: "src/normal.ts", item: "normal" },
          // 仅属性变化：status=normal 且 propStatus=modified。
          // v0.0.2 把它当作普通 normal 直接 excluded；v0.0.3 阶段 1 按规划
          // （docs/releases/v0.0.3/README.md 第 1、4、5 节）将其修正为推荐提交，
          // 走独立的 propertyModified 状态策略，默认 recommended。
          { path: "src/prop-only.ts", item: "normal", props: "modified" },
          { path: "src/ignored.ts", item: "ignored" },
          { path: "src/external.ts", item: "external" },
          { path: "src/conflicted.ts", item: "conflicted" },
          { path: "src/obstructed.ts", item: "obstructed" },
          { path: "src/incomplete.ts", item: "incomplete" },
          { path: "dist/app.js", item: "modified" },
          { path: "bin/deploy.sh", item: "modified" },
          { path: "dist/conflicted.js", item: "conflicted" },
          { path: "node_modules/pkg/index.js", item: "unversioned" },
        ]),
      ),
    );

    const candidates = await collectCommitCandidates(
      "svn",
      createGoldenScope(repositoryRoot),
    );

    const actual = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.relativePath,
        {
          status: candidate.status,
          propStatus: candidate.propStatus,
          generatedDecision: candidate.generatedDecision,
          selection: candidate.selection,
          reason: candidate.reason,
        },
      ]),
    );

    expect(actual).toEqual({
      "src/modified.ts": {
        status: "modified",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "selected",
        reason: "常规可提交变更",
      },
      "src/added.ts": {
        status: "added",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "selected",
        reason: "常规可提交变更",
      },
      "src/deleted.ts": {
        status: "deleted",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "selected",
        reason: "常规可提交变更",
      },
      "src/replaced.ts": {
        status: "replaced",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "selected",
        reason: "常规可提交变更",
      },
      "src/missing.ts": {
        status: "missing",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "needsReview",
        reason: "本地缺失文件，需要确认是否作为删除提交",
      },
      "src/unversioned.ts": {
        status: "unversioned",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "needsReview",
        reason: "未版本控制文件，需要确认是否加入 SVN",
      },
      "src/unknown.txt": {
        status: "unknown",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "needsReview",
        reason: "默认不进入提交",
      },
      "src/normal.ts": {
        status: "normal",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "excluded",
        reason: "默认不进入提交",
      },
      // 仅属性变化在 v0.0.3 被有意修正为推荐提交（propertyModified 策略），propStatus 原样透传。
      "src/prop-only.ts": {
        status: "normal",
        propStatus: "modified",
        generatedDecision: "include",
        selection: "selected",
        reason: "常规可提交变更",
      },
      "src/ignored.ts": {
        status: "ignored",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "excluded",
        reason: "默认不进入提交",
      },
      "src/external.ts": {
        status: "external",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "excluded",
        reason: "默认不进入提交",
      },
      "src/conflicted.ts": {
        status: "conflicted",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "blocked",
        reason: "需要先处理冲突或异常状态",
      },
      "src/obstructed.ts": {
        status: "obstructed",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "blocked",
        reason: "需要先处理冲突或异常状态",
      },
      "src/incomplete.ts": {
        status: "incomplete",
        propStatus: undefined,
        generatedDecision: "include",
        selection: "blocked",
        reason: "需要先处理冲突或异常状态",
      },
      "dist/app.js": {
        status: "modified",
        propStatus: undefined,
        generatedDecision: "exclude",
        selection: "excluded",
        reason: "命中生成物规则，默认排除",
      },
      "bin/deploy.sh": {
        status: "modified",
        propStatus: undefined,
        generatedDecision: "review",
        selection: "needsReview",
        reason: "可能是脚本或特殊产物，需要人工确认",
      },
      // blocked 优先于生成物排除：生成物目录中的冲突文件仍为阻止项。
      "dist/conflicted.js": {
        status: "conflicted",
        propStatus: undefined,
        generatedDecision: "exclude",
        selection: "blocked",
        reason: "需要先处理冲突或异常状态",
      },
      "node_modules/pkg/index.js": {
        status: "unversioned",
        propStatus: undefined,
        generatedDecision: "exclude",
        selection: "excluded",
        reason: "命中生成物规则，默认排除",
      },
    });

    expect(summarizeCommitCandidates(candidates)).toMatchObject({
      total: 18,
      selected: 5,
      needsReview: 4,
      excluded: 5,
      blocked: 4,
      statuses: {
        modified: 3,
        added: 1,
        deleted: 1,
        replaced: 1,
        missing: 1,
        unversioned: 2,
        unknown: 1,
        normal: 2,
        ignored: 1,
        external: 1,
        conflicted: 2,
        obstructed: 1,
        incomplete: 1,
      },
    });
  });
});
