import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Extension Host 测试基础设施的轻量静态回归：
 * fixture 必须统一调用可测试的 removeTestTempDirectory，不得在 index.ts
 * 内直接 fs.rmSync，否则真实 SVN 验收完成后会因 Windows 短暂文件占用
 * 误判失败。错误分类和重试参数由 windowsPlatformContracts.test.ts 验证。
 */
describe("Extension Host 临时目录清理", () => {
  const suiteSource = readFileSync(
    path.join(process.cwd(), "src", "test", "suite", "index.ts"),
    "utf8",
  );

  it("index.ts 导入统一助手且不存在直接 fs.rmSync(tempRoot", () => {
    expect(suiteSource).toContain(
      'import { removeTestTempDirectory } from "./testTempDirectory"',
    );
    expect(suiteSource).not.toMatch(/fs\.rmSync\(\s*tempRoot/);
  });

  it("testDiffEditSvnBindingIsolation 的 finally 使用统一清理助手", () => {
    const fixtureStart = suiteSource.indexOf(
      "async function testDiffEditSvnBindingIsolation",
    );
    const fixtureEnd = suiteSource.indexOf(
      "async function testGeneratedFilePolicy",
    );
    expect(fixtureStart).toBeGreaterThanOrEqual(0);
    expect(fixtureEnd).toBeGreaterThan(fixtureStart);
    const fixtureBody = suiteSource.slice(fixtureStart, fixtureEnd);
    expect(fixtureBody).toContain("removeTestTempDirectory(tempRoot)");
    expect(fixtureBody).not.toContain("fs.rmSync(tempRoot");
  });
});
