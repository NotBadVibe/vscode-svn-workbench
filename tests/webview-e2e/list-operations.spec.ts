import { expect, test, type Page } from "@playwright/test";

/*
 * v0.0.8 列表闭环 e2e：UX08-SEL-01/02/03/04/06/07、SORT-01/02、
 * FLOW-01/02、A11Y-01、VIEW-01、PERF-01。
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

test("UX08-SEL-01/02/03/07：三态、筛选排序不改变选择、隐藏选择、数量一致", async ({
  page,
}) => {
  await page.goto("/");
  // SEL-01：三态与当前筛选可操作项一致（mock 有 2 个可操作、2 个 blocked、1 个 needsReview）。
  const header = page.getByRole("checkbox", {
    name: /选择当前筛选可操作项（/,
  });
  await expect(header).toBeVisible();
  await header.click();
  // 数量一致：摘要、底栏按钮与后续 Commit 候选一致。
  await expect(
    page.getByRole("button", { name: /检查并提交所选（3）/ }),
  ).toBeVisible();
  // blocked 永不加入。
  await expect(page.getByLabel("选择 src/conflict/example.ts")).toBeDisabled();

  // SEL-02：筛选与排序不静默改变选择。
  await page.getByRole("button", { name: /状态/ }).click();
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await page.getByLabel("筛选变更文件").fill("App.svelte");
  // 隐藏选择保留并可见（SEL-03）。
  await expect(page.getByText(/隐藏 2/)).toBeVisible();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();
  // 清除隐藏选择只移除筛选外部分。
  await page.getByRole("button", { name: "清除隐藏选择" }).click();
  await expect(page.getByText(/隐藏 0/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: /检查并提交所选（1）/ }),
  ).toBeVisible();
});

test("UX08-SEL-04：刷新不自动加入新文件，合法选择保留", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("选择 src/extension.ts").check();
  await page.getByRole("button", { name: "刷新当前模块" }).click();
  // 刷新后选择保留；未被自动全选。
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(
    page.getByLabel("选择 src/webview/App.svelte"),
  ).not.toBeChecked();
});

test("UX08-SORT-01/02：aria-sort、图标与中文方向文字；恢复默认顺序", async ({
  page,
}) => {
  await page.goto("/");
  // v0.1.4 V014-B：主按钮文案含“文件”二字，锚定表头须用 /^文件/ 避免 strict 命中主按钮。
  const fileHeader = page.getByRole("button", { name: /^文件/ });
  await fileHeader.click();
  // 方向有中文文字与 aria-sort。
  await expect(page.getByText("升序").first()).toBeVisible();
  await expect(
    page.locator('[role="columnheader"][aria-sort="ascending"]').first(),
  ).toBeVisible();
  // 再次点击反向。
  await fileHeader.click();
  await expect(page.getByText("降序").first()).toBeVisible();
  await expect(
    page.locator('[role="columnheader"][aria-sort="descending"]').first(),
  ).toBeVisible();
  // 恢复默认顺序。
  await page.getByRole("button", { name: "恢复默认顺序" }).click();
  await expect(page.getByRole("button", { name: "恢复默认顺序" })).toHaveCount(
    0,
  );
});

test("UX08-FLOW-01/02：筛选 7 个已修改文件后一次全选并进入 Commit，数量一致", async ({
  page,
}) => {
  await page.goto("/?dataset=seven");
  // 筛选“已修改”状态：真实 7 个 modified 的批量语义。
  await page.getByRole("button", { name: "已修改 7" }).click();
  const header = page.getByRole("checkbox", {
    name: "选择当前筛选可操作项（7）",
  });
  await header.click();
  // 表头全选 7 个；批量按钮数量一致。
  await page.getByRole("button", { name: "检查并提交所选（7）" }).click();
  // Commit 选中与候选数量一致：7 个已选（范围候选 10，含 blocked/excluded），
  // 预览按钮与选择数量一致（7）。
  await expect(page.getByText(/已选 7 \/ 候选 10/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成提交预览（7）" }),
  ).toBeVisible();
});

test("UX08-A11Y-01：键盘完成导航、选择、批量选择与差异打开", async ({
  page,
}) => {
  await page.goto("/");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await list.focus();
  // 方向键导航（活动行与选择分离）。
  await page.keyboard.press("ArrowDown");
  await expect(page.getByLabel("选择 src/extension.ts")).not.toBeChecked();
  // Space 切换当前行。
  await page.keyboard.press(" ");
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  // Shift+ArrowDown 连续选择。
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();
  // Ctrl+A 选择当前筛选可操作项（包含已选项幂等）。
  await page.keyboard.press("ControlOrMeta+a");
  await expect(page.getByLabel("选择 dist/debug.log")).toBeChecked();
  // blocked 不进入批量。
  await expect(page.getByLabel("选择 src/conflict/example.ts")).toBeDisabled();
});

test("UX08-VIEW-01：720×480 小视口主操作可达且无页面级横向滚动", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/");
  await page.getByLabel("选择 src/extension.ts").check();
  // Sticky 底栏批量动作可达。
  await expect(page.getByRole("toolbar", { name: "批量操作" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /检查并提交所选（1）/ }),
  ).toBeVisible();
  await assertNoPageHorizontalOverflow(page);
});

test("UX08-VIEW-01b：Sticky 批量底栏不遮挡列表末行与焦点（Task 2 缺口）", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?dataset=scroll");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  // 滚到末项。
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const lastRow = list.getByRole("listitem").last();
  await expect(lastRow).toBeVisible();
  const [rowBox, barBox, listBox] = await Promise.all([
    lastRow.boundingBox(),
    page.getByRole("toolbar", { name: "批量操作" }).boundingBox(),
    list.boundingBox(),
  ]);
  // 末行完整位于列表容器内（不被页面级 Sticky 底栏遮挡）。
  expect(rowBox!.y + rowBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );
  expect(barBox!.y).toBeGreaterThanOrEqual(listBox!.y + listBox!.height - 1);
  // 末行聚焦不被底栏覆盖。
  await lastRow.focus();
  const activeBox = await lastRow.boundingBox();
  expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(barBox!.y + 1);
});

test("UX08-SEL-06/PERF-01：5,000 文件全选覆盖完整数据集且挂载行有预算", async ({
  page,
}) => {
  await page.goto("/?dataset=large");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
  // 全选作用于完整筛选数据集（5,000），不是已挂载行。
  await page
    .getByRole("checkbox", { name: "选择当前筛选可操作项（5000）" })
    .click();
  await expect(
    page.getByRole("button", { name: "检查并提交所选（5000）" }),
  ).toBeVisible();
  // 挂载行仍不超过预算。
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
});
