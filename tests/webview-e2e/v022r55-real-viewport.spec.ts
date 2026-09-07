import { expect, test, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

/**
 * V022-R55 · 真实视口与实际控件尺寸验收基座（P1，本版先行）。
 *
 * 背景：已有截图/axe 未阻止小 textarea 与错列（v0.2.0 R02/R03 漏网实例）；
 * page-screenshots.spec.ts 用全页拼接专用高度/overflow 样式（`acceptance-capture-style`
 * + `fullPage: true`），不代表真实小视口。本文件是与之并存的验收基座，不改动它。
 *
 * 与 page-screenshots 的边界（本文件承诺）：
 * - 不注入任何布局/尺寸/overflow 专用 CSS；生产 CSS（`npm run build:webview`
 *   产物经 `vite preview` 提供）原样跑，不把 jsdom 无布局结果当像素证据。
 * - 唯一注入的是主题 CSS 变量（颜色）+ body 主题类，用于 Light/Dark/High Contrast
 *   可辨识检查；零布局规则，见 `applyThemeVariables`。
 * - 截图一律真实视口（`fullPage` 缺省 false），文件名绑定提交与构建模式。
 *
 * 口径标注（验收要求“分别标注口径”）：
 * - 口径A「真实视口」：`setViewportSize` 直测 CSS 像素几何（输入区尺寸、列对齐、
 *   首屏完整行数、主操作盒模型）。
 * - 口径B「等效缩放自动检查」：沿仓库既有约定（SCR-12 / V017-F ZOOM-01/02），
 *   200% 用 720×480 逻辑视口代理，只断言可达性（滚动可达、可见、不遮挡），
 *   不复述几何；另有 `deviceScaleFactor: 2` 光栅对照，证明 CSS 几何与口径A一致。
 * - 真实 VS Code 200% 真缩放与读屏为人工观察项（见本版 README V022-R55），
 *   不在本文件冒充自动覆盖。
 *
 * 行为约定映射：
 * - R02（V020-R02）：提交说明输入框最小高 150px、铺满宽度、纵向可调。
 * - R03（V020-R03）：Changes 表头与数据行共用六列定义、左右边对齐；
 *   ≤720px 宽走简化列（表头隐藏，选择建议/归属隐藏但保留 DOM）。
 * - R27（V022-R27）：720×480 首屏至少 2 个完整文件/修订行——R27/R28/R03 附带修复
 *   已落地（高度链 + 推荐降级 + 窄屏列特异性），下方为正式断言，铬区回退即失败。
 *
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout；断言平台无关（只比较
 * 同页盒模型与角色，不做操作系统假设）。
 */

const evidenceDirectory =
  process.env.SVN_WORKBENCH_EVIDENCE_DIR ??
  path.join(".validation", "evidence", "unscoped", `playwright-${process.pid}`);
mkdirSync(evidenceDirectory, { recursive: true });

function shortCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "nogit";
  }
}

/** 构建模式：playwright 经 `vite preview` 提供 `npm run build:webview` 产物。 */
const buildMode = "prod";
const commitTag = shortCommit();

function artifactName(name: string): string {
  return path.join(
    evidenceDirectory,
    `r55-${commitTag}-${buildMode}-${name}.png`,
  );
}

/** 口径A/口径B 的 CSS 几何口径均为此视口；光栅对照见文件末尾 describe。 */
const smallViewport = { width: 720, height: 480 };
const wideViewport = { width: 1280, height: 800 };

/** 主题变量与 visual-accessibility.spec.ts 同源（含语义色），零布局规则。
 * V022-R27 附带补齐：首屏修复把状态筛选按钮与状态徽标带入小视口，
 * 此前缺失的 list-activeSelection/warning/passed/error 变量曾 fallback 到深色值
 * 造成 light 主题对比度误报；与同源集对齐后断言的是真实主题语义色。 */
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

