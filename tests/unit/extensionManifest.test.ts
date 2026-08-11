import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

interface MenuContribution {
  submenu?: string;
  command?: string;
  when?: string;
}

interface ExtensionManifest {
  author: string;
  activationEvents: string[];
  bugs: { url: string };
  contributes: {
    configuration: {
      properties: Record<
        string,
        { type: string | string[]; default: unknown; enum?: string[] }
      >;
    };
    menus: Record<string, MenuContribution[]>;
  };
  engines: { node: string; npm: string; vscode: string };
  homepage: string;
  packageManager: string;
  private: boolean;
  repository: { type: string; url: string };
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as ExtensionManifest;

describe("VS Code 扩展清单", () => {
  it("声明可复现构建和维护所需的项目元数据", () => {
    expect(manifest.private).toBe(true);
    expect(manifest.author).toBeTruthy();
    expect(manifest.repository).toEqual({
      type: "git",
      url: "https://github.com/NotBadVibe/vscode-svn-workbench.git",
    });
    expect(manifest.bugs.url).toBe(
      "https://github.com/NotBadVibe/vscode-svn-workbench/issues",
    );
    expect(manifest.homepage).toContain("#readme");
    expect(manifest.packageManager).toBe("npm@12.0.2");
    expect(manifest.engines.node).toBe(">=26.0.0 <27");
    expect(manifest.engines.npm).toBe(">=12.0.2 <13");
    expect(manifest.engines.vscode).toBe("^1.92.0");
  });

  it("Diff 打开位置默认同组并仅允许同组或旁侧", () => {
    expect(
      manifest.contributes.configuration.properties[
        "svnWorkbench.diff.openMode"
      ],
    ).toMatchObject({
      type: "string",
      default: "sameGroup",
      enum: ["sameGroup", "beside"],
    });
  });

  it("冷启动时不依赖扩展运行后才能设置的 context key 显示右键入口", () => {
    for (const menuId of ["explorer/context", "editor/context"]) {
      const entry = manifest.contributes.menus[menuId]?.find(
        (item) => item.submenu === "svnWorkbench.explorer",
      );
      expect(entry).toBeDefined();
      expect(entry?.when).toBe("resourceScheme == file");
      expect(entry?.when).not.toContain("svnWorkbench.hasWorkingCopies");
    }
  });

  it("右键入口对应命令可触发扩展激活", () => {
    const commands = [
      "svnWorkbench.openWorkbench",
      "svnWorkbench.openDiff",
      "svnWorkbench.commitFolder",
      "svnWorkbench.updateScope",
      "svnWorkbench.openHistory",
      "svnWorkbench.openConflictCenter",
      "svnWorkbench.openCleanup",
      "svnWorkbench.openProperties",
      "svnWorkbench.openRepositoryBrowser",
      "svnWorkbench.createBranch",
      "svnWorkbench.createTag",
      "svnWorkbench.switchWorkingCopy",
      "svnWorkbench.relocateWorkingCopy",
      "svnWorkbench.mergeToWorkingCopy",
      "svnWorkbench.openPatchShelf",
      "svnWorkbench.openReleaseNotes",
    ];
    for (const command of commands) {
      expect(manifest.activationEvents).toContain(`onCommand:${command}`);
    }
    const nestedMenus = [
      "svnWorkbench.explorer",
      "svnWorkbench.recovery",
      "svnWorkbench.repository",
    ];
    const contributedCommands = nestedMenus
      .flatMap((menuId) => manifest.contributes.menus[menuId] ?? [])
      .map((item) => item.command)
      .filter(Boolean);
    for (const command of commands)
      expect(contributedCommands).toContain(command);
  });

  it("右键菜单按常用、AI、恢复、仓库和设置任务分组，不显示单个大页面入口", () => {
    const root = manifest.contributes.menus["svnWorkbench.explorer"] ?? [];
    expect(
      root.filter((item) => item.submenu).map((item) => item.submenu),
    ).toEqual([
      "svnWorkbench.ai",
      "svnWorkbench.recovery",
      "svnWorkbench.repository",
      "svnWorkbench.settings",
    ]);
    expect(
      manifest.contributes.menus["svnWorkbench.repository"]?.map(
        (item) => item.command,
      ),
    ).toContain("svnWorkbench.openProperties");
    expect(
      manifest.contributes.menus["svnWorkbench.recovery"]?.map(
        (item) => item.command,
      ),
    ).toContain("svnWorkbench.openCleanup");
  });
});
