import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const artifactDirectory = 'docs/releases/artifacts/2026-07-31/pages';
const darkTheme = {
  '--vscode-foreground': '#cccccc',
  '--vscode-editor-foreground': '#d4d4d4',
  '--vscode-editor-background': '#1e1e1e',
  '--vscode-sideBar-background': '#181818',
  '--vscode-editorWidget-background': '#252526',
  '--vscode-descriptionForeground': '#a8a8a8',
  '--vscode-panel-border': '#3c3c3c',
  '--vscode-focusBorder': '#007fd4',
  '--vscode-button-background': '#0e639c',
  '--vscode-button-foreground': '#ffffff',
  '--vscode-editorLineNumber-foreground': '#858585',
  '--vscode-editorGutter-background': '#1e1e1e',
  '--vscode-editor-selectionBackground': '#264f78'
} as const;

async function preparePage(page: Page, url = '/'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(url);
  await page.evaluate((values) => {
    for (const [name, value] of Object.entries(values)) {
      document.documentElement.style.setProperty(name, value);
    }
  }, darkTheme);
  await page.addStyleTag({ content: `
    html[data-acceptance-capture="full"],
    html[data-acceptance-capture="full"] body,
    html[data-acceptance-capture="full"] #app {
      height: auto !important;
      min-height: 100% !important;
      overflow: visible !important;
    }
    html[data-acceptance-capture="full"] .workbench-shell {
      height: auto !important;
      min-height: 960px !important;
    }
    html[data-acceptance-capture="full"] .workbench-main {
      min-height: 960px !important;
    }
    html[data-acceptance-capture="full"] .workbench-content {
      overflow: visible !important;
    }
    html[data-acceptance-capture="full"] .rail {
      position: sticky;
      top: 0;
      align-self: start;
      height: 960px;
    }
  ` });
  await expect(page.locator('.workbench-shell')).toBeVisible();
}