async function gotoReady(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('.module-state[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/**
 * 只注入主题颜色变量与 body 主题类（首屏前经 init script，保证跨导航生效）。
 * 不注入任何 height/min-height/overflow/display/grid 布局规则——这是本文件与
 * page-screenshots `acceptance-capture-style` 的核心边界。
 */
async function applyThemeVariables(
  page: Page,
  theme: keyof typeof themes,
): Promise<void> {
  await page.addInitScript(
    ({ values, bodyClass }) => {
      const timer = window.setInterval(() => {
        if (!document.documentElement || !document.body) {
          return;
        }
        for (const [name, value] of Object.entries(values)) {
          document.documentElement.style.setProperty(name, value);
        }
        document.body.classList.add(bodyClass);
        window.clearInterval(timer);
      }, 20);
    },
    { values: themes[theme], bodyClass: themeBodyClasses[theme] },
  );
}

async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        document.body.scrollWidth <= document.body.clientWidth + 1,
    ),
    "页面级横向溢出",
  ).toBe(true);
}

/** 滚动可达 + 可见 + 落在视口内 + 中心点命中自身（不被遮挡）。 */
async function assertReachableUnobscured(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target, `${label}不可见`).toBeVisible();
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(box, `${label}缺少可测盒模型`).not.toBeNull();
  expect(viewport, `${label}缺少视口`).not.toBeNull();
  expect(box!.y, `${label}超出视口顶部`).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height, `${label}超出视口底部`).toBeLessThanOrEqual(
    viewport!.height + 1,
  );
  const hitSelf = await target.evaluate((node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    const element = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return element === node || (node as HTMLElement).contains(element);
  });
  expect(hitSelf, `${label}被其他元素遮挡`).toBe(true);
}

for (const viewport of [wideViewport, smallViewport]) {
  test(`V022-R55(R02)：口径A真实视口 ${viewport.width}×${viewport.height} 提交说明输入框尺寸`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await gotoReady(page, "/?module=commit");
    const textarea = page.getByRole("textbox", { name: "提交说明" });
    await expect(textarea).toBeVisible();

    const container = page.locator(".commit-message-editor");
    const [containerBox, textareaBox] = await Promise.all([
      container.boundingBox(),
      textarea.boundingBox(),
    ]);
    expect(containerBox, "编辑器容器应有可测盒模型").not.toBeNull();
    expect(textareaBox, "输入框应有可测盒模型").not.toBeNull();
    // R02 约定：铺满可用宽度（允许边框/舍入误差）。
    expect(textareaBox!.width / containerBox!.width).toBeGreaterThan(0.95);
    // R02 约定：最小高度 150px（退化时约 39px，此断言对移除该样式敏感）。
    expect(textareaBox!.height).toBeGreaterThanOrEqual(150);
    expect(
      await textarea.evaluate(
        (node) => getComputedStyle(node as HTMLTextAreaElement).resize,
      ),
      "输入框应允许纵向调整",
    ).toBe("vertical");
    await assertNoPageHorizontalOverflow(page);
  });
}

test("V022-R55(R03)：口径A真实视口 1280×800 表头与首行六列对齐", async ({
  page,
}) => {
  await page.setViewportSize(wideViewport);
  await gotoReady(page, "/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  const header = page.locator(".table-header--grid");
  await expect(header).toBeVisible();
  const headerCells = header.locator(":scope > *");
  const firstRow = page.locator(".file-row").first();
  await expect(firstRow).toBeVisible();
  const rowCells = firstRow.locator(":scope > *");
  // R03 约定：表头与行共用同一六列定义；额外 grid 项会先破坏该计数。
  expect(await headerCells.count()).toBe(6);
  expect(await rowCells.count()).toBe(6);
  const [headerEdges, rowEdges] = await Promise.all([
    headerCells.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    ),
    rowCells.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    ),
  ]);
  for (let index = 0; index < 6; index += 1) {
    expect(
      Math.abs(headerEdges[index] - rowEdges[index]),
      `第 ${index + 1} 列左右边错位`,
    ).toBeLessThanOrEqual(2);
  }
  await assertNoPageHorizontalOverflow(page);
});

