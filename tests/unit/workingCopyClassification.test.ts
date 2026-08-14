import { describe, expect, it } from "vitest";
import {
  classifyWorkingCopyBinding,
  isSvnBound,
  workingCopyBindingLabels,
} from "../../src/scope/workingCopyClassification";
import { buildEnvironmentDiagnosticReport } from "../../src/diagnostics/environmentDiagnostics";

const win = { platform: "win32" as const, cwd: "C:\\" };
const posix = { platform: "linux" as const, cwd: "/" };

function classify(
  input: Omit<Parameters<typeof classifyWorkingCopyBinding>[0], "exists">,
) {
  return classifyWorkingCopyBinding({ exists: true, ...input }, posix);
}

describe("工作副本归属分类（v0.0.7 §6.3）", () => {
  it("folder 自身是工作副本根且无父工作副本时为独立工作副本根", () => {
    expect(
      classify({
        folderPath: "/repo/app",
        workingCopyRoot: "/repo/app",
        parentWorkingCopyRoot: undefined,
      }),
    ).toBe("workingCopyRoot");
  });

  it("位于上层工作副本的项目不误报为非 SVN", () => {
    // EM.code-workspace 场景：三个 folder 同属一个更上层的工作副本。
    expect(
      classify({
        folderPath: "/repo/code/EmApi",
        workingCopyRoot: "/repo/code",
      }),
    ).toBe("parentWorkingCopy");
  });

  it("嵌套工作副本根与父工作副本根不同时识别为嵌套", () => {
    expect(
      classify({
        folderPath: "/repo/app/vendor/lib",
        workingCopyRoot: "/repo/app/vendor/lib",
        parentWorkingCopyRoot: "/repo/app",
        isExternalsTarget: false,
      }),
    ).toBe("nestedWorkingCopy");
  });

  it("父工作副本 svn:externals 声明该目录时识别为 external", () => {
    expect(
      classify({
        folderPath: "/repo/app/vendor/lib",
        workingCopyRoot: "/repo/app/vendor/lib",
        parentWorkingCopyRoot: "/repo/app",
        isExternalsTarget: true,
      }),
    ).toBe("external");
  });

  it("非 SVN 与路径不存在分别报告", () => {
    expect(
      classify({ folderPath: "/tmp/plain", workingCopyRoot: undefined }),
    ).toBe("notSvn");
    expect(
      classifyWorkingCopyBinding({
        exists: false,
        folderPath: "/gone",
      }),
    ).toBe("missing");
  });

  it("工作副本根不是 folder 祖先时按非 SVN 安全处理", () => {
    expect(
      classify({
        folderPath: "/repo/app",
        workingCopyRoot: "/elsewhere/wc",
      }),
    ).toBe("notSvn");
  });

  it("Windows 下归属判断按 identity 比较", () => {
    expect(
      classifyWorkingCopyBinding(
        {
          exists: true,
          folderPath: "c:\\code\\emapi",
          workingCopyRoot: "C:\\Code",
        },
        win,
      ),
    ).toBe("parentWorkingCopy");
    expect(
      classifyWorkingCopyBinding(
        {
          exists: true,
          folderPath: "C:\\Code",
          workingCopyRoot: "c:\\code",
          parentWorkingCopyRoot: undefined,
        },
        win,
      ),
    ).toBe("workingCopyRoot");
  });

  it("isSvnBound 只排除非 SVN 与缺失", () => {
    expect(isSvnBound("workingCopyRoot")).toBe(true);
    expect(isSvnBound("parentWorkingCopy")).toBe(true);
    expect(isSvnBound("nestedWorkingCopy")).toBe(true);
    expect(isSvnBound("external")).toBe(true);
    expect(isSvnBound("notSvn")).toBe(false);
    expect(isSvnBound("missing")).toBe(false);
  });

  it("每种归属都有中文标签", () => {
    const bindings = [
      "workingCopyRoot",
      "parentWorkingCopy",
      "nestedWorkingCopy",
      "external",
      "notSvn",
      "missing",
    ] as const;
    for (const binding of bindings) {
      expect(workingCopyBindingLabels[binding]).toBeTruthy();
    }
  });
});

describe("环境诊断工作区检查（归属分类展示）", () => {
  const baseInput = {
    platform: "darwin" as const,
    arch: "arm64",
    vscodeVersion: "1.92.0",
    svnExecutable: { path: "/usr/bin/svn", version: "1.14.3" },
  };

  function workspaceCheck(workspaces: object[]) {
    const report = buildEnvironmentDiagnosticReport({
      ...baseInput,
      workspaces: workspaces as never,
    });
    return report.checks.find((check) => check.id === "workspace");
  }

  it("上层工作副本中的项目计入 SVN 工作区并展示归属", () => {
    const check = workspaceCheck([
      {
        name: "EmApi",
        path: "/repo/code/EmApi",
        isSvnWorkingCopy: true,
        binding: "parentWorkingCopy",
      },
      {
        name: "notes",
        path: "/tmp/notes",
        isSvnWorkingCopy: false,
        binding: "notSvn",
      },
    ]);
    expect(check?.status).toBe("pass");
    expect(check?.detail).toContain("1/2 个工作区位于 SVN 工作副本");
    expect(check?.detail).toContain("EmApi：位于上层工作副本");
    expect(check?.detail).toContain("notes：非 SVN 目录");
  });

  it("全部为非 SVN 时给出不含 .svn 假设的恢复引导", () => {
    const check = workspaceCheck([
      {
        name: "plain",
        path: "/tmp/plain",
        isSvnWorkingCopy: false,
        binding: "notSvn",
      },
    ]);
    expect(check?.status).toBe("warn");
    expect(check?.detail).toContain("均未检测到 SVN 工作副本");
    expect(check?.action).toContain("上层工作副本");
  });

  it("旧调用方未提供归属分类时保持原统计口径", () => {
    const check = workspaceCheck([
      { name: "app", path: "/repo/app", isSvnWorkingCopy: true },
    ]);
    expect(check?.status).toBe("pass");
    expect(check?.detail).toBe("1/1 个工作区位于 SVN 工作副本");
  });
});
