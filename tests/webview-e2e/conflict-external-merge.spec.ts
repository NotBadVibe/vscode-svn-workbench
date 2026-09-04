// 中文注释：V018-F 外部合并工具出口 E2E —— 预览→一次确认→退出反馈→不自动 Resolve；
// 未配置（?mergeTool=missing）三出口可见。
import { expect, test } from "@playwright/test";

test("外部合并工具：预览→确认→退出反馈，不自动 Resolve（V018-F）", async ({
  page,
}) => {
  await page.goto("/?module=conflicts");
  // 解决确认折叠区默认收起，先展开再操作外部出口。
  await page
    .locator('[data-testid="conflict-help-details"] summary')
    .first()
    .click();
  // 默认入口：点击后经 mock 生成确认预览。
  await page.getByTestId("open-external-merge").click();
  await expect(page.getByTestId("external-merge-open-dialog")).toBeVisible();
  // 打开前确认：文件角色、将传递的路径、外部修改警告。
  await page.getByTestId("external-merge-open-dialog").click();
  const dialog = page.locator(".operation-intent-dialog__card");
  await expect(dialog).toContainText("在外部合并工具中打开 1 个文件");
  await expect(dialog).toContainText("我的修改（本地）");
  await expect(dialog).toContainText("外部工具可能修改工作副本");
  // 确认后 mock 模拟退出重采：反馈提示重开/重比。
  await dialog.getByRole("button", { name: "在外部工具中打开" }).click();
  await expect(page.getByTestId("external-merge-feedback")).toContainText(
    "请重新打开/比较",
  );
  await expect(page.getByTestId("external-merge-feedback")).toContainText(
    "未自动标记解决",
  );
});

test("外部合并工具未配置：三出口可见（V018-F）", async ({ page }) => {
  await page.goto("/?module=conflicts&mergeTool=missing");
  await page
    .locator('[data-testid="conflict-help-details"] summary')
    .first()
    .click();
  await page.getByTestId("open-external-merge").click();
  const notice = page.getByTestId("external-merge-needs-config");
  await expect(notice).toBeVisible();
  await expect(page.getByTestId("external-merge-pick")).toBeVisible();
  await expect(page.getByTestId("external-merge-settings")).toBeVisible();
  await expect(page.getByTestId("external-merge-continue")).toBeVisible();
  // 继续内置编辑：提示收起，不触发自动 Resolve。
  await page.getByTestId("external-merge-continue").click();
  await expect(notice).not.toBeVisible();
});