test("V022-R55(R03)：口径A真实视口 720×480 窄屏表头隐藏与隐藏列 DOM 保留", async ({
  page,
}) => {
  await page.setViewportSize(smallViewport);
  await gotoReady(page, "/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // R03 约定中已达成的现状：≤720px 宽隐藏表头，隐藏列保留 DOM
  //（读屏名称与行详情仍可达），页面无横向溢出。
  await expect(page.locator(".table-header--grid")).toBeHidden();
  const firstRow = page.locator(".file-row").first();
  await expect(firstRow).toBeVisible();
  expect(
    await firstRow.locator(".file-row__selection").count(),
    "选择建议列 DOM 不得移除",
  ).toBeGreaterThan(0);
  expect(
    await firstRow.locator(".file-row__ownership").count(),
    "归属列 DOM 不得移除",
  ).toBeGreaterThan(0);
  await assertNoPageHorizontalOverflow(page);
});

test("V022-R55(R03)：口径A真实视口 720×480 窄屏简化四列排版", async ({
  page,
}) => {
  // V022-R27 附带修复已落地：窄屏隐藏列以更高特异性重申，不再被后部同优先级
  // `.file-row__selection{display:flex}` 覆盖；本断言由 test.fail 翻绿为正式断言。
  // 若隐藏规则再次被覆盖，本断言按原反证逻辑失败（选择建议列参与排版/列重叠）。
  await page.setViewportSize(smallViewport);
  await gotoReady(page, "/");
  const firstRow = page.locator(".file-row").first();
  await expect(firstRow).toBeVisible();
  await expect(
    firstRow.locator(".file-row__selection"),
    "选择建议列应不参与窄屏排版",
  ).toBeHidden();
  await expect(
    firstRow.locator(".file-row__ownership"),
    "归属列应不参与窄屏排版",
  ).toBeHidden();
  // 行退化为选择/文件/状态/操作四列，可见单元格横向互不重叠（允许 1px 舍入）。
  const intervals = await firstRow
    .locator(
      ":scope > input, :scope > .file-path, :scope > .file-row__status, :scope > .file-row__actions",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, right: rect.x + rect.width };
      }),
    );
  expect(intervals.length).toBe(4);
  const sorted = [...intervals].sort((a, b) => a.x - b.x);
  for (let index = 1; index < sorted.length; index += 1) {
    expect(
      sorted[index].x,
      `可见列 ${index} 与前一列重叠`,
    ).toBeGreaterThanOrEqual(sorted[index - 1].right - 1);
  }
});

