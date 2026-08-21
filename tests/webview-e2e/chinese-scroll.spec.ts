import { expect, test, type Locator, type Page } from "@playwright/test";
import { openModule } from "./navigation";

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

async function assertScrollable(
  region: Locator,
  lastItem?: Locator,
): Promise<void> {
  await expect(region).toBeVisible();
  await region.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  const metrics = await region.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    scrollTop: element.scrollTop,
    overflowY: getComputedStyle(element).overflowY,
    scrollbarColor: getComputedStyle(element).scrollbarColor,
  }));
  expect(
    metrics.scrollHeight,
    `滚动区 ${await region.getAttribute("aria-label")} 没有形成真实溢出`,
  ).toBeGreaterThan(metrics.clientHeight + 1);
  expect(["auto", "scroll"]).toContain(metrics.overflowY);
  expect(metrics.scrollbarColor).not.toBe("auto");

  await region.focus();
  await region.press("PageDown");
  await expect
    .poll(() => region.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(metrics.scrollTop);
  await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });

  if (lastItem) {
    const [containerBox, itemBox] = await Promise.all([
      region.boundingBox(),
      lastItem.boundingBox(),
    ]);
    expect(containerBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    expect(itemBox!.y + itemBox!.height).toBeLessThanOrEqual(
      containerBox!.y + containerBox!.height + 1,
    );
    expect(itemBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 1);
  }

  await region.press("Tab");
  expect(
    await region.evaluate((element) => document.activeElement !== element),
  ).toBe(true);
}

test("SCR-01/02/09/10/11：小视口下 Shell 和变更列表完整可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?dataset=scroll");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await assertNoPageHorizontalOverflow(page);

  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await assertScrollable(list, list.getByRole("listitem").last());
  await expect(page.getByText("更新于").first()).not.toContainText(/AM|PM/i);
});

test("SCR-03：提交双栏分别滚动，底部确认操作可达", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "提交");
  const files = page.getByRole("list", { name: "提交候选文件" });
  await assertScrollable(files, files.getByRole("listitem").last());

  await page
    .getByRole("textbox", { name: "提交说明" })
    .fill("feat(中文界面): 验证小区域滚动");
  await page.getByRole("button", { name: /生成提交预览/ }).click();
  const compose = page.getByRole("region", { name: "提交说明与提交前检查" });
  await assertScrollable(
    compose,
    page.getByRole("button", { name: /确认提交/ }),
  );
  await expect(page.getByRole("button", { name: /确认提交/ })).toBeEnabled();
  await assertNoPageHorizontalOverflow(page);
});

test("SCR-04：历史列表、变更路径和逐行责任均可滚到末项", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "历史");
  const revisions = page.getByRole("list", { name: "SVN 修订列表" });
  await assertScrollable(revisions, revisions.getByRole("listitem").last());
  const paths = page.getByRole("region", { name: "当前修订的变更路径" });
  await assertScrollable(paths, paths.locator(".changed-path-row").last());
  await page.getByRole("button", { name: "查看逐行责任" }).click();
  const blame = page.getByRole("region", { name: "文件逐行责任" });
  await assertScrollable(blame, blame.locator(":scope > div").last());
});

test("SCR-05：冲突列表、编辑器正文和解决确认在小高度下可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "冲突");
  const conflicts = page.getByRole("list", { name: "冲突文件" });
  await assertScrollable(conflicts, conflicts.getByRole("listitem").last());

  const editorScroller = page.locator(".conflict-codemirror-host .cm-scroller");
  await expect(editorScroller).toBeVisible();
  expect(
    await editorScroller.evaluate((element) => element.scrollHeight),
  ).toBeGreaterThan(
    await editorScroller.evaluate((element) => element.clientHeight),
  );
  await editorScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await page.getByRole("button", { name: "AI 分析" }).click();
  await page.getByRole("button", { name: "生成解决预览" }).click();
  const workspace = page.getByRole("region", { name: "冲突处理工作区" });
  await assertScrollable(
    workspace,
    page.getByRole("button", { name: "确认使用当前工作副本内容并标记解决" }),
  );
});

