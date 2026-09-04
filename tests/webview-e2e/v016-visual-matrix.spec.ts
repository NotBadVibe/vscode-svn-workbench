import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/*
 * V016-F2(3) · 四模块视觉矩阵（含 AssistancePanel 折叠态）。
 * 720×480 + 200% 代理 + 三主题：确认区外 button--primary=1（回执卡/意向单/dialog
 * 内确认动作为规划 §5「Dialog 内当前执行动作」豁免，不计入主任务区统计）、
 * 面板折叠态不挤压主任务区、无横向溢出；axe 零违规。
 * 复用 v014-interactions.spec.ts 矩阵模式（expect 轮询 + 键盘事件，无 waitForTimeout）。
 * 只改测试；不动业务源码与 mock 旧语义（V016-F3 除外：见下）。
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

/**
 * 确认区外唯一 primary：回执卡容器以 data-confirmation-zone 标记，卡内
 * 「开始模型生成/开始解释/开始语义拆分/开始模型分析」为待确认动作，适用
 * 规划 §5「Dialog 内当前执行动作除外」豁免，不计入主任务区统计。
 * 平台无关：纯 DOM 可见性判定（尺寸 + visibility/display），不依赖平台 API。
 */
async function assertSingleOutsidePrimary(page: Page, label: string) {
  const outsideCount = await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll(".workbench-content .button--primary"),
    ) as HTMLElement[];
    return buttons.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const visible =
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none";
      return visible && !element.closest("[data-confirmation-zone]");
    }).length;
  });
  expect(outsideCount, `${label} 确认区外 primary 不唯一`).toBe(1);
}

/** 折叠态主任务区断言：无对话框、帮助面板保持折叠，且确认区外 primary=1。 */
async function assertSingleMainPrimary(page: Page, label: string) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "收起帮助" }),
    `${label} 帮助面板应保持折叠`,
  ).toHaveCount(0);
  await assertSingleOutsidePrimary(page, label);
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

/** 变更集主任务代表态：自动整理→套用→生成应用预览（面板保持折叠）。 */
async function driveChangelistsToPreview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "自动整理" }).click();
  await expect(page.getByText("分组 1：webview")).toBeVisible();
  await page.getByRole("button", { name: "套用并调整" }).first().click();
  await page.getByRole("button", { name: "生成应用预览" }).click();
  await expect(page.getByText(/svn changelist/).first()).toBeVisible();
}

test("V016-F2(3a)：720×480 折叠态四模块唯一 primary 与主任务可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });

  await test.step("Commit", async () => {
    await page.goto("/?module=commit");
    await expect(
      page.getByRole("heading", { name: "提交当前范围" }),
    ).toBeVisible();
    await assertSingleMainPrimary(page, "Commit");
    await assertInsideContent(
      page,
      page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
      "Commit 预览主操作",
    );
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "需要帮助" }),
      "Commit 帮助入口",
    );
    await assertNoPageHorizontalOverflow(page);
  });

  await test.step("Conflicts", async () => {
    await page.goto("/?module=conflicts");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    await assertSingleMainPrimary(page, "Conflicts");
    await assertInsideContent(
      page,
      page.getByTestId("conflict-role-bar"),
      "Conflicts 四角色条",
    );
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "保存工作副本合并结果" }),
      "Conflicts 保存主操作",
    );
    await assertNoPageHorizontalOverflow(page);
  });

  await test.step("Changelists", async () => {
    await page.goto("/?module=changelists");
    await expect(
      page.getByRole("heading", { name: "变更集管理" }),
    ).toBeVisible();
    await driveChangelistsToPreview(page);
    await assertSingleMainPrimary(page, "Changelists");
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "确认应用变更集" }),
      "Changelists 确认主操作",
    );
    await assertNoPageHorizontalOverflow(page);
  });

  await test.step("Understanding", async () => {
    await page.goto("/?module=understanding");
    await expect(
      page.getByRole("heading", { name: "变更解读" }).first(),
    ).toBeVisible();
    await assertSingleMainPrimary(page, "Understanding");
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "只运行本地检查" }),
      "Understanding 本地检查主路径",
    );
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "确认", exact: true }),
      "Understanding 会话内确认",
    );
    await assertNoPageHorizontalOverflow(page);
  });
});

