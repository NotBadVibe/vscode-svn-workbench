import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Extension Host 测试基础设施的轻量静态回归：
 * 临时目录清理必须统一走 removeTestTempDirectory（Windows EPERM/EBUSY/
 * ENOTEMPTY 重试 + 延迟，最后只警告 defer 由 Runner 回收），不得在
 * fixture 内直接 fs.rmSync，否则真实 SVN 验收完成后会因 Windows 短暂
 * 文件占用误判失败。
 */
describe("Extension Host 临时目录清理", () => {
  const suiteSource = readFileSync(
    path.join(process.cwd(), "src", "test", "suite", "index.ts"),
    "utf8",
  );

  it("直接 fs.rmSync(tempRoot 只允许出现在 removeTestTempDirectory 助手内", () => {
    const helperStart = suiteSource.indexOf("function removeTestTempDirectory");
    const helperEnd = suiteSource.indexOf("export async function run");
    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helperBody = suiteSource.slice(helperStart, helperEnd);
    expect(helperBody).toContain("fs.rmSync(tempRoot");

    // 全文件范围内，直接 fs.rmSync(tempRoot 的调用点数量必须等于助手内的
    // 那一个；任何新增 fixture 直接清理都会使该断言失败。
    const directCleanupCalls = suiteSource.match(/fs\.rmSync\(\s*tempRoot/g);
    expect(directCleanupCalls).not.toBeNull();
    expect(directCleanupCalls!.length).toBe(1);
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