test("V022-R55(R27)：口径A真实视口 720×480 首屏至少 2 个完整文件/修订行", async ({
  page,
}) => {
  // V022-R27 已落地：Changes 高度链（flex 剩余空间）+ 小高度默认收起
  // （共享草稿/长帮助）+ 历史等只读页推荐降级 + 窄屏搜索框高度修复；
  // 本断言由 test.fail 翻绿为正式断言，铬区回退即失败。
  await page.setViewportSize(smallViewport);

  await gotoReady(page, "/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  const changesComplete = await page
    .getByRole("list", { name: "SVN 变更文件" })
    .getByRole("listitem")
    .evaluateAll((elements, viewportHeight) => {
      const inViewport = (rect: DOMRect) =>
        rect.height > 0 &&
        rect.y >= 0 &&
        rect.y + rect.height <= viewportHeight;
      return elements.filter((element) =>
        inViewport(element.getBoundingClientRect()),
      ).length;
    }, smallViewport.height);
  expect(changesComplete, "Changes 首屏完整文件行数").toBeGreaterThanOrEqual(2);

  await gotoReady(page, "/?module=history");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();
  const historyComplete = await page
    .getByRole("list", { name: "SVN 修订列表" })
    .getByRole("listitem")
    .evaluateAll((elements, viewportHeight) => {
      const inViewport = (rect: DOMRect) =>
        rect.height > 0 &&
        rect.y >= 0 &&
        rect.y + rect.height <= viewportHeight;
      return elements.filter((element) =>
        inViewport(element.getBoundingClientRect()),
      ).length;
    }, smallViewport.height);
  expect(historyComplete, "History 首屏完整修订行数").toBeGreaterThanOrEqual(2);
});

test("V022-R55(主操作)：口径B等效缩放代理 720×480 核心主操作可达不遮挡", async ({
  page,
}) => {
  // 口径B：沿 SCR-12 / V017-F ZOOM 约定，200% 用 720×480 逻辑视口代理；
  // 此处只断言可达性（几何已由口径A覆盖），点击串联由 ZOOM-01/02 覆盖。
  // continuity=restore 恢复选择，使 Changes 主操作稳定落在 ready 态
  // “检查并提交所选”（默认页无选中时主操作为 suggest/兜底态，名称不同）。
  await page.setViewportSize(smallViewport);
  await gotoReady(page, "/?module=changes&continuity=restore");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await assertReachableUnobscured(
    page,
    page.getByRole("button", { name: /检查并提交所选/ }),
    "Changes 主操作",
  );
  await assertNoPageHorizontalOverflow(page);

  await gotoReady(page, "/?module=commit");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  await assertReachableUnobscured(
    page,
    page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
    "Commit 预览主操作",
  );
  await assertNoPageHorizontalOverflow(page);
});

for (const theme of Object.keys(themes) as Array<keyof typeof themes>) {
  test(`V022-R55(主题)：${theme} 口径A真实视口 720×480 可辨识无 axe 违规`, async ({
    page,
  }) => {
    await page.setViewportSize(smallViewport);
    await applyThemeVariables(page, theme);
    await gotoReady(page, "/");
    await expect(
      page.getByRole("heading", { name: "工作副本修改" }),
    ).toBeVisible();
    // 可辨识的文字断言（不只依赖颜色）：标题、列表与状态徽标文字均可见。
    await expect(
      page.getByRole("list", { name: "SVN 变更文件" }),
    ).toBeVisible();
    await expect(page.locator(".status-badge").first()).toBeVisible();
    expect(
      (await page.locator(".status-badge").first().textContent())?.trim()
        .length,
    ).toBeGreaterThan(0);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${theme} 存在 axe 可访问性问题`).toEqual([]);
    await assertNoPageHorizontalOverflow(page);
    // 真实视口截图（非 fullPage），编号绑定提交与构建模式。
    await page.screenshot({
      path: artifactName(`${theme}-720x480-changes`),
      animations: "disabled",
    });
  });
}

test.describe("V022-R55(口径B：等效缩放光栅对照)", () => {
  // 同一 CSS 视口 720×480 + deviceScaleFactor 2：CSS 几何应与口径A一致，
  // 差异只在光栅像素。真实 VS Code 200% 真缩放仍为人工观察项。
  test.use({ deviceScaleFactor: 2 });

  test("720×480 CSS + dsf=2 输入框 CSS 几何与真实视口一致", async ({
    page,
  }) => {
    await page.setViewportSize(smallViewport);
    await gotoReady(page, "/?module=commit");
    const textarea = page.getByRole("textbox", { name: "提交说明" });
    await expect(textarea).toBeVisible();
    const textareaBox = await textarea.boundingBox();
    expect(textareaBox, "输入框应有可测盒模型").not.toBeNull();
    expect(textareaBox!.height).toBeGreaterThanOrEqual(150);
    await page.screenshot({
      path: artifactName("dsf2-720x480-commit"),
      animations: "disabled",
    });
  });
});
