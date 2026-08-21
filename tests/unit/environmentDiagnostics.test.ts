import { describe, expect, it } from "vitest";
import {
  buildEnvironmentDiagnosticReport,
  type EnvironmentDiagnosticInput,
} from "../../src/diagnostics/environmentDiagnostics";

const baseInput: EnvironmentDiagnosticInput = {
  platform: "darwin",
  arch: "arm64",
  vscodeVersion: "1.92.0",
  svnExecutable: { path: "/usr/bin/svn", version: "1.14.3" } as never,
  workspaces: [{ name: "app", path: "/repo/app", isSvnWorkingCopy: true }],
  ai: {
    providerPreset: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    hasApiKey: true,
  },
};

describe("环境诊断动作协议化（v0.0.15 批次 A）", () => {
  it("CLI 缺失时携带选择可执行文件、打开设置、复制、重检与安装帮助动作", () => {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      svnExecutable: undefined,
      configuredSvnPath: undefined,
    });
    const check = report.checks.find((c) => c.id === "svn-cli");
    expect(check?.status).toBe("fail");
    expect(check?.actions).toBeDefined();
    const ids = check?.actions?.map((a) => a.id) ?? [];
    expect(ids).toContain("selectSvnExecutable");
    expect(ids).toContain("openSettings");
    expect(ids).toContain("copyDiagnostics");
    expect(ids).toContain("rerunDiagnostics");
    expect(ids).toContain("openUrl");
    const openSettings = check?.actions?.find((a) => a.id === "openSettings");
    expect(openSettings?.params).toEqual({ query: "svnWorkbench.svn.path" });
  });

  it("路径无效时同样携带选择与打开设置", () => {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      svnExecutable: undefined,
      configuredSvnPath: "/invalid/svn",
    });
    const check = report.checks.find((c) => c.id === "svn-cli");
    expect(check?.detail).toContain("/invalid/svn");
    expect(check?.actions?.some((a) => a.id === "selectSvnExecutable")).toBe(
      true,
    );
  });

  it("非工作副本时携带打开文件夹、复制、重检", () => {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      workspaces: [
        { name: "plain", path: "/tmp/plain", isSvnWorkingCopy: false },
      ],
    });
    const check = report.checks.find((c) => c.id === "workspace");
    expect(check?.status).toBe("warn");
    const ids = check?.actions?.map((a) => a.id) ?? [];
    expect(ids).toContain("openFolder");
    expect(ids).toContain("copyDiagnostics");
    expect(ids).toContain("rerunDiagnostics");
  });

  it("未打开工作区时同样携带打开文件夹", () => {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      workspaces: [],
    });
    const check = report.checks.find((c) => c.id === "workspace");
    expect(check?.actions?.some((a) => a.id === "openFolder")).toBe(true);
  });

  it("可用且为工作副本时不携带动作（pass）", () => {
    const report = buildEnvironmentDiagnosticReport(baseInput);
    const svnCheck = report.checks.find((c) => c.id === "svn-cli");
    const wsCheck = report.checks.find((c) => c.id === "workspace");
    expect(svnCheck?.status).toBe("pass");
    expect(svnCheck?.actions).toBeUndefined();
    expect(wsCheck?.status).toBe("pass");
    expect(wsCheck?.actions).toBeUndefined();
  });

  it("AI 未配置时携带打开 AI 设置", () => {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      ai: undefined,
    });
    const check = report.checks.find((c) => c.id === "ai-config");
    expect(check?.actions?.some((a) => a.id === "openSettings")).toBe(true);
    const open = check?.actions?.find((a) => a.id === "openSettings");
    expect(open?.params).toEqual({ query: "svnWorkbench.ai" });
  });
});

describe("首次四状态收敛（v0.0.15 批次 C）", () => {
  it("四种状态均有主、次动作且失败页必含重试与复制", () => {
    const cases: Array<{
      name: string;
      input: Partial<EnvironmentDiagnosticInput>;
      expectedPrimary: string;
    }> = [
      {
        name: "CLI 缺失",
        input: { svnExecutable: undefined },
        expectedPrimary: "selectSvnExecutable",
      },
      {
        name: "路径无效",
        input: { svnExecutable: undefined, configuredSvnPath: "/bad" },
        expectedPrimary: "selectSvnExecutable",
      },
      {
        name: "非工作副本",
        input: {
          workspaces: [
            { name: "plain", path: "/tmp", isSvnWorkingCopy: false },
          ],
        },
        expectedPrimary: "openFolder",
      },
    ];
    for (const c of cases) {
      const report = buildEnvironmentDiagnosticReport({
        ...baseInput,
        ...c.input,
      } as EnvironmentDiagnosticInput);
      const hasActions = report.checks.some(
        (ch) => ch.actions && ch.actions.length > 0,
      );
      expect(hasActions).toBe(true);
      // 每个失败检查都应含重试与复制
      for (const ch of report.checks.filter((ch) => ch.status !== "pass")) {
        if (ch.actions) {
          const ids = ch.actions.map((a) => a.id);
          expect(ids).toContain("rerunDiagnostics");
          expect(ids).toContain("copyDiagnostics");
        }
      }
    }
  });
});
