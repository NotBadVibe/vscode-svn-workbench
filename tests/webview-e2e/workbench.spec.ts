import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openModule } from "./navigation";

test("opens the mock changes workspace and navigates to diff", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await expect(
    page.locator(".path-cell__name", { hasText: "extension.ts" }),
  ).toBeVisible();

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
  await openModule(page, "提交");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  await expect(page.getByText("外发预览").first()).toBeVisible();
  await expect(page.getByText(/不发送文件正文/).first()).toBeVisible();
  await page.getByRole("button", { name: "AI 生成说明" }).click();
  await expect(page.getByRole("textbox", { name: "提交说明" })).toHaveValue(
    "feat(workbench): 迁移统一 Svelte UI",
  );
  await page.getByRole("button", { name: /生成提交预览/ }).click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  await expect(page.getByRole("button", { name: /确认提交/ })).toBeEnabled();
});

test("keeps AI file selection advisory and user-editable", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "获取 AI 建议" }).click();
  await expect(
    page.getByText("建议选择 1 个文件；1 个需要人工确认，1 个建议排除。"),
  ).toBeVisible();
  await expect(page.getByText(/来源：已配置模型/)).toBeVisible();
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(
    page.getByLabel("选择 src/webview/App.svelte"),
  ).not.toBeChecked();
  await page.getByLabel("选择 src/webview/App.svelte").check();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();
});

test("offers 配置 AI entry instead of an AI-labelled action when unconfigured", async ({
  page,
}) => {
  await page.goto("/?commitAi=none");
  await openModule(page, "提交");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  // 未配置 AI 时不再把本地规则称为 AI 建议。
  await expect(
    page.getByRole("button", { name: /AI 建议选择/ }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "获取 AI 建议" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "应用本地规则" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "配置 AI" }).click();
  await expect(page.getByRole("tab", { name: "AI 模型" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("applies local rules with Chinese feedback", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "应用本地规则" }).click();
  await expect(
    page.getByText(
      "已按本地规则应用推荐选择 2 个文件；1 个文件待确认，可手动勾选。",
    ),
  ).toBeVisible();
});

test("keeps the current selection and offers local-rule recovery when AI fails", async ({
  page,
}) => {
  await page.goto("/?commitAi=fail");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "获取 AI 建议" }).click();
  await expect(
    page.getByText("AI 建议获取失败，已保留当前选择。"),
  ).toBeVisible();
  await expect(page.getByText(/失败原因：/)).toBeVisible();
  // 当前选择保留，未被失败结果替换。
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();

  await page.getByRole("button", { name: "应用本地规则" }).last().click();
  await expect(
    page.getByText(
      "已按本地规则应用推荐选择 2 个文件；1 个文件待确认，可手动勾选。",
    ),
  ).toBeVisible();
});

test("marks stale AI results as view-only", async ({ page }) => {
  await page.goto("/?commitAi=stale");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "获取 AI 建议" }).click();
  await expect(page.getByText(/结果已过期/)).toBeVisible();
  await expect(
    page.getByText(/只能查看，不能直接采用；请重新获取 AI 建议。/),
  ).toBeVisible();
});

test("shows the rules-updated notice after selection rules change", async ({
  page,
}) => {
  await page.goto("/?commitRules=updated");
  await openModule(page, "提交");
  await expect(
    page.getByText(
      "提交选择规则已更新，候选分类已按新规则刷新；可点击“应用本地规则”重新计算推荐选择。",
    ),
  ).toBeVisible();
});

test("compares two revisions inside the unified workbench", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "历史");
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
  await openModule(page, "冲突");
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
  await openModule(page, "设置");
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
  await openModule(page, "诊断");
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
  await openModule(page, "仓库操作");
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
  await openModule(page, "AI 审查");
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
  await openModule(page, "影响分析");
  await expect(
    page.getByRole("heading", { name: "影响与测试建议" }),
  ).toBeVisible();
  await expect(page.getByText("npm run test:webview")).toBeVisible();
});

