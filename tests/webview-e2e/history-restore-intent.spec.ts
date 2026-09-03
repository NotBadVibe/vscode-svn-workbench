import { expect, test } from "@playwright/test";

/*
 * V015-C1 · 历史恢复接入通用意向单。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout 死等。
 * mock 语义：history/preview-restore 下发 restorePreview，
 * history/execute-restore 下发“已恢复为 r42 内容；尚未提交。”反馈；
 * ?historyRestore=blocked 下发不可执行的恢复预览（确认禁用 + 重新检查）。
 */
test("V015-C1：历史恢复走意向单全路径（预览→确认→执行反馈）", async ({
  page,
}) => {
  await page.goto("/?module=history");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();

  // 第 1 步：从当前选中修订生成恢复预览，新 token 到达即自动打开意向单。
  await page.getByRole("button", { name: "从此修订恢复" }).click();
  const dialog = page.getByRole("dialog", { name: "历史恢复 1 个文件" });
  await expect(dialog).toBeVisible();

  // 第 2 步：九要素渲染（动作/数量/范围/修订/清单/命令/可恢复性，无阻止项）。
  await expect(dialog.getByText("历史恢复 1 个文件").first()).toBeVisible();
  await expect(dialog.getByText("影响 1 个路径")).toBeVisible();
  await expect(dialog.getByText("范围：")).toBeVisible();
  await expect(dialog.getByText("src/extension.ts").first()).toBeVisible();
  await expect(dialog.getByText("修订版本：")).toBeVisible();
  await expect(dialog.getByText("可恢复性：")).toBeVisible();
  await expect(dialog.getByText(/原内容不可自动恢复/)).toBeVisible();
  // 命令在折叠区内：展开后断言（与既有意向单一致）。
  await dialog.getByText(/查看将执行的命令/).click();
  await expect(dialog.getByText(/svn cat -r 42/)).toBeVisible();

  // 第 3 步：确认标签带数量，点击后透传 token 执行并看到结果与下一步。
  const confirm = dialog.getByRole("button", { name: "确认覆盖 1 个文件" });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/已恢复为 r42 内容；尚未提交/)).toBeVisible();
});

test("V015-C1：不可执行的恢复预览确认禁用，重新检查透传重新预览", async ({
  page,
}) => {
  await page.goto("/?module=history&historyRestore=blocked");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();

  await page.getByRole("button", { name: "从此修订恢复" }).click();
  const dialog = page.getByRole("dialog", { name: "历史恢复 1 个文件" });
  await expect(dialog).toBeVisible();

  // 阻止项展示，确认禁用。
  await expect(
    dialog.getByText("工作副本文件已变化，请重新检查后恢复。"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "确认覆盖 1 个文件" }),
  ).toBeDisabled();

  // 重新检查：关闭当前意向单并透传 history/preview-restore（mock 回同 token，
  // 不自动重开，避免旧意向单复用）。
  await dialog.getByRole("button", { name: "重新检查" }).click();
  await expect(dialog).toBeHidden();
});