async function capture(page: Page, name: string): Promise<void> {
  await expect(page.locator('.module-state[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => { await document.fonts.ready; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${name} 存在 axe 可访问性问题`).toEqual([]);
  await page.evaluate(() => { document.documentElement.dataset.acceptanceCapture = 'full'; });
  try {
    await page.screenshot({
      path: `${artifactDirectory}/${name}.png`,
      animations: 'disabled',
      fullPage: true
    });
  } finally {
    await page.evaluate(() => { delete document.documentElement.dataset.acceptanceCapture; });
  }
}

test('保存每个 Svelte 功能页面的验收截图', async ({ page }) => {
  await preparePage(page);

  await test.step('Changes', async () => {
    await expect(page.getByRole('list', { name: 'SVN 变更文件' })).toBeVisible();
    await capture(page, '01-changes');
  });

  await test.step('Diff', async () => {
    await page.getByRole('button', { name: '查看 src/extension.ts 差异' }).click();
    await expect(page.getByText('BASE ↔ 工作副本 · typescript')).toBeVisible();
    await capture(page, '02-diff');
  });

  await test.step('Commit', async () => {
    await page.getByRole('button', { name: '提交', exact: true }).click();
    await page.getByRole('button', { name: 'AI 生成说明' }).click();
    await page.getByRole('button', { name: '生成提交预览' }).click();
    await expect(page.getByText('范围、状态和远端检查已通过')).toBeVisible();
    await capture(page, '03-commit');
  });

  await test.step('History', async () => {
    await page.getByRole('button', { name: '历史', exact: true }).click();
    await page.getByRole('button', { name: '查看逐行责任' }).click();
    await expect(page.getByLabel('文件逐行责任')).toBeVisible();
    await capture(page, '04-history');
  });

  await test.step('Conflicts', async () => {
    await page.getByRole('button', { name: '冲突', exact: true }).click();
    await page.getByRole('button', { name: 'AI 分析' }).click();
    await expect(page.getByText('两侧都修改了同一处行为')).toBeVisible();
    await page.getByRole('button', { name: '生成解决预览' }).click();
    await expect(page.getByRole('button', { name: '确认使用当前工作副本内容并标记解决' })).toBeVisible();
    await capture(page, '05-conflicts');
  });

  await test.step('Changelists', async () => {
    await page.locator('.rail').getByRole('button', { name: '变更集', exact: true }).click();
    await page.getByRole('button', { name: '生成拆分建议' }).click();
    await page.getByRole('button', { name: '套用并调整' }).click();
    await page.getByRole('button', { name: '生成应用预览' }).click();
    await expect(page.getByText('svn changelist "webview" …')).toBeVisible();
    await capture(page, '06-changelists');
  });

  await test.step('AI Review', async () => {
    await page.getByRole('button', { name: 'AI 审查', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'AI 变更审查' }).last()).toBeVisible();
    await capture(page, '07-ai-review');
  });

  await test.step('Impact', async () => {
    await page.getByRole('button', { name: '影响分析', exact: true }).click();
    await expect(page.getByRole('heading', { name: '影响与测试建议' })).toBeVisible();
    await capture(page, '08-impact');
  });

  await test.step('Agent', async () => {
    await page.getByRole('button', { name: '任务代理', exact: true }).click();
    await page.getByRole('textbox', { name: '任务目标' }).fill('检查当前范围并形成测试建议');
    await page.getByRole('button', { name: '生成受控计划' }).click();
    await expect(page.getByText('重新采集 SVN 状态', { exact: true })).toBeVisible();
    await capture(page, '09-agent');
  });

  await test.step('Repository', async () => {
    await page.getByRole('button', { name: '仓库操作', exact: true }).click();
    await page.getByRole('button', { name: '生成更新预览' }).click();
    await capture(page, '10-repository-update');
    await page.getByRole('button', { name: '清理与恢复', exact: true }).click();
    await page.getByRole('button', { name: '生成清理预览' }).click();
    await expect(page.getByText('svn cleanup "."')).toBeVisible();
    await capture(page, '10-repository-recovery');
    await page.getByRole('button', { name: '发布说明', exact: true }).click();
    await page.getByRole('button', { name: '从 SVN 历史生成' }).click();
    await expect(page.getByText('3 条修订')).toBeVisible();
    await capture(page, '10a-repository-browser-release-notes');
  });

  await test.step('Repository destructive advanced preview', async () => {
    await page.getByRole('button', { name: '切换', exact: true }).click();
    await page.getByRole('textbox', { name: '目标 URL' }).fill('https://svn.example.test/repos/workbench/branches/next');
    await page.getByRole('button', { name: '生成切换工作副本（Switch）预览' }).click();
    await expect(page.getByRole('heading', { name: '切换工作副本', exact: true }).last()).toBeVisible();
    await page.getByRole('checkbox', { name: /核对命令、目标和影响/ }).check();
    await capture(page, '10b-repository-destructive-preview');
  });

  await test.step('Settings AI', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '设置与团队规范' })).toBeVisible();
    await capture(page, '11-settings-ai');
  });

  await test.step('Settings Team', async () => {
    await page.getByRole('tab', { name: '团队提交规范' }).click();
    await page.getByRole('button', { name: 'AI 推荐' }).click();
    await expect(page.getByText('已根据仓库目录生成团队规则建议。')).toBeVisible();
    await capture(page, '12-settings-team');
  });

  await test.step('Settings SVN Security', async () => {
    await page.getByRole('tab', { name: 'SVN 安全' }).click();
    await expect(page.getByRole('heading', { name: 'SVN 用户认证' })).toBeVisible();
    await capture(page, '13-settings-svn-security');
  });

  await test.step('Diagnostics', async () => {
    await page.getByRole('button', { name: '诊断', exact: true }).click();
    await page.getByRole('tab', { name: '验收清单' }).click();
    await page.getByRole('button', { name: '核心流程' }).click();
    await expect(page.getByText('确认安全提交链路。')).toBeVisible();
    await capture(page, '13-diagnostics');
  });
});

test('保存 5000 文件窗口化页面截图', async ({ page }) => {
  await preparePage(page, '/?dataset=large');
  const list = page.getByRole('list', { name: 'SVN 变更文件' });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole('listitem').count()).toBeLessThan(100);
  await capture(page, '14-changes-5000-files');
});

test('保存 SVN 认证恢复页面截图', async ({ page }) => {
  await preparePage(page, '/?error=authentication');
  await expect(page.getByRole('button', { name: '配置认证' })).toBeVisible();
  await expect(page.getByText('密码只通过标准输入交给 SVN')).toBeVisible();
  await capture(page, '15-authentication-recovery');
});

test('保存 SVN 证书核对页面截图', async ({ page }) => {
  await preparePage(page, '/?error=certificate');
  await expect(page.getByText('svn.example.test:8443')).toBeVisible();
  await expect(page.getByText('AA:BB:CC:DD:EE:FF:00:11')).toBeVisible();
  await expect(page.getByRole('button', { name: '核对并信任证书' })).toBeEnabled();
  await capture(page, '16-certificate-recovery');
});

test('保存 SVN 代理恢复页面截图', async ({ page }) => {
  await preparePage(page, '/?error=proxy');
  await expect(page.getByText('代理连接失败')).toBeVisible();
  await expect(page.getByRole('button', { name: '打开 VS Code 代理设置' })).toBeVisible();
  await capture(page, '17-proxy-recovery');
});