test("turns a split suggestion into a previewed SVN changelist", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "变更集");
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
  await openModule(page, "任务代理");
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
  const row = page.locator(".file-row").filter({ hasText: "debug.log" });
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
  const row = page.locator(".file-row").filter({ hasText: "extension.ts" });
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
  await openModule(page, "历史");
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
  await openModule(page, "仓库操作");
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
  await openModule(page, "仓库操作");
  await page.getByRole("button", { name: "清理与恢复", exact: true }).click();
  await page.getByRole("button", { name: "生成清理预览" }).click();
  await expect(page.getByText('svn cleanup "."')).toBeVisible();
  await page.getByRole("button", { name: "确认清理工作副本" }).click();
  await expect(
    page.getByText("清理已完成；未删除未版本化文件，请重新检查状态。"),
  ).toBeVisible();
});

test("edits commit selection rules with local preview and host save", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await expect(page.getByText("规则来源与覆盖关系")).toBeVisible();
  await expect(page.getByRole("heading", { name: "用户默认" })).toBeVisible();
  await expect(page.getByText(/当前仓库（本页编辑）/)).toBeVisible();
  // 来源与决策以文字表达，不只靠颜色
  await expect(page.getByText("内置默认").first()).toBeVisible();
  await expect(
    page.getByText("已应用：1 条状态策略 · 1 条路径规则"),
  ).toBeVisible();
  await expect(page.getByLabel("文件缺失的默认决策")).toBeVisible();
  await expect(page.getByText("不可配置的状态")).toBeVisible();

  const preview = page.getByRole("region", { name: "提交选择规则预览结果" });
  const fixtureRow = preview.locator(".selection-preview-row", {
    hasText: "tests/fixtures/case.ts",
  });
  await expect(fixtureRow).toContainText("需要确认");
  await expect(fixtureRow).toContainText("team-fixtures");
  const extensionRow = preview.locator(".selection-preview-row", {
    hasText: "src/extension.ts",
  });
  await expect(extensionRow).toContainText("推荐提交");

  // 新增并编辑规则：预览在 debounce 后本地重算，命中规则与决策随之变化
  await page.getByRole("button", { name: "新增规则" }).click();
  await page.getByLabel("规则 ID").nth(1).fill("team-src");
  await page.getByLabel("Glob 表达式").nth(1).fill("src/**");
  await page.getByLabel("中文原因").nth(1).fill("源码目录统一复核");
  await expect(extensionRow).toContainText("team-src", { timeout: 3000 });
  await expect(extensionRow).toContainText("需要确认");
  await page.getByLabel("规则 team-src 的决策").selectOption("excluded");
  await expect(extensionRow).toContainText("排除", { timeout: 3000 });

  // 保存经 Host 校验后返回成功反馈
  await page.getByRole("button", { name: "保存当前仓库规则" }).click();
  await expect(
    page.getByText(/提交选择规则已保存到 .svn-workbench.json/),
  ).toBeVisible();
});

test("shows selection shadow, broken-config, empty and no-repo states", async ({
  page,
}) => {
  await page.goto("/?selection=shadowed");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await expect(page.getByText(/永远不会命中/)).toBeVisible();

  await page.goto("/?selection=corrupt");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await expect(page.getByText("校验失败，已忽略该层配置")).toBeVisible();
  await expect(page.getByText(/仓库层配置解析失败/)).toBeVisible();

  await page.goto("/?selection=no-candidates");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await expect(page.getByText(/当前仓库没有可预览的候选文件/)).toBeVisible();

  await page.goto("/?selection=no-repo");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await expect(page.getByText(/无法生成规则预览/)).toBeVisible();
});

test("rejects saving invalid selection rules with structured feedback", async ({
  page,
}) => {
  await page.goto("/?selection=save-error");
  await openModule(page, "设置");
  await page.getByRole("tab", { name: "提交选择规则" }).click();
  await page.getByRole("button", { name: "保存当前仓库规则" }).click();
  await expect(page.getByText(/模拟写入错误/)).toBeVisible();
  await expect(
    page.getByText("模拟保存失败：无法写入 .svn-workbench.json。"),
  ).toBeVisible();
});

