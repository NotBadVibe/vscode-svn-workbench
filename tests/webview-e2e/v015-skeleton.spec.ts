import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * V015-F2 · Update/History 骨架页视口矩阵（只改测试，不动业务源码/mock）。
 * 复用 v014-interactions.spec.ts（交互矩阵模式）与
 * chinese-scroll.spec.ts（assertScrollable/视口矩阵 fixture）写法：
 * 只用 expect 轮询与键盘事件，不用 waitForTimeout 死等；断言平台无关。
 * Mock 状态全部来自既有 mockWorkbench 语义：
 * - Update 默认：冲突 2 + 无预览（空态）；
 * - Update 预览：点击“生成更新预览”后 mock 下发 preview（remoteCount=2）；
 * - Update 结果：意向单确认后 mock 下发 result（已更新到 r43）；
 * - History 默认：2 条修订 + hasMore=true（可能还有更早修订）。
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

async function assertEachBarHasUniquePrimary(
  page: Page,
  label: string,
): Promise<void> {
  const toolbars = page.getByRole("toolbar");
  expect(await toolbars.count(), `${label} 缺少操作栏`).toBeGreaterThan(0);
  for (let index = 0; index < (await toolbars.count()); index += 1) {
    const bar = toolbars.nth(index);
    await expect(
      bar.locator(".button--primary"),
      `${label} 第 ${index + 1} 个操作栏 primary 不唯一`,
    ).toHaveCount(1);
  }
}

async function assertFullBudget(page: Page, label: string): Promise<void> {
  // 骨架约束 full≤1：同页 variant="full" 全宽摘要至多 1 个（与
  // UpdateModule.test.ts "同页 full 摘要至多 1 个"同口径）。预览态按设计
  // 允许冲突 full 警告 + 风险 compact 警告共存（后者 tone=warning 故
  // role=alert），预算只约束全宽，不约束 compact 共存。
  expect(
    await page.locator(".task-summary--full").count(),
    `${label} 全宽摘要超过 1 个`,
  ).toBeLessThanOrEqual(1);
  expect(
    await page.locator('.task-summary--full[role="alert"]').count(),
    `${label} 全宽强状态超过 1 个`,
  ).toBeLessThanOrEqual(1);
}

/*
 * 1) Update 页 720×480：冲突 TaskSummary 可见、每栏唯一 primary 可达、
 * 无横向溢出、TaskEmptyState 三句完整。
 */
test("V015-F2(1)：Update 720×480 空态骨架可达", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=update");
  await expect(
    page.getByRole("heading", { name: "更新当前范围" }).first(),
  ).toBeVisible();

  // TaskSummary：常驻冲突 CTA（mock 默认 2 个冲突）。
  const conflictSummary = page
    .getByRole("alert", { name: "任务状态摘要" })
    .first();
  await assertInsideContent(page, conflictSummary, "更新冲突摘要");
  await expect(conflictSummary.getByText("当前范围有 2 个冲突")).toBeVisible();

  // PrimaryActionBar：每栏唯一 primary，且主操作可达。
  await assertEachBarHasUniquePrimary(page, "Update 空态");
  await assertInsideContent(
    page,
    page.getByRole("button", { name: "处理 2 个冲突" }),
    "处理冲突主操作",
  );
  await assertInsideContent(
    page,
    page.getByRole("button", { name: "生成更新预览" }),
    "生成更新预览主操作",
  );

  // TaskEmptyState 三句完整（发生了什么/是否正常/现在能做什么）。
  const emptyState = page.getByRole("status", { name: "空状态说明" });
  await assertInsideContent(page, emptyState, "更新空态");
  await expect(emptyState.getByText("尚未生成更新预览")).toBeVisible();
  await expect(emptyState.getByText(/这是正常状态/)).toBeVisible();
  await expect(emptyState.getByText(/不会修改工作副本/)).toBeVisible();
  await expect(emptyState.getByText(/现在可以生成更新预览/)).toBeVisible();

  await assertFullBudget(page, "Update 空态");
  await assertNoPageHorizontalOverflow(page);
});

/*
 * 2) 200% 代理（沿 SCR-12 约定：200% 用 720×480 逻辑视口）：
 * 同页加键盘焦点往返，证明主操作在高缩放下仍可达。
 */
test("V015-F2(2)：200% 代理下 Update 主操作键盘可达", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=update");
  await expect(
    page.getByRole("heading", { name: "更新当前范围" }).first(),
  ).toBeVisible();

  const conflictOp = page.getByRole("button", { name: "处理 2 个冲突" });
  await assertInsideContent(page, conflictOp, "200% 处理冲突主操作");
  await conflictOp.focus();
  await expect(conflictOp).toBeFocused();
  // Tab 可离开，不形成键盘陷阱。
  await conflictOp.press("Tab");
  expect(
    await conflictOp.evaluate((element) => document.activeElement !== element),
  ).toBe(true);

  const previewOp = page.getByRole("button", { name: "生成更新预览" });
  await assertInsideContent(page, previewOp, "200% 生成更新预览");
  await previewOp.focus();
  await expect(previewOp).toBeFocused();

  await assertEachBarHasUniquePrimary(page, "200% Update");
  await assertNoPageHorizontalOverflow(page);
});

