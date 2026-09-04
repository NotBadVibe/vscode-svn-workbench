import { expect, test } from "@playwright/test";

/*
 * V016-F2(2) · 主动展开完整回执（Commit + Conflicts）。
 * 展开「需要帮助」→模型动作→外发说明出现→回执卡完整
 * （模型/数据类型/范围/预算/不会发送项）→放弃回执→草稿保留。
 * 只改测试；不动业务源码与 mock 旧语义。全程确定性写法。
 */

test("V016-F2(2a)：Commit 主动展开回执完整后放弃，提交说明草稿保留", async ({
  page,
}) => {
  await page.goto("/?module=commit");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();

  // 先手写草稿（用于放弃后保留断言）。
  const messageBox = page.getByRole("textbox", { name: "提交说明" });
  await messageBox.fill("fix(workbench): 人工草稿保留验证");

  // 展开「需要帮助」→选择含差异模式→外发说明出现。
  await page.getByRole("button", { name: "需要帮助" }).click();
  await page.getByLabel("生成输入模式").selectOption("limited-diff");
  await expect(
    page.getByText(/受限差异模式：生成前会先展示外发回执/),
  ).toBeVisible();

  // 模型动作：生成建议草稿（先下发回执，不调用模型）。
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  const receiptRegion = page.getByRole("region", {
    name: "受限差异外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("受限差异外发回执（尚未发送）"),
  ).toBeVisible();

  // 回执卡完整：模型 / 数据类型 / 范围 / 预算 / 不会发送项。
  await expect(
    receiptRegion.getByText("提交说明（commit-draft）"),
  ).toBeVisible();
  await expect(receiptRegion.getByText("deepseek-v4-flash")).toBeVisible();
  await expect(
    receiptRegion.getByText("项目内相对路径、SVN 状态、脱敏差异片段"),
  ).toBeVisible();
  await expect(receiptRegion.getByText("单文件 6000 字符")).toBeVisible();
  await expect(receiptRegion.getByText("总计 40000 字符")).toBeVisible();
  await expect(
    receiptRegion.getByText(/本地绝对路径（只发送项目内相对路径）/),
  ).toBeVisible();
  await expect(
    receiptRegion.getByText(/API 密钥、SVN 凭据与证书私密材料/),
  ).toBeVisible();
  await expect(
    receiptRegion.getByText(/数据保留策略由模型服务商策略决定/),
  ).toBeVisible();

  // 放弃回执：回执清除、未生成建议、草稿保留（放弃反馈位于折叠区内，展开后可达）。
  await receiptRegion.getByRole("button", { name: "放弃" }).click();
  await expect(receiptRegion).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).toHaveCount(0);
  await page.locator("summary", { hasText: "完整文件选择与策略" }).click();
  await expect(
    page.getByText("已放弃受限差异回执；未发送任何差异内容。"),
  ).toBeVisible();
  await expect(messageBox).toHaveValue("fix(workbench): 人工草稿保留验证");
});

test("V016-F2(2b)：Conflicts 主动展开回执完整后放弃，合并草稿保留", async ({
  page,
}) => {
  await page.goto("/?module=conflicts");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await expect(page.getByTestId("conflict-role-bar")).toBeVisible();

  // 先产生合并草稿（用于放弃后保留断言）。
  await page.getByRole("button", { name: "采用我的修改" }).first().click();
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible();

  // 展开「需要帮助」→模型动作（解释冲突意图）→回执卡出现。
  await page.getByRole("button", { name: "需要帮助" }).click();
  await page.getByRole("button", { name: "解释冲突意图" }).click();
  const receiptRegion = page.getByRole("region", {
    name: "冲突意图解释回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("冲突意图解释回执（尚未发送）"),
  ).toBeVisible();

  // 回执卡完整：模型 / 数据类型 / 范围 / 预算 / 不会发送项。
  await expect(
    receiptRegion.getByText("冲突意图解释（conflict-interpret）"),
  ).toBeVisible();
  await expect(receiptRegion.getByText("deepseek-v4-flash")).toBeVisible();
  await expect(
    receiptRegion.getByText("冲突文件受限正文（base/mine/theirs/working）"),
  ).toBeVisible();
  await expect(receiptRegion.getByText("4 个冲突正文")).toBeVisible();
  await expect(receiptRegion.getByText("单文件 8000 字符")).toBeVisible();
  await expect(receiptRegion.getByText("总计 32000 字符")).toBeVisible();
  await expect(
    receiptRegion.getByText(/本地绝对路径（只发送项目内相对路径）/),
  ).toBeVisible();
  await expect(receiptRegion.getByText(/范围外文件内容/)).toBeVisible();
  await expect(
    receiptRegion.getByText(/数据保留策略由模型服务商策略决定/),
  ).toBeVisible();

  // 放弃回执：回执清除、未生成意图解释、合并草稿保留（复制/导出仍可用）。
  await receiptRegion.getByRole("button", { name: "放弃" }).click();
  await expect(receiptRegion).toHaveCount(0);
  await expect(page.getByText("我的版本调整了工作台入口")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复制草稿" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导出草稿" })).toBeEnabled();
});