test("SCR-06：变更集三栏拥有独立滚动归属且选择不丢失", async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "变更集");
  const current = page.getByRole("region", { name: "变更集与未分组文件" });
  await assertScrollable(current, current.locator(".changelist-row").last());
  await page.getByRole("button", { name: "生成分组建议" }).click();
  const suggestions = page.getByRole("region", { name: "分组建议" });
  await assertScrollable(
    suggestions,
    suggestions.locator(".split-card").last(),
  );
  await suggestions.getByRole("button", { name: "套用并调整" }).first().click();
  const editor = page.getByRole("region", { name: "应用 SVN 变更集" });
  await expect(editor).toBeVisible();
  const selectedPaths = editor.locator(".selected-paths");
  await assertScrollable(
    selectedPaths,
    selectedPaths.locator(":scope > div").last(),
  );
  await expect(editor.getByText(/将分组的文件（36）/)).toBeVisible();
});

test("SCR-07：仓库子任务按需显示，目录与属性列表均可滚到末项", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "仓库操作");
  await expect(
    page.locator('[data-repository-task="repository/update"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "更新当前范围", exact: true }).last(),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "仓库浏览器" })).toHaveCount(
    0,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /UpdateTask-.*\.js/.test(entry.name)),
      ),
    )
    .toBe(true);
  const loadedTaskChunks = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => entry.name),
  );
  for (const taskChunk of [
    "BrowseTask",
    "PropertiesTask",
    "AdvancedTask",
    "PatchShelfTask",
    "ReleaseNotesTask",
  ]) {
    expect(
      loadedTaskChunks.some((name) => name.includes(`${taskChunk}-`)),
      `${taskChunk} 不应随更新任务加载`,
    ).toBe(false);
  }

  await page.getByRole("button", { name: "浏览仓库", exact: true }).click();
  const browser = page.getByRole("region", { name: "仓库目录内容" });
  await assertScrollable(browser, browser.getByRole("button").last());
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /BrowseTask-.*\.js/.test(entry.name)),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "SVN 属性", exact: true }).click();
  const properties = page.getByRole("region", { name: "当前 SVN 属性" });
  await assertScrollable(properties, properties.getByRole("button").last());
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => /PropertiesTask-.*\.js/.test(entry.name)),
      ),
    )
    .toBe(true);
});

test("SCR-08：设置和诊断长列表具有明确滚动区", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "设置");
  const scenarios = page.getByRole("region", { name: "模型场景列表" });
  await assertScrollable(scenarios, scenarios.locator(".scenario-row").last());
  await page.getByRole("tab", { name: "团队提交规范" }).click();
  const memory = page.getByRole("list", { name: "最近团队记忆" });
  await assertScrollable(memory, memory.getByRole("listitem").last());

  await openModule(page, "诊断");
  const checks = page.getByRole("region", { name: "环境检查项目" });
  await assertScrollable(checks, checks.locator(".diagnostic-row").last());
  const acceptanceTab = page.getByRole("tab", { name: "验收清单" });
  if ((await acceptanceTab.count()) > 0) {
    await acceptanceTab.click();
    const acceptance = page.getByRole("region", { name: "人工验收项目" });
    await assertScrollable(
      acceptance,
      acceptance.locator(".acceptance-section").last(),
    );
  } else {
    await expect(acceptanceTab).toHaveCount(0);
  }
});

