import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  path.join(process.cwd(), ".github", "workflows", "verify.yml"),
  "utf8",
);

describe("GitHub Verify 工作流", () => {
  it("开发分支由 PR 验证，push 只覆盖 main 与版本标签", () => {
    expect(workflow).toMatch(
      /push:\s*\n\s+branches:\s*\n\s+- main\s*\n\s+tags:\s*\n\s+- ["']v\*["']/,
    );
    expect(workflow).toMatch(/\n\s+pull_request:\s*\n/);
  });

  it("同一 PR 的新提交取消旧运行且双平台契约先于完整覆盖率", () => {
    expect(workflow).toContain(
      "github.event.pull_request.number || github.ref",
    );
    expect(workflow).toContain("cancel-in-progress: true");
    const contracts = workflow.indexOf("Fast dual-platform path contracts");
    const coverage = workflow.indexOf("Unit, domain and coverage gates");
    expect(contracts).toBeGreaterThanOrEqual(0);
    expect(coverage).toBeGreaterThan(contracts);
    // 合成用例可在任意平台执行，作为快速门禁只跑一次（Linux）；
    // 同一套用例不在 Windows Runner 重复执行。
    expect(workflow.slice(contracts, coverage)).toContain(
      "runner.os == 'Linux'",
    );
    expect(workflow.slice(contracts, coverage)).toContain(
      "npm run test:platform-contracts",
    );
    expect(workflow.slice(contracts, coverage)).not.toContain(
      "test:windows-contracts",
    );
  });
});
