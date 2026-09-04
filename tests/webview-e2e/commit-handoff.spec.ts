import { expect, test } from "@playwright/test";
import { openModule } from "./navigation";

/*
 * V014-E2 · Changes → Commit 交接显示（`?commitHandoff=` mock 演示载荷）。
 * 覆盖：交接后摘要条来源行 + 带入数量、移除原因播报、D 紧凑语义保持
 * （不重复选择控制台）、范围未扩大可见、冲突指引入口与旧预览空态。
 */
test("V014-E2：Changes→Commit 交接后显示来源行且不重复选择控制台", async ({
  page,
}) => {
  // 从本地修改进入，携带交接演示载荷后打开提交模块。
  await page.goto("/?module=changes&commitHandoff=shrunk");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await openModule(page, "提交");

  // 交接来源行：来自本地修改 + 范围未扩大 + 带入数量（kept/请求）。
  const summary = page.getByRole("region", { name: "待提交文件摘要" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("来自本地修改，范围未扩大")).toBeVisible();
  await expect(summary.getByText(/已带入 2 个文件/)).toBeVisible();
  await expect(summary.getByText(/共请求 3 个/)).toBeVisible();

  // 移除原因逐条可播报（role=status），原因有文字标签（不只靠颜色）。
  const removed = page.getByRole("status", { name: "交接时移除的文件" });
  await expect(removed).toBeVisible();
  await expect(removed).toContainText("“dist/out.js”已变为排除项");
  await expect(removed).toContainText("已排除");

  // D 紧凑语义保持：完整文件选择收进按需展开区，不重复展示同等重量的控制台。
  await expect(
    page.locator("details.commit-compact-details--files"),
  ).toBeVisible();
  await expect(
    page.locator("details.commit-compact-details--files[open]"),
  ).toHaveCount(0);
  // V016-C：AI 折叠区已迁移进 AssistancePanel（region），不再是 details。
  await expect(
    page.getByRole("region", { name: "提交说明帮助" }),
  ).toBeVisible();
  // 唯一主操作：首屏只有一个 primary（新预览入口）。
  await expect(page.locator(".commit-compact .button--primary")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /预览提交 \d+ 个文件/ }),
  ).toBeVisible();
});

test("V014-E2：冲突交接显示处理冲突入口且旧预览保持空态", async ({ page }) => {
  await page.goto("/?module=commit&commitHandoff=conflict");

  // 冲突指引次级入口位于摘要条内。
  const summary = page.getByRole("region", { name: "待提交文件摘要" });
  await expect(summary).toBeVisible();
  const entry = summary.getByRole("button", { name: "处理冲突" });
  await expect(entry).toBeVisible();
  await expect(entry).not.toHaveClass(/button--primary/);

  // 旧 preview 已置空：不渲染旧预览主操作（确认提交），只剩新预览入口。
  await expect(page.getByRole("button", { name: /确认提交/ })).toHaveCount(0);
  await expect(page.locator(".commit-compact .button--primary")).toHaveCount(1);

  // 次级入口直达冲突模块（范围不变）。
  await entry.click();
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
});
