import { describe, expect, it } from "vitest";
import { getExtensionTestCases } from "../../src/test/suite/index";

const hostOnlyTests = new Set([
  "activates and registers core commands",
  "opens commit panel for the selected folder command",
  "refreshes status for a validation working copy",
  "normalizes native SCM resource state command arguments",
  "opens and reuses Diff tabs and invokes native vscode.diff",
  "v0.0.5 opens independent per-module windows with reuse and rebuild",
  "v0.0.6 edits a working copy file via the guarded save pipeline",
  "v0.0.6 rejects nested/external/BASE-changed targets in isolated SVN fixture",
]);
const needsSvnWorkspace = new Set([
  "keeps folder operation scope inside the selected folder",
  "merges parent and child roots in multi selection",
  "rejects selections spanning independent working copies",
  "collects root commit candidates with generated file decisions",
  "collects folder commit candidates inside the selected folder only",
  "rejects out-of-scope AI mock selections",
  "builds commit selection AI request from commit candidates",
  "creates local commit selection fallback",
  "rejects invented commit selection AI paths",
  "builds commit selection AI explanation",
  "marks untouched commit candidates as not analyzed",
  "builds commit plan preview for missing files",
  "blocks generated files in commit plan preview",
  "blocks out-of-scope files in commit plan preview",
  "builds commit message AI request from selected files",
  "passes team commit convention into commit message AI request",
  "attaches diff summary to commit message AI request",
  "builds commit message AI request in template completion mode",
  "converts commit preview to commit flow plan",
  "parses remote update status from svn xml",
  "checks remote updates for validation working copy",
  "builds update scope preview",
  "collects conflict items from validation working copy",
  "builds resolve conflict preview",
]);
/**
 * 真实 SVN 子进程用例在 Windows coverage bridge 下偶发 5s 超时 flake
 * （同一 head 的 push Windows run 与前后 source head 均 success，属负载
 * 波动）。仅为这两个精确名称放宽到 15s，其余保持 Vitest 默认 5s，不修改
 * 全局超时、不跳过 Windows、不减少断言。
 */
const slowRealSvnTests = new Set([
  "executes a guarded Windows Unicode-path commit in an isolated real SVN repository",
  "executes advanced repository operations in an isolated real SVN repository",
]);
const REAL_SVN_TIMEOUT_MS = 15_000;

/** 命中慢真实 SVN 用例时返回 15s 超时；否则 undefined（沿用 Vitest 默认 5s）。 */
export function realSvnTestTimeoutMs(name: string): number | undefined {
  return slowRealSvnTests.has(name) ? REAL_SVN_TIMEOUT_MS : undefined;
}

const hasSvnWorkspace = Boolean(process.env.SVN_WORKBENCH_TEST_WORKSPACE);

describe("既有领域验收用例（Vitest 覆盖率桥接）", () => {
  for (const testCase of getExtensionTestCases().filter(
    ({ name }) =>
      !hostOnlyTests.has(name) &&
      (hasSvnWorkspace || !needsSvnWorkspace.has(name)),
  )) {
    it(
      testCase.name,
      async ({ skip }) => {
        try {
          await testCase.run();
        } catch (error) {
          if (error instanceof Error && error.name === "SkippedTest") {
            skip(error.message);
            return;
          }
          throw error;
        }
      },
      realSvnTestTimeoutMs(testCase.name),
    );
  }
});

describe("真实 SVN 慢用例超时配置", () => {
  it("仅两个精确名称使用 15s 超时，其余返回 undefined（默认 5s）", () => {
    expect(
      realSvnTestTimeoutMs(
        "executes a guarded Windows Unicode-path commit in an isolated real SVN repository",
      ),
    ).toBe(15_000);
    expect(
      realSvnTestTimeoutMs(
        "executes advanced repository operations in an isolated real SVN repository",
      ),
    ).toBe(15_000);
    expect(
      realSvnTestTimeoutMs("some other acceptance test case"),
    ).toBeUndefined();
    expect(realSvnTestTimeoutMs("")).toBeUndefined();
  });
});
