import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const artifactDirectory =
  process.env.SVN_WORKBENCH_EVIDENCE_DIR ??
  path.join(".validation", "evidence", "unscoped", `playwright-${process.pid}`);
mkdirSync(artifactDirectory, { recursive: true });

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
    // 差异组件映射层依赖的 VS Code 默认值（Light+ 主题）
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
    // 差异组件映射层依赖的 VS Code 默认值（Dark+ 主题）
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
    // 差异组件映射层依赖的 VS Code 默认值（Dark High Contrast 主题）
    "--vscode-gitDecoration-addedResourceForeground": "#9bbb55",
    "--vscode-gitDecoration-deletedResourceForeground": "#f14c4c",
    "--vscode-diffEditor-insertedTextBackground": "rgba(155, 185, 85, 0.55)",
    "--vscode-diffEditor-removedTextBackground": "rgba(255, 0, 0, 0.5)",
    "--vscode-contrastBorder": "#6fc3df",
  },
} as const;

/** 差异组件按宿主 color-scheme 切换明暗主题；模拟 VS Code Webview 的主题类。 */
const themeBodyClasses = {
  light: "vscode-light",
  dark: "vscode-dark",
  highContrast: "vscode-high-contrast",
} as const;

for (const [theme, variables] of Object.entries(themes)) {
  for (const width of [720, 1024, 1440]) {
    test(`${theme} theme at ${width}px has no page overflow or axe violations`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.evaluate(
        ({ values, bodyClass }) => {
          for (const [name, value] of Object.entries(values))
            document.documentElement.style.setProperty(name, value);
          document.body.classList.add(bodyClass);
        },
        {
          values: variables,
          bodyClass: themeBodyClasses[theme as keyof typeof themeBodyClasses],
        },
      );
      await expect(
        page.getByRole("heading", { name: "工作副本修改" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: path.join(artifactDirectory, `${theme}-${width}.png`),
        animations: "disabled",
      });
    });
  }
}

test("reduced motion 下列表主操作无违规、无动画依赖（Task 2 缺口）", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("heading", { name: "工作副本修改" }).waitFor();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // 主操作（全选 + 提交入口）在 reduced motion 下仍可达。
  await page.getByLabel("选择 src/extension.ts").check();
  await expect(
    page.getByRole("button", { name: /检查并提交所选（1）/ }),
  ).toBeVisible();
  // 无动画时操作不依赖延迟：立即响应。
  await page.getByRole("button", { name: /检查并提交所选（1）/ }).click();
  // V014-D：首屏摘要条即时可见；完整计数随控制台收进按需展开区。
  await expect(page.getByText("待提交 1 个文件")).toBeVisible();
  await page.getByText("完整文件选择与策略").click();
  await expect(page.getByText(/已选 1 \/ 候选/)).toBeVisible();
});

test("5000-file dataset remains windowed while scrolling", async ({ page }) => {
  await page.goto("/?dataset=large");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.locator(".path-cell__name", { hasText: "file-4999.ts" }),
  ).toBeVisible();
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
});

test("selection rules tab keeps source, warning and decision text visible in all themes", async ({
  page,
}) => {
  for (const [theme, variables] of Object.entries(themes)) {
    await test.step(theme, async () => {
      await page.setViewportSize({ width: 1024, height: 700 });
      // 每个模块一个独立窗口：直接以设置模块初始化，避免跨主题累积注入。
      await page.goto("/?selection=shadowed&module=settings");
      await page.evaluate(
        ({ values, bodyClass }) => {
          for (const [name, value] of Object.entries(values))
            document.documentElement.style.setProperty(name, value);
          document.body.classList.add(bodyClass);
        },
        {
          values: variables,
          bodyClass: themeBodyClasses[theme as keyof typeof themeBodyClasses],
        },
      );
      await page.getByRole("tab", { name: "提交选择规则" }).click();
      // 来源、决策与遮蔽警告都有文字表达，不依赖颜色
      await expect(page.getByText("内置默认").first()).toBeVisible();
      await expect(
        page
          .locator(".selection-rule-list .source-badge", {
            hasText: "当前仓库",
          })
          .first(),
      ).toBeVisible();
      await expect(page.getByText(/永远不会命中/).first()).toBeVisible();
      await expect(page.getByText("阻止提交").first()).toBeVisible();
      const results = await new AxeBuilder({ page })
        .include(".selection-settings")
        .analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

test("V017-E 计算样式：三主题 blocked 边框/增删符号 + reduced-motion", async ({
  page,
}) => {
  // 中文注释：源码契约见 tests/unit/v017-theme-a11y.test.ts；此处以计算样式为准。
  for (const [theme, variables] of Object.entries(themes)) {
    await test.step(theme, async () => {
      await page.setViewportSize({ width: 1024, height: 700 });
      await page.goto("/");
      await page.evaluate(
        ({ values, bodyClass }) => {
          for (const [name, value] of Object.entries(values))
            document.documentElement.style.setProperty(name, value);
          document.body.classList.add(bodyClass);
        },
        {
          values: variables,
          bodyClass: themeBodyClasses[theme as keyof typeof themeBodyClasses],
        },
      );
      await expect(
        page.getByRole("heading", { name: "工作副本修改" }),
      ).toBeVisible();
      // blocked 行除背景色外有边框通道：左边框宽度>0。
      const blocked = page.locator(".file-row--blocked").first();
      await expect(blocked).toBeAttached();
      const borderWidth = await blocked.evaluate(
        (element) => getComputedStyle(element).borderLeftWidth,
      );
      expect(
        parseFloat(borderWidth),
        `${theme} blocked 行左边框宽度`,
      ).toBeGreaterThan(0);
      // 增删行符号不只靠颜色：::before content 非空（探针元素，不依赖业务 fixtures）。
      const markers = await page.evaluate(() => {
        const probe = document.createElement("div");
        probe.setAttribute("aria-hidden", "true");
        probe.style.position = "absolute";
        probe.style.visibility = "hidden";
        probe.innerHTML =
          '<div class="diff-line--added"><span class="line-number">1</span></div>' +
          '<div class="diff-line--removed"><span class="line-number">2</span></div>';
        document.body.appendChild(probe);
        const added = getComputedStyle(
          probe.querySelector(".diff-line--added .line-number") as Element,
          "::before",
        ).content;
        const removed = getComputedStyle(
          probe.querySelector(".diff-line--removed .line-number") as Element,
          "::before",
        ).content;
        probe.remove();
        return { added, removed };
      });
      expect(markers.added, `${theme} 增行符号`).not.toBe("none");
      expect(markers.added, `${theme} 增行符号`).toContain("+");
      expect(markers.removed, `${theme} 删行符号`).not.toBe("none");
      expect(markers.removed, `${theme} 删行符号`).toContain("-");
    });
  }
  // reduced-motion 下滚动不依赖平滑动效：计算样式 scroll-behavior 为 auto。
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  const scrollBehavior = await page.evaluate(
    () => getComputedStyle(document.body).scrollBehavior,
  );
  expect(scrollBehavior).toBe("auto");
});
