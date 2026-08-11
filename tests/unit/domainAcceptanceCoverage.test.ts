import { describe, it } from "vitest";
import { getExtensionTestCases } from "../../src/test/suite/index";

const hostOnlyTests = new Set([
  "activates and registers core commands",
  "opens commit panel for the selected folder command",
  "refreshes status for a validation working copy",
  "normalizes native SCM resource state command arguments",
  "opens and reuses Diff tabs and invokes native vscode.diff",
  "v0.0.5 opens independent per-module windows with reuse and rebuild",
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
const hasSvnWorkspace = Boolean(process.env.SVN_WORKBENCH_TEST_WORKSPACE);

describe("既有领域验收用例（Vitest 覆盖率桥接）", () => {
  for (const testCase of getExtensionTestCases().filter(
    ({ name }) =>
      !hostOnlyTests.has(name) &&
      (hasSvnWorkspace || !needsSvnWorkspace.has(name)),
  )) {
    it(testCase.name, async ({ skip }) => {
      try {
        await testCase.run();
      } catch (error) {
        if (error instanceof Error && error.name === "SkippedTest") {
          skip(error.message);
          return;
        }
        throw error;
      }
    });
  }
});
