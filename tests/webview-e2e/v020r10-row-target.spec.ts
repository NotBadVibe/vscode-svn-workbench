import { expect, test } from "@playwright/test";

/*
 * V020-R10 · 行右键任务定位所点文件（P1）。
 * - 目录中右键第二个文件只显示该文件历史，文件级 Blame/恢复能力正确，返回恢复来源列表。
 * - 多个冲突点击非首个文件直接定位正确对象。
 * - 后台刷新（加载更早）不抢焦点。
 * 伪造范围外路径被拒绝由 Host 单测覆盖（workbenchRowTarget）。
 */

test("V020-R10：右键第二个文件只显示该文件历史，返回恢复来源列表", async ({
  page,
}) => {
  await page.goto("/?module=changes");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  const row = page.locator(".file-row").filter({ hasText: "App.svelte" });
  await row.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "src/webview/App.svelte 操作菜单" }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "查看历史" }).click();

  // 落到单文件历史：横幅给出目标文件，文件级能力可用。
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();
  const banner = page.getByTestId("history-file-target");
  await expect(banner).toContainText("src/webview/App.svelte");
  await expect(
    page.getByRole("button", { name: "查看逐行责任" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "从此修订恢复" }),
  ).toBeVisible();

  // 返回仍恢复来源列表。
  await page.getByRole("button", { name: "返回本地修改" }).click();
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await expect(
    page.locator(".file-row").filter({ hasText: "App.svelte" }),
  ).toBeVisible();
});

test("V020-R10：多冲突点击非首个文件直接定位正确对象", async ({ page }) => {
  await page.goto("/?module=conflicts&conflicts=multi");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();

  await page.locator('button.conflict-row[data-row-index="1"]').click();
  // 工作区定位到第二个文件，而非首个。
  await expect(
    page.locator(".conflict-header .file-title strong"),
  ).toContainText("src/conflict/b.ts");
  await expect(
    page.locator('button.conflict-row[data-row-index="1"]'),
  ).toHaveClass(/active/);
});

test("V020-R10：单文件历史后台刷新不抢焦点", async ({ page }) => {
  await page.goto("/?module=history&historyFileTarget=1");
  await expect(page.getByTestId("history-file-target")).toBeVisible();

  // 本地筛选与后台只读查询共存：新快照到达不得抢焦点（焦点留在用户触发控件）。
  const search = page.getByLabel("筛选历史");
  await search.fill("迁移");
  await page.getByText("按条件加载更早修订").click();
  const queryButton = page.getByRole("button", { name: "按条件查询" });
  await queryButton.click();
  await expect(page.getByText("已加载最近 2 条修订。")).toBeVisible();
  // 横幅仍在单文件目标，焦点仍在查询按钮，未被抢走。
  await expect(page.getByTestId("history-file-target")).toContainText(
    "src/extension.ts",
  );
  await expect(queryButton).toBeFocused();
});