test("edits a working copy in-page and saves with Ctrl+S (v0.0.6)", async ({
  page,
}) => {
  await page.goto("/?module=diff");
  await expect(page.getByRole("button", { name: "页内编辑" })).toBeVisible();
  await page.getByRole("button", { name: "页内编辑" }).click();
  await expect(page.getByText("编辑模式")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();

  // 真实点击编辑区并输入，触发脏状态。
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  // 编辑器焦点接管是异步的：确认焦点已进入编辑区再输入，避免竞态丢键。
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 页内编辑注释");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await expect(page.getByRole("button", { name: "保存修改" })).toBeEnabled();

  // Ctrl+S 保存：mock 返回成功并刷新快照。
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
});

/** 在 mock 模式直接派发一条 Webview 动作（等同界面触发 open-diff）。 */
async function dispatchMockAction(
  page: import("@playwright/test").Page,
  action: string,
  data: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ({ action: name, data: payload }) => {
      window.dispatchEvent(
        new CustomEvent("svn-workbench:mock-action", {
          detail: {
            protocolVersion: 2,
            type: "workbench/action",
            moduleId: "diff",
            taskId: "diff/working",
            sessionId: "mock-session-id",
            repositoryUuid: "mock-repository-uuid",
            scopeHash: "mock-scope-hash",
            payload: { action: name, data: payload },
          },
        }),
      );
    },
    { action, data },
  );
}

test("dirty draft target switch requires an explicit three-way choice (v0.0.6)", async ({
  page,
}) => {
  await page.goto("/?module=diff");
  await page.getByRole("button", { name: "页内编辑" }).click();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 未保存草稿");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  // 等草稿检查点（debounce 800ms）到达 mock Host，保证暂存后草稿可恢复。
  await page.waitForTimeout(1000);

  // 加载新目标：必须先三选一，不能静默暂存。
  await dispatchMockAction(page, "open-diff", {
    relativePath: "src/webview/App.svelte",
  });
  const dialog = page.getByRole("dialog", { name: "当前文件有未保存的草稿" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "保存并打开新文件" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "暂存并打开新文件" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "留在当前文件" }),
  ).toBeVisible();
  // 对话框打开期间仍停留在原文件。
  await expect(page.getByText("src/extension.ts").first()).toBeVisible();

  // 留在当前文件：不切换。
  await dialog.getByRole("button", { name: "留在当前文件" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("编辑模式")).toBeVisible();

  // 再次触发并选择暂存并打开：切换到新文件，草稿保留。
  await dispatchMockAction(page, "open-diff", {
    relativePath: "src/webview/App.svelte",
  });
  await page
    .getByRole("dialog", { name: "当前文件有未保存的草稿" })
    .getByRole("button", { name: "暂存并打开新文件" })
    .click();
  await expect(page.getByText("src/webview/App.svelte").first()).toBeVisible();

  // 回到原文件：草稿仍在，提供恢复入口（暂存不丢草稿）。
  await dispatchMockAction(page, "open-diff", {
    relativePath: "src/extension.ts",
  });
  await expect(
    page.getByRole("button", { name: "恢复草稿并编辑" }),
  ).toBeVisible();
});

test("saved working copy becomes clean: no draft notice, no switch dialog (v0.0.6)", async ({
  page,
}) => {
  await page.goto("/?module=diff");
  await page.getByRole("button", { name: "页内编辑" }).click();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 保存后应变干净");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
  // 保存成功：不再提示未保存草稿。
  await expect(page.getByText(/存在未保存草稿/)).toHaveCount(0);
  await expect(page.getByText(/有未保存的修改/)).toHaveCount(0);

  // 切换目标：干净状态不弹三选一，直接加载新文件。
  await dispatchMockAction(page, "open-diff", {
    relativePath: "src/webview/App.svelte",
  });
  await expect(page.getByText("src/webview/App.svelte").first()).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "当前文件有未保存的草稿" }),
  ).toHaveCount(0);
});

test("consecutive saves carry the rotated token and hash (v0.0.6 regression)", async ({
  page,
}) => {
  await page.goto("/?module=diff");
  await page.getByRole("button", { name: "页内编辑" }).click();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  await expect(editable).toBeFocused();

  // 第一次编辑并保存：成功且提示消失。
  await page.keyboard.type("// 第一次保存");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();

  // 第二次真实编辑并保存：mock Host 校验 editToken/expectedContentHash，
  // 携带旧基准会得到 diskChanged 拒绝——这里必须成功。
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 第二次保存");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/保存被拒绝/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();
});
