import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("opens the mock changes workspace and navigates to diff", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await expect(page.getByText("src/extension.ts")).toBeVisible();

  await page
    .getByRole("button", { name: "查看 src/extension.ts 差异" })
    .click();
  await expect(
    page.getByRole("heading", { name: "查看本地修改" }),
  ).toBeVisible();
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
});

test("has no automatically detectable accessibility violations on changes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("previews a commit before enabling execution", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  await expect(page.getByText("外发预览").first()).toBeVisible();
  await expect(page.getByText(/不发送文件正文/).first()).toBeVisible();
  await page.getByRole("button", { name: "AI 生成说明" }).click();
  await expect(page.getByRole("textbox", { name: "提交说明" })).toHaveValue(
    "feat(workbench): 迁移统一 Svelte UI",
  );
  await page.getByRole("button", { name: "生成提交预览" }).click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认提交" })).toBeEnabled();
});

test("keeps AI file selection advisory and user-editable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "提交", exact: true }).click();
  await page.getByRole("button", { name: "AI 建议选择" }).click();
  await expect(
    page.getByText("建议选择 1 个文件；1 个需要人工确认，1 个建议排除。"),
  ).toBeVisible();
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(
    page.getByLabel("选择 src/webview/App.svelte"),
  ).not.toBeChecked();
  await page.getByLabel("选择 src/webview/App.svelte").check();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();
});

test("compares two revisions inside the unified workbench", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "历史" }).click();
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();
  await page.getByLabel("选择修订 42 进行比较").click();
  await page.getByLabel("选择修订 41 进行比较").click();
  await page.getByRole("button", { name: "比较修订" }).click();
  await expect(page.getByText("修订比较 r41 → r42")).toBeVisible();
});

test("keeps conflict advice separate from explicit resolve", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "冲突", exact: true }).click();
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await expect(page.getByText(/点击“AI 分析”后才会发送/)).toBeVisible();
  await page.getByRole("button", { name: "AI 分析" }).click();
  await expect(page.getByText("两侧都修改了同一处行为")).toBeVisible();
  await page.getByRole("button", { name: "生成解决预览" }).click();
  await expect(
    page.getByRole("button", { name: "确认使用当前工作副本内容并标记解决" }),
  ).toBeEnabled();
});

test("opens Svelte settings without exposing the stored API key", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置与团队规范" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "API 密钥", exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "测试连接" }).click();
  await expect(page.getByText("连接成功，模型返回了有效响应。")).toBeVisible();
  await page.getByRole("tab", { name: "团队提交规范" }).click();
  await page.getByRole("button", { name: "AI 推荐" }).click();
  await expect(
    page.getByText("已根据仓库目录生成团队规则建议。"),
  ).toBeVisible();
});

test("shows environment diagnostics and expandable acceptance evidence", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "诊断", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "环境诊断", exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "验收清单" }).click();
  await page.getByRole("button", { name: "核心流程" }).click();
  await expect(page.getByText("确认安全提交链路。")).toBeVisible();
});

test("requires an update preview before running svn update", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "仓库操作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "更新当前范围" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成更新预览" }).click();
  await expect(page.getByText("中风险")).toBeVisible();
  await page.getByRole("button", { name: "确认更新当前范围" }).click();
  await expect(page.getByText("已更新到 r43")).toBeVisible();
});

test("shows review evidence without rendering sensitive values", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "AI 审查", exact: true }).click();
  await expect(
    page
      .locator(".intelligence-page")
      .getByRole("heading", { name: "AI 变更审查" }),
  ).toBeVisible();
  await expect(page.getByText("src/config.ts:8")).toBeVisible();
  await expect(page.getByText("检测到疑似凭据，具体值已隐藏。")).toBeVisible();
});

test("links impact areas to concrete test commands", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "影响分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "影响与测试建议" }),
  ).toBeVisible();
  await expect(page.getByText("npm run test:webview")).toBeVisible();
});

test("turns a split suggestion into a previewed SVN changelist", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .locator(".rail")
    .getByRole("button", { name: "变更集", exact: true })
    .click();
  await page.getByRole("button", { name: "生成拆分建议" }).click();
  await page.getByRole("button", { name: "套用并调整" }).click();
  await page.getByRole("button", { name: "生成应用预览" }).click();
  await expect(page.getByText('svn changelist "webview" …')).toBeVisible();
  await page.getByRole("button", { name: "确认应用变更集" }).click();
  await expect(page.getByText("文件已加入 webview。")).toBeVisible();
});

test("runs the agent plan only through explicit step approvals", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "任务代理", exact: true }).click();
  await page
    .getByRole("textbox", { name: "任务目标" })
    .fill("检查当前范围并形成测试建议");
  await page.getByRole("button", { name: "生成受控计划" }).click();
  for (let index = 0; index < 3; index += 1)
    await page.getByRole("button", { name: "批准此步" }).first().click();
  await expect(
    page.getByText(
      "受控分析计划已完成，可以进入审查、影响或提交模块继续操作。",
    ),
  ).toBeVisible();
});

test("uses an accessible Svelte context menu and explicit file-operation preview", async ({
  page,
}) => {
  await page.goto("/");
  const row = page.locator(".file-row").filter({ hasText: "dist/debug.log" });
  await row.click({ button: "right" });
  await expect(
    page.getByRole("menu", { name: "dist/debug.log 操作菜单" }),
  ).toBeVisible();
  await page.getByText("加入版本控制", { exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "SVN 文件操作预览" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认加入版本控制" }).click();
  await expect(
    page.getByText("1 个文件已加入版本控制。请刷新并确认最新 SVN 状态。"),
  ).toBeVisible();
});

test("supports keyboard navigation and dismissal in the Svelte context menu", async ({
  page,
}) => {
  await page.goto("/");
  const row = page.locator(".file-row").filter({ hasText: "src/extension.ts" });
  await row.click({ button: "right" });
  const menu = page.getByRole("menu", { name: "src/extension.ts 操作菜单" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await row.click({ button: "right" });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
});

test("requires explicit confirmation when restoring a file revision", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "历史", exact: true }).click();
  await page.getByRole("button", { name: "查看逐行责任" }).click();
  await expect(page.getByLabel("文件逐行责任")).toContainText("yangnan");
  await page.getByRole("button", { name: "从此修订恢复" }).click();
  await expect(
    page.getByRole("dialog", { name: "修订恢复预览" }),
  ).toContainText("不会自动提交");
  await page.getByRole("button", { name: "确认覆盖工作副本文件" }).click();
  await expect(
    page.getByText("src/extension.ts 已恢复为 r42 内容；尚未提交。"),
  ).toBeVisible();
});

test("previews SVN property changes before applying them", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "仓库操作" }).click();
  await page.getByRole("button", { name: "SVN 属性", exact: true }).click();
  await page.getByRole("button", { name: /svn:ignore/ }).click();
  await page.getByRole("button", { name: "预览设置" }).click();
  await expect(
    page.getByText('svn propset "svn:ignore" <value> "."'),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认设置属性" }).click();
  await expect(
    page.getByText("已设置属性 svn:ignore；变更尚未提交。"),
  ).toBeVisible();
});

test("makes working-copy cleanup an explicit non-destructive confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "仓库操作" }).click();
  await page.getByRole("button", { name: "清理与恢复", exact: true }).click();
  await page.getByRole("button", { name: "生成清理预览" }).click();
  await expect(page.getByText('svn cleanup "."')).toBeVisible();
  await page.getByRole("button", { name: "确认清理工作副本" }).click();
  await expect(
    page.getByText("清理已完成；未删除未版本化文件，请重新检查状态。"),
  ).toBeVisible();
});
