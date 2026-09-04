import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * V014-F2 · 新 UI 交互矩阵（针对 v0.1.4 真实新 UI：Changes 五态主操作 +
 * 更多菜单、Commit 紧凑摘要条 + 四折叠区、Diff 返回本地修改按钮、
 * handoff 来源行 + 冲突入口）。
 * 写法复用 visual-accessibility.spec.ts（三主题注入 + AxeBuilder）与
 * chinese-scroll.spec.ts（无横向溢出 + 滚动区末项可达 + SCR-12 视口矩阵）。
 * 全程确定性：只用 expect 轮询与键盘事件，不用 waitForTimeout 死等。
 */

async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".workbench-content");
      return (
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        document.body.scrollWidth <= document.body.clientWidth + 1 &&
        (!content || content.scrollWidth <= content.clientWidth + 1)
      );
    }),
  ).toBe(true);
}

async function assertInsideContent(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target, label).toBeVisible();
  const [contentBox, targetBox] = await Promise.all([
    page.locator(".workbench-content").boundingBox(),
    target.boundingBox(),
  ]);
  expect(contentBox, `${label} 缺少内容区布局`).not.toBeNull();
  expect(targetBox, `${label} 缺少可视区域`).not.toBeNull();
  expect(targetBox!.y, `${label} 被裁切到内容区上方`).toBeGreaterThanOrEqual(
    contentBox!.y - 1,
  );
  expect(
    targetBox!.y + targetBox!.height,
    `${label} 被裁切到内容区下方`,
  ).toBeLessThanOrEqual(contentBox!.y + contentBox!.height + 1);
}

const themes = {
  light: {
    "--vscode-foreground": "#242424",
    "--vscode-editor-foreground": "#3b3b3b",
    "--vscode-editor-background": "#ffffff",
    "--vscode-sideBar-background": "#f3f3f3",
    "--vscode-editorWidget-background": "#f8f8f8",
    "--vscode-descriptionForeground": "#5f5f5f",
    "--vscode-panel-border": "#d4d4d4",
    "--vscode-focusBorder": "#005fb8",
    "--vscode-button-background": "#0067b8",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-list-activeSelectionBackground": "#005fb8",
    "--vscode-list-activeSelectionForeground": "#ffffff",
    "--vscode-editorWarning-foreground": "#6c4b00",
    "--vscode-testing-iconPassed": "#116329",
    "--vscode-errorForeground": "#a1260d",
    "--vscode-gitDecoration-addedResourceForeground": "#587c0c",
    "--vscode-gitDecoration-deletedResourceForeground": "#ad0707",
    "--vscode-diffEditor-insertedTextBackground": "rgba(172, 206, 247, 0.55)",
    "--vscode-diffEditor-removedTextBackground": "rgba(255, 0, 0, 0.3)",
  },
  dark: {
    "--vscode-foreground": "#cccccc",
    "--vscode-editor-foreground": "#d4d4d4",
    "--vscode-editor-background": "#1e1e1e",
    "--vscode-sideBar-background": "#181818",
    "--vscode-editorWidget-background": "#252526",
    "--vscode-descriptionForeground": "#a8a8a8",
    "--vscode-panel-border": "#3c3c3c",
    "--vscode-focusBorder": "#007fd4",
    "--vscode-button-background": "#0e639c",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-gitDecoration-addedResourceForeground": "#81b88b",
    "--vscode-gitDecoration-deletedResourceForeground": "#c74e39",
    "--vscode-diffEditor-insertedTextBackground": "rgba(156, 204, 44, 0.2)",
    "--vscode-diffEditor-removedTextBackground": "rgba(255, 0, 0, 0.3)",
  },
  highContrast: {
    "--vscode-foreground": "#ffffff",
    "--vscode-editor-foreground": "#ffffff",
    "--vscode-editor-background": "#000000",
    "--vscode-sideBar-background": "#000000",
    "--vscode-editorWidget-background": "#000000",
    "--vscode-descriptionForeground": "#ffffff",
    "--vscode-panel-border": "#ffffff",
    "--vscode-focusBorder": "#f38518",
    "--vscode-button-background": "#000000",
    "--vscode-button-foreground": "#ffffff",
    "--vscode-gitDecoration-addedResourceForeground": "#9bbb55",
    "--vscode-gitDecoration-deletedResourceForeground": "#f14c4c",
    "--vscode-diffEditor-insertedTextBackground": "rgba(155, 185, 85, 0.55)",
    "--vscode-diffEditor-removedTextBackground": "rgba(255, 0, 0, 0.5)",
    "--vscode-contrastBorder": "#6fc3df",
  },
} as const;

const themeBodyClasses = {
  light: "vscode-light",
  dark: "vscode-dark",
  highContrast: "vscode-high-contrast",
} as const;

async function applyTheme(
  page: Page,
  theme: keyof typeof themes,
): Promise<void> {
  await page.evaluate(
    ({ values, bodyClass }) => {
      for (const [name, value] of Object.entries(values))
        document.documentElement.style.setProperty(name, value);
      document.body.classList.add(bodyClass);
    },
    { values: themes[theme], bodyClass: themeBodyClasses[theme] },
  );
}

/*
 * a) Commit 紧凑模式 720×480：摘要条不裁切、四折叠 summary 键盘可展开、
 * 唯一主操作可达、无横向溢出。
 */
