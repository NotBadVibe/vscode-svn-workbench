import { expect, test } from "@playwright/test";

/*
 * V023-R18 · 连续多文件审阅队列 e2e（mock Host 真实路由）。
 * Changes 多选→审阅所选→Diff 队列建立→上/下文件→标已看→返回本地修改恢复选择。
 * 全程确定性 expect 轮询，无 waitForTimeout；断言中文文案原文与平台无关。
 */
test("V023-R18：多选建立队列→上下文件→标已看→返回恢复", async ({ page }) => {
  await page.goto("/?continuity=restore");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  // 恢复的选择：extension.ts + App.svelte（2 个）。
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();

  // Changes 多选→Diff 队列建立（open-diff 真实路由切到 diff 模块）。
  await page.getByRole("button", { name: "审阅所选（2）" }).click();
  await expect(page.getByText("文件审阅队列")).toBeVisible();
  await expect(page.getByText("第 1/2 个")).toBeVisible();
  await expect(page.getByText("已看 0 个，未看 2 个")).toBeVisible();
  // 只读语义声明：标已看不代表提交授权或质量通过。
  await expect(
    page.getByText(/标记已看仅为个人审阅进度，不代表提交授权或质量通过/),
  ).toBeVisible();

  // 下一文件→第 2/2 个；标已看→计数更新。
  await page.getByRole("button", { name: "下一个文件" }).click();
  await expect(page.getByText("第 2/2 个")).toBeVisible();
  await page.getByRole("button", { name: /标为已看：/ }).click();
  await expect(page.getByText("已看 1 个，未看 1 个")).toBeVisible();
  await expect(page.getByText("已看", { exact: true })).toBeVisible();

  // 上一文件→回到第 1 个；返回本地修改→选择恢复。
  await page.getByRole("button", { name: "上一个文件" }).click();
  await expect(page.getByText("第 1/2 个")).toBeVisible();
  await page.getByRole("button", { name: "更多操作" }).click();
  await page.getByRole("menuitem", { name: "返回本地修改" }).click();
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();
});