test("V016-F2(3b)：200% 代理下折叠态主操作键盘可达且无溢出", async ({
  page,
}) => {
  // 沿 SCR-12 约定：200% 用 720×480 逻辑视口代理。
  await page.setViewportSize({ width: 720, height: 480 });

  await test.step("Commit 主操作键盘往返", async () => {
    await page.goto("/?module=commit");
    const previewEntry = page.getByRole("button", {
      name: /预览提交 \d+ 个文件/,
    });
    await assertInsideContent(page, previewEntry, "200% Commit 预览主操作");
    await previewEntry.focus();
    await expect(previewEntry).toBeFocused();
    await previewEntry.press("Tab");
    expect(
      await previewEntry.evaluate(
        (element) => document.activeElement !== element,
      ),
    ).toBe(true);
    await assertSingleMainPrimary(page, "200% Commit");
    await assertNoPageHorizontalOverflow(page);
  });

  await test.step("Conflicts 帮助入口键盘展开与收起", async () => {
    await page.goto("/?module=conflicts");
    const helpTrigger = page.getByRole("button", { name: "需要帮助" });
    await assertInsideContent(page, helpTrigger, "200% Conflicts 帮助入口");
    await helpTrigger.focus();
    await expect(helpTrigger).toBeFocused();
    await helpTrigger.press("Enter");
    await expect(page.getByRole("button", { name: "收起帮助" })).toBeVisible();
    await page.getByRole("button", { name: "收起帮助" }).click();
    await expect(helpTrigger).toBeVisible();
    await assertSingleMainPrimary(page, "200% Conflicts");
    await assertNoPageHorizontalOverflow(page);
  });

  await test.step("Changelists 与 Understanding 主操作可达", async () => {
    await page.goto("/?module=changelists");
    await driveChangelistsToPreview(page);
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "确认应用变更集" }),
      "200% Changelists 确认主操作",
    );
    await assertSingleMainPrimary(page, "200% Changelists");
    await assertNoPageHorizontalOverflow(page);

    await page.goto("/?module=understanding");
    await assertInsideContent(
      page,
      page.getByRole("button", { name: "只运行本地检查" }),
      "200% Understanding 本地检查",
    );
    await assertSingleMainPrimary(page, "200% Understanding");
    await assertNoPageHorizontalOverflow(page);
  });
});

test("V016-F2(3c)：三主题下四模块主任务可见且 axe 零违规", async ({ page }) => {
  for (const theme of ["light", "dark", "highContrast"] as const) {
    await test.step(theme, async () => {
      await page.setViewportSize({ width: 1024, height: 700 });

      await page.goto("/?module=commit");
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "提交当前范围" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto("/?module=conflicts");
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "待处理冲突" }),
      ).toBeVisible();
      await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
      // V016-F3 真修：.conflict-row.active small 改用选中前景，对比度达标后不再排除。
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto("/?module=changelists");
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "变更集管理" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "自动整理" }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto("/?module=understanding");
      await applyTheme(page, theme);
      await expect(
        page.getByRole("heading", { name: "变更解读" }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "只运行本地检查" }),
      ).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  }
});

test("V016-F3(3d)：展开态回执可见时确认区外仍唯一 primary", async ({
  page,
}) => {
  // 豁免依据：规划 §5「每页强调色 primary=1（Dialog 内当前执行动作除外）」；
  // 回执卡是待确认的外发动作（data-confirmation-zone 标记），卡内 primary 豁免，
  // 卡外主任务区仍须唯一 primary 且主操作保持可达。
  await page.setViewportSize({ width: 1024, height: 700 });

  await test.step("Commit 回执展开态", async () => {
    await page.goto("/?module=commit");
    await expect(
      page.getByRole("heading", { name: "提交当前范围" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "需要帮助" }).click();
    await page.getByLabel("生成输入模式").selectOption("limited-diff");
    await page.getByRole("button", { name: "生成建议草稿" }).click();
    const receipt = page.getByRole("region", {
      name: "受限差异外发回执",
    });
    await expect(receipt).toBeVisible();
    // 回执卡内确认动作为豁免项：卡内 primary 可见。
    await expect(
      receipt.getByRole("button", { name: "开始模型生成" }),
    ).toBeVisible();
    // 面板外主操作仍存在，且确认区外无第二个 primary。
    await expect(
      page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
    ).toBeVisible();
    await assertSingleOutsidePrimary(page, "Commit 展开回执");
  });

  await test.step("Conflicts 回执展开态", async () => {
    await page.goto("/?module=conflicts");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "需要帮助" }).click();
    await page.getByRole("button", { name: "解释冲突意图" }).click();
    const receipt = page.getByRole("region", {
      name: "冲突意图解释回执",
    });
    await expect(receipt).toBeVisible();
    await expect(
      receipt.getByRole("button", { name: "开始解释" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存工作副本合并结果" }),
    ).toBeVisible();
    await assertSingleOutsidePrimary(page, "Conflicts 展开回执");
  });
});