/*
 * 3) History 页 720×480：TaskSummary 边界文案、比较栏 countText、唯一 primary。
 */
test("V015-F2(3)：History 720×480 边界文案与比较栏可达", async ({ page }) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=history");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();

  // TaskSummary 边界文案：已加载 N 条/可能还有更早（mock 默认 2 条 + hasMore）。
  const loadedSummary = page.getByRole("status", { name: "任务状态摘要" });
  await assertInsideContent(page, loadedSummary, "历史已加载摘要");
  await expect(
    loadedSummary.getByText("已加载最近 2 条修订（可能还有更早修订）"),
  ).toBeVisible();

  // 比较栏 countText + 唯一 primary（未选 2 条时禁用但可见）。
  const compareBar = page.getByRole("toolbar", { name: "修订比较操作栏" });
  await expect(compareBar).toBeVisible();
  await expect(compareBar.getByText("已选择 0/2 条修订")).toBeVisible();
  await expect(
    compareBar.locator(".button--primary"),
    "比较栏 primary 不唯一",
  ).toHaveCount(1);
  const comparePrimary = compareBar.getByRole("button", {
    name: "比较所选修订",
  });
  await assertInsideContent(page, comparePrimary, "比较所选修订");

  // 修订列表末项可达（滚动归属明确）。
  const revisions = page.getByRole("list", { name: "SVN 修订列表" });
  await revisions.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  const lastItem = revisions.getByRole("listitem").last();
  const [listBox, itemBox] = await Promise.all([
    revisions.boundingBox(),
    lastItem.boundingBox(),
  ]);
  expect(listBox).not.toBeNull();
  expect(itemBox).not.toBeNull();
  expect(itemBox!.y + itemBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );

  await assertFullBudget(page, "History");
  await assertNoPageHorizontalOverflow(page);
});

/*
 * 4) Update 页 1024×600：用 mock 构造预览态（点击生成预览），
 * 预览后 PrimaryActionBar 可达；确认执行后 ResultNextStep 可达。
 */
test("V015-F2(4)：Update 1024×600 预览后操作栏与结果出口可达", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?module=update");
  await expect(
    page.getByRole("heading", { name: "更新当前范围" }).first(),
  ).toBeVisible();

  // mock 构造预览态：点击后下发 remoteCount=2 / 中风险预览。
  await page.getByRole("button", { name: "生成更新预览" }).click();
  await expect(page.getByText("中风险")).toBeVisible();
  const confirmEntry = page.getByRole("button", { name: "确认更新（2）" });
  await assertInsideContent(page, confirmEntry, "确认更新主操作");
  await assertEachBarHasUniquePrimary(page, "Update 预览态");
  await assertNoPageHorizontalOverflow(page);

  // 执行后结果出口可达（意向单确认 → 已更新到 r43）。
  await confirmEntry.click();
  const updateDialog = page.getByRole("dialog", {
    name: /更新 (\d+ 个远端变更|当前范围)/,
  });
  await expect(updateDialog).toBeVisible();
  await updateDialog.getByRole("button", { name: /确认更新/ }).click();
  const result = page.getByRole("status", { name: "任务结果与下一步" });
  await assertInsideContent(page, result, "更新结果出口");
  await expect(result.getByText("已更新到 r43")).toBeVisible();
  await assertInsideContent(
    page,
    result.getByRole("button", { name: "处理 2 个冲突" }),
    "结果页处理冲突主操作",
  );
  await assertFullBudget(page, "Update 结果态");
  await assertNoPageHorizontalOverflow(page);
});

/*
 * 5) full≤1 断言：Update 空态/预览态/结果态下
 * role=alert 与全宽摘要均不超过 1 个。
 */
test("V015-F2(5)：Update 各状态强状态预算 full≤1", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?module=update");

  await test.step("空态", async () => {
    await expect(page.getByText("尚未生成更新预览")).toBeVisible();
    await assertFullBudget(page, "空态");
  });

  await test.step("预览态", async () => {
    await page.getByRole("button", { name: "生成更新预览" }).click();
    await expect(page.getByText("中风险")).toBeVisible();
    await assertFullBudget(page, "预览态");
  });

  await test.step("结果态", async () => {
    await page.getByRole("button", { name: "确认更新（2）" }).click();
    const updateDialog = page.getByRole("dialog", {
      name: /更新 (\d+ 个远端变更|当前范围)/,
    });
    await expect(updateDialog).toBeVisible();
    await updateDialog.getByRole("button", { name: /确认更新/ }).click();
    await expect(page.getByText("已更新到 r43")).toBeVisible();
    await assertFullBudget(page, "结果态");
  });

  await assertNoPageHorizontalOverflow(page);
});
