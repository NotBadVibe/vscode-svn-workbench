import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const themes = {
  light: {
    '--vscode-foreground': '#242424', '--vscode-editor-background': '#ffffff', '--vscode-sideBar-background': '#f3f3f3',
    '--vscode-editorWidget-background': '#f8f8f8', '--vscode-descriptionForeground': '#5f5f5f', '--vscode-panel-border': '#d4d4d4',
    '--vscode-focusBorder': '#005fb8', '--vscode-button-background': '#0067b8', '--vscode-button-foreground': '#ffffff',
    '--vscode-list-activeSelectionBackground': '#005fb8', '--vscode-list-activeSelectionForeground': '#ffffff',
    '--vscode-editorWarning-foreground': '#6c4b00', '--vscode-testing-iconPassed': '#116329', '--vscode-errorForeground': '#a1260d'
  },
  dark: {
    '--vscode-foreground': '#cccccc', '--vscode-editor-background': '#1e1e1e', '--vscode-sideBar-background': '#181818',
    '--vscode-editorWidget-background': '#252526', '--vscode-descriptionForeground': '#a8a8a8', '--vscode-panel-border': '#3c3c3c',
    '--vscode-focusBorder': '#007fd4', '--vscode-button-background': '#0e639c', '--vscode-button-foreground': '#ffffff'
  },
  highContrast: {
    '--vscode-foreground': '#ffffff', '--vscode-editor-background': '#000000', '--vscode-sideBar-background': '#000000',
    '--vscode-editorWidget-background': '#000000', '--vscode-descriptionForeground': '#ffffff', '--vscode-panel-border': '#ffffff',
    '--vscode-focusBorder': '#f38518', '--vscode-button-background': '#000000', '--vscode-button-foreground': '#ffffff'
  }
} as const;

for (const [theme, variables] of Object.entries(themes)) {
  for (const width of [720, 1024, 1440]) {
    test(`${theme} theme at ${width}px has no page overflow or axe violations`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.evaluate((values) => {
        for (const [name, value] of Object.entries(values)) document.documentElement.style.setProperty(name, value);
      }, variables);
      await expect(page.getByRole('heading', { name: '工作副本修改' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: `docs/releases/artifacts/2026-07-31/${theme}-${width}.png`, animations: 'disabled' });
    });
  }
}

test('5000-file dataset remains windowed while scrolling', async ({ page }) => {
  await page.goto('/?dataset=large');
  const list = page.getByRole('list', { name: 'SVN 变更文件' });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole('listitem').count()).toBeLessThan(100);
  await list.evaluate((element) => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(page.getByText('src/generated/deep/path/file-4999.ts')).toBeVisible();
  expect(await list.getByRole('listitem').count()).toBeLessThan(100);
});
