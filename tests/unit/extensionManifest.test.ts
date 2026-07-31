import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface MenuContribution {
  submenu?: string;
  command?: string;
  when?: string;
}

interface ExtensionManifest {
  activationEvents: string[];
  contributes: {
    menus: Record<string, MenuContribution[]>;
  };
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as ExtensionManifest;

describe('VS Code 扩展清单', () => {
  it('冷启动时不依赖扩展运行后才能设置的 context key 显示右键入口', () => {
    for (const menuId of ['explorer/context', 'editor/context']) {
      const entry = manifest.contributes.menus[menuId]?.find((item) => item.submenu === 'svnWorkbench.explorer');
      expect(entry).toBeDefined();
      expect(entry?.when).toBe('resourceScheme == file');
      expect(entry?.when).not.toContain('svnWorkbench.hasWorkingCopies');
    }
  });

  it('右键入口对应命令可触发扩展激活', () => {
    const commands = [
      'svnWorkbench.openWorkbench',
      'svnWorkbench.openDiff',
      'svnWorkbench.commitFolder',
      'svnWorkbench.updateScope',
      'svnWorkbench.openHistory',
      'svnWorkbench.openConflictCenter',
      'svnWorkbench.openCleanup',
      'svnWorkbench.openProperties',
      'svnWorkbench.openRepositoryBrowser',
      'svnWorkbench.createBranch',
      'svnWorkbench.createTag',
      'svnWorkbench.switchWorkingCopy',
      'svnWorkbench.relocateWorkingCopy',
      'svnWorkbench.mergeToWorkingCopy',
      'svnWorkbench.openPatchShelf',
      'svnWorkbench.openReleaseNotes'
    ];
    for (const command of commands) {
      expect(manifest.activationEvents).toContain(`onCommand:${command}`);
    }
    const nestedMenus = ['svnWorkbench.explorer', 'svnWorkbench.recovery', 'svnWorkbench.repository'];
    const contributedCommands = nestedMenus.flatMap((menuId) => manifest.contributes.menus[menuId] ?? []).map((item) => item.command).filter(Boolean);
    for (const command of commands) expect(contributedCommands).toContain(command);
  });

  it('右键菜单按常用、AI、恢复、仓库和设置任务分组，不显示单个大页面入口', () => {
    const root = manifest.contributes.menus['svnWorkbench.explorer'] ?? [];
    expect(root.filter((item) => item.submenu).map((item) => item.submenu)).toEqual([
      'svnWorkbench.ai',
      'svnWorkbench.recovery',
      'svnWorkbench.repository',
      'svnWorkbench.settings'
    ]);
    expect(manifest.contributes.menus['svnWorkbench.repository']?.map((item) => item.command)).toContain('svnWorkbench.openProperties');
    expect(manifest.contributes.menus['svnWorkbench.recovery']?.map((item) => item.command)).toContain('svnWorkbench.openCleanup');
  });
});
