import { expect, test } from "@playwright/test";

/*
 * V014-C2 · Changes ↔ Diff 往返全路径（`?continuity=restore` mock 演示载荷）。
 * 覆盖：恢复选择/活动行/视图偏好/草稿/播报 → 进入 Diff → 返回本地修改 →
 * 再次恢复。返回导航复用 mock 的 open-module 真实路由（与线上 Host 同契约）。
 */
test("V014-C2：Changes→Diff→返回恢复选择/活动行/视图/草稿/播报", async ({
  page,
}) => {
  await page.goto("/?module=changes&continuity=restore");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 恢复的选择交集（mock 载荷选中 extension.ts + App.svelte）。
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/webview/App.svelte" }),
  ).toBeChecked();

  // 移除原因与恢复提示逐条播报。
  await expect(
    page.getByText(/已按最新快照保留 2 个选择，移除 1 个失效项。/),
  ).toBeVisible();

  // 载荷草稿回填（本地为空时）。
  await expect(page.getByLabel("共享提交草稿")).toHaveValue(
    "feat(workbench): 完善统一 Svelte 工作台",
  );

  // 活动行落在恢复的焦点文件上。
  const activeRow = page.locator(".file-row--active");
  await expect(activeRow).toHaveCount(1);
  await expect(activeRow).toContainText("extension.ts");

  // 进入 Diff：来源文件保持可达，工具栏提供返回入口。
  await page
    .getByRole("button", { name: "查看 src/extension.ts 差异" })
    .click();
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
  const backButton = page.getByRole("button", { name: "返回本地修改" });
  await expect(backButton).toBeVisible();
  await expect(backButton).not.toHaveClass(/button--primary/);

  // 返回 Changes：同一载荷在新挂载中重新消费，再次恢复选择与播报。
  await backButton.click();
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByText(/已按最新快照保留 2 个选择，移除 1 个失效项。/),
  ).toBeVisible();
  await expect(page.locator(".file-row--active")).toHaveCount(1);
});