test("ZH-01/02/03/04/09：公共状态、数量、时间和 AI 外发说明符合中文习惯", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("已修改").first()).toBeVisible();
  await expect(page.getByText("存在冲突").first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\b(?:AM|PM)\b/i);

  for (const moduleName of [
    "提交",
    "历史",
    "冲突",
    "变更解读",
    "仓库操作",
    "设置",
    "诊断",
  ]) {
    await openModule(page, moduleName);
    const pureEnglishControls = await page
      .locator("h1, h2, button, .eyebrow")
      .evaluateAll((elements) =>
        elements
          .map((element) => (element.textContent ?? "").trim())
          .filter((text) => /^[A-Za-z][A-Za-z\s-]{2,}$/.test(text))
          .filter(
            (text) =>
              !["AI", "SVN", "BASE", "DeepSeek", "vscode-svn"].includes(text),
          ),
      );
    expect(
      pureEnglishControls,
      `${moduleName} 存在未纳入白名单的英文业务文案`,
    ).toEqual([]);
  }
  await openModule(page, "提交");
  await expect(page.getByText(/已选 \d+ \/ 候选 \d+ 个文件/)).toBeVisible();
  await openModule(page, "变更解读");
  await expect(page.getByText(/AI 不会修改文件或执行提交/)).toBeVisible();
  await expect(
    page.getByText(/理解当前修改、找出需要确认的风险/),
  ).toBeVisible();
});

test("SCR-12/13/14/15 与 ZH-10：高度和 100%～200% 缩放矩阵无永久裁切", async ({
  page,
}) => {
  const matrix = [
    { width: 1440, height: 900, zoom: "100%" },
    { width: 1152, height: 720, zoom: "125%" },
    { width: 960, height: 600, zoom: "150%" },
    { width: 720, height: 480, zoom: "200%" },
  ];
  for (const item of matrix) {
    await test.step(item.zoom, async () => {
      await page.setViewportSize({ width: item.width, height: item.height });
      await page.goto("/?error=authentication");
      await assertNoPageHorizontalOverflow(page);
      const action = page.getByRole("button", { name: "配置认证" });
      await action.scrollIntoViewIfNeeded();
      await expect(action).toBeVisible();
      await expect(page.getByText(/密码只通过标准输入交给 SVN/)).toBeVisible();
      await action.focus();
      const [contentBox, actionBox] = await Promise.all([
        page.locator(".workbench-content").boundingBox(),
        action.boundingBox(),
      ]);
      expect(actionBox!.y).toBeGreaterThanOrEqual(contentBox!.y - 1);
      expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(
        contentBox!.y + contentBox!.height + 1,
      );
      await action.press("Tab");
      expect(
        await action.evaluate((element) => document.activeElement !== element),
      ).toBe(true);
    });
  }
});

test("SCR-08b：提交选择规则在小高度下规则列表、预览与底部操作可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?dataset=scroll");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();

  const ruleList = page.getByRole("region", { name: "提交选择路径规则列表" });
  await assertScrollable(
    ruleList,
    ruleList.locator(".selection-rule-row").last(),
  );
  const previewList = page.getByRole("region", {
    name: "提交选择规则预览结果",
  });
  await assertScrollable(
    previewList,
    previewList.locator(".selection-preview-row").last(),
  );

  // 键盘到达规则列表末项：聚焦滚动区后 PageDown 逐屏滚动到底，末行在可视区域内
  await ruleList.focus();
  const atBottom = () =>
    ruleList.evaluate(
      (element) =>
        element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
    );
  for (let index = 0; index < 48 && !(await atBottom()); index += 1) {
    await ruleList.press("PageDown");
  }
  expect(await atBottom()).toBe(true);
  const lastRow = ruleList.locator(".selection-rule-row").last();
  const [listBox, lastRowBox] = await Promise.all([
    ruleList.boundingBox(),
    lastRow.boundingBox(),
  ]);
  expect(lastRowBox!.y + lastRowBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );

  // 底部主操作在页面滚动容器内可达（720×480 不允许永久不可达）
  const saveButton = page.getByRole("button", { name: "保存当前仓库规则" });
  await saveButton.scrollIntoViewIfNeeded();
  const [contentBox, buttonBox] = await Promise.all([
    page.locator(".workbench-content").boundingBox(),
    saveButton.boundingBox(),
  ]);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(contentBox!.y - 1);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(
    contentBox!.y + contentBox!.height + 1,
  );
});
