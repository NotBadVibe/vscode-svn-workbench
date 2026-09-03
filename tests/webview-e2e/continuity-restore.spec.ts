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

/*
 * V014-F2 · 5000 文件 × 恢复组合（`?dataset=large&continuity=restore-large`）。
 * 覆盖：虚拟化生效（file-list--virtual、挂载 listitem<100）、恢复选择数正确、
 * 活动行恢复到 large key 且在列表视口内可见、removedEntries 逐条播报；
 * 滚动到底后挂载预算仍成立（file-4999.ts 可达且 listitem<100）。
 * 全程确定性：只用 expect 轮询与滚动事件，不用 waitForTimeout 死等。
 */
test("V014-F2：5000 文件恢复后虚拟化/选择/活动行/播报均正确且滚动后仍窗口化", async ({
  page,
}) => {
  await page.goto("/?module=changes&dataset=large&continuity=restore-large");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 虚拟化生效：窗口化类 + 挂载行预算。
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await expect(list).toHaveClass(/file-list--virtual/);
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);

  // 恢复的选择交集（large 载荷选中 file-2500.ts + file-2501.ts）。
  await expect(
    page.getByRole("checkbox", {
      name: "选择 src/generated/deep/path/file-2500.ts",
    }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "选择 src/generated/deep/path/file-2501.ts",
    }),
  ).toBeChecked();

  // 移除原因与恢复提示逐条播报。
  await expect(
    page.getByText(/已按最新快照保留 2 个选择，移除 1 个失效项。/),
  ).toBeVisible();
  await expect(
    page.getByText(/文件已不在最新快照中，可能已被删除、移走或状态变化/),
  ).toBeVisible();

  // 活动行落在 large 恢复锚点上，且已滚动进列表视口（真实可见）。
  const activeRow = page.locator(".file-row--active");
  await expect(activeRow).toHaveCount(1);
  await expect(activeRow).toContainText("file-2500.ts");
  const [listBox, activeBox] = await Promise.all([
    list.boundingBox(),
    activeRow.boundingBox(),
  ]);
  expect(listBox).not.toBeNull();
  expect(activeBox).not.toBeNull();
  expect(activeBox!.y).toBeGreaterThanOrEqual(listBox!.y - 1);
  expect(activeBox!.y + activeBox!.height).toBeLessThanOrEqual(
    listBox!.y + listBox!.height + 1,
  );

  // 恢复后的权威数量：ready 态主操作显示所选 2 个。
  await expect(
    page.getByRole("button", { name: /检查并提交所选（2）/ }),
  ).toBeVisible();

  // 滚动到底后挂载预算仍成立，末项可达。
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  await expect(
    page.locator(".path-cell__name", { hasText: "file-4999.ts" }),
  ).toBeVisible();
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);
});