test("V014-F2(a)：Commit 紧凑模式 720×480 摘要条/折叠区/唯一主操作可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=commit");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();

  // 摘要条不裁切。
  const summary = page.getByRole("region", { name: "待提交文件摘要" });
  await assertInsideContent(page, summary, "待提交文件摘要");
  await expect(summary.getByText(/待提交 \d+ 个文件/)).toBeVisible();

  // 两个常驻 details 折叠区 summary 键盘 Enter 可展开。
  for (const name of ["完整文件选择与策略", "团队规则详情"]) {
    await test.step(name, async () => {
      const trigger = page.locator("summary", { hasText: name });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await trigger.press("Enter");
      await expect(
        trigger.locator("xpath=ancestor::details[1]"),
      ).toHaveJSProperty("open", true);
    });
  }

  // V016-C：帮助面板经“需要帮助”按钮键盘展开（面板替代原 AI details）。
  await test.step("提交说明帮助", async () => {
    const trigger = page.getByRole("button", { name: "需要帮助" });
    await trigger.scrollIntoViewIfNeeded();
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(page.getByRole("button", { name: "收起帮助" })).toBeVisible();
    await expect(page.getByLabel("生成输入模式")).toBeVisible();
  });

  // 唯一主操作可达（紧凑模式首屏只有一个 primary）。
  await expect(page.locator(".commit-compact .button--primary")).toHaveCount(1);
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await assertInsideContent(page, previewEntry, "预览提交主操作");

  // 第四个折叠区（完整命令与证据）随预览生成后出现，同样键盘可展开。
  await previewEntry.click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  const evidenceTrigger = page.locator("summary", {
    hasText: "完整命令与证据",
  });
  await evidenceTrigger.scrollIntoViewIfNeeded();
  await evidenceTrigger.focus();
  await expect(evidenceTrigger).toBeFocused();
  await evidenceTrigger.press("Enter");
  await expect(
    evidenceTrigger.locator("xpath=ancestor::details[1]"),
  ).toHaveJSProperty("open", true);

  await assertNoPageHorizontalOverflow(page);
});

/*
 * b) 200% 代理（720×480 沿 SCR-12 约定）：Changes ready 态主操作可见可达、
 * 列表末项可达。
 */
test("V014-F2(b)：200% 代理下 Changes 主操作与列表末项可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=changes");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 进入 ready 态：勾选一个可提交文件。
  await page.getByLabel("选择 src/extension.ts").check();
  const mainOp = page.getByRole("button", {
    name: /检查并提交所选（1）/,
  });
  await assertInsideContent(page, mainOp, "检查并提交所选主操作");

  // 列表末项可达：滚动到底后末行落在列表视口内。
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const lastItem = list.getByRole("listitem").last();
  const [listBox, itemBox] = await Promise.all([
    list.boundingBox(),
    lastItem.boundingBox(),
  ]);
  expect(listBox).not.toBeNull();
  expect(itemBox).not.toBeNull();
  expect(itemBox!.y + itemBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );
  expect(itemBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);

  await assertNoPageHorizontalOverflow(page);
});

/*
 * c) 三主题循环：Changes 主操作区、Commit 摘要条、handoff 来源行逐主题可见；
 * axe 零违规。
 */
test("V014-F2(c)：三主题下主操作区/摘要条/交接来源行可见且无障碍通过", async ({
  page,
}) => {
  for (const theme of ["light", "dark", "highContrast"] as const) {
    await test.step(theme, async () => {
      // Changes 主操作区。
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.goto("/?module=changes");
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "工作副本修改" }),
      ).toBeVisible();
      await expect(
        page.getByRole("toolbar", { name: "批量操作" }),
      ).toBeVisible();
      // 唯一主操作（五态之一，数量来自权威选择）。
      await expect(
        page.locator(".bulk-action-bar .button--primary"),
      ).toHaveCount(1);
      await expect(
        page.locator(".bulk-action-bar .button--primary"),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      // Commit 摘要条 + handoff 来源行（每个主题独立窗口，避免注入累积）。
      await page.goto("/?module=commit&commitHandoff=basic");
      await applyTheme(page, theme);
      const commitSummary = page.getByRole("region", {
        name: "待提交文件摘要",
      });
      await expect(commitSummary).toBeVisible();
      await expect(
        commitSummary.getByText("来自本地修改，范围未扩大"),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
});

/*
 * d) 键盘：Changes「更多」菜单键盘展开/Esc 关闭/焦点返回触发按钮；
 * Diff「返回本地修改」Tab 可达。
 */
test("V014-F2(d)：更多菜单键盘往返与 Diff 返回按钮 Tab 可达", async ({
  page,
}) => {
  await page.goto("/?module=changes");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 更多菜单：键盘展开 → Esc 关闭 → 焦点返回触发按钮。
  const moreButton = page.getByRole("button", {
    name: "更多批量操作",
  });
  await moreButton.focus();
  await expect(moreButton).toBeFocused();
  await moreButton.press("Enter");
  const menu = page.getByRole("menu", { name: "更多批量操作" });
  await expect(menu).toBeVisible();
  await expect(moreButton).toHaveAttribute("aria-expanded", "true");
  await moreButton.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(moreButton).toHaveAttribute("aria-expanded", "false");
  await expect(moreButton).toBeFocused();

  // Diff 返回本地修改：Tab 可达（焦点可进入也可离开，不形成陷阱）。
  await page.goto("/?module=diff");
  const backButton = page.getByRole("button", { name: "返回本地修改" });
  await expect(backButton).toBeVisible();
  await backButton.focus();
  await expect(backButton).toBeFocused();
  await backButton.press("Tab");
  expect(
    await backButton.evaluate((element) => document.activeElement !== element),
  ).toBe(true);
});
