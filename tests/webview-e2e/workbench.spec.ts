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

test("v0.1.0 差异主路径：X/Y 导航、键盘一致、显示设置与连续保存", async ({
  page,
}) => {
  await page.goto("/?module=diff");
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();

  // 统一工具区：变更块 X/Y 指示 + 上一处/下一处按钮。
  await expect(page.getByText("变更块 1/3")).toBeVisible();
  await page.getByRole("button", { name: "下一处差异" }).click();
  await expect(page.getByText("变更块 2/3")).toBeVisible();

  // 到达末尾的非阻塞反馈（不环绕）。
  await page.getByRole("button", { name: "下一处差异" }).click();
  await page.getByRole("button", { name: "下一处差异" }).click();
  await expect(page.getByText("已经是最后一处差异")).toBeVisible();

  // 键盘 Alt+↑ 与按钮行为一致。
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByText("变更块 2/3")).toBeVisible();

  // 显示设置聚合视图开关：切换统一视图不改变文件目标与内容。
  await page.getByRole("button", { name: "显示设置" }).click();
  await page.getByRole("radio", { name: "统一视图" }).click();
  await expect(page.getByText("src/extension.ts").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "差异显示设置" })).toHaveCount(
    0,
  );

  // 进入编辑：统一视图不支持页内编辑（pierre 1.3.4 受限能力），临时切回
  // 分栏并明确告知；回到审阅后恢复统一视图。
  await page.getByRole("button", { name: "页内编辑" }).click();
  await expect(page.getByText("正在编辑工作副本")).toBeVisible();
  await expect(page.getByText(/已临时切换为分栏视图/)).toBeVisible();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 第一轮");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/已于 .* 保存到工作副本/)).toBeVisible();
  await page.keyboard.type("// 第二轮");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeEnabled();

  // 回到审阅：退出编辑态（不反弹）并恢复进入前的统一视图偏好。
  await page.getByRole("button", { name: "回到审阅" }).click();
  await expect(page.getByText("正在编辑工作副本")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "页内编辑" })).toBeVisible();
  await page.getByRole("button", { name: "显示设置" }).click();
  await expect(page.getByRole("radio", { name: "统一视图" })).toBeChecked();
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
  // V014-D：提交说明旁的外发预览保留在首屏（选择场景的说明收进折叠区）。
  await expect(page.getByText(/最多 80 个文件/)).toBeVisible();
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  // v0.0.9 §4：建议只进入建议区，不覆盖用户已填提交说明。
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).toBeVisible();
  await expect(page.getByText("建议草稿（不覆盖当前提交说明）")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "提交说明" })).toHaveValue("");
  // V014-D：无预览时唯一主操作改名“预览提交 N 个文件”。
  await page.getByRole("button", { name: /预览提交/ }).click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  await expect(page.getByRole("button", { name: /确认提交/ })).toBeEnabled();
});

test("suggestion draft replace flow shows char count and undoes (v0.0.9 §4)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  const suggestionRegion = page.getByRole("region", {
    name: "提交说明建议草稿",
  });
  await expect(suggestionRegion).toBeVisible();
  await expect(
    suggestionRegion.getByText(/生成输入仅包含文件信息与差异统计/),
  ).toBeVisible();

  // 替换按钮显示建议字符数；确认框写明前后字符数后确认替换。
  await suggestionRegion
    .getByRole("button", { name: /替换草稿（\d+ 字符）/ })
    .click();
  const confirm = page.getByRole("alertdialog", {
    name: "确认替换提交说明",
  });
  await expect(confirm.getByText(/当前 0 字符/)).toBeVisible();
  await confirm.getByRole("button", { name: /确认替换（\d+ 字符）/ }).click();
  await expect(page.getByRole("textbox", { name: "提交说明" })).not.toHaveValue(
    "",
  );
  await expect(page.getByRole("button", { name: "撤销替换" })).toBeVisible();

  // 撤销替换恢复原草稿（空）。
  await page.getByRole("button", { name: "撤销替换" }).click();
  await expect(page.getByRole("textbox", { name: "提交说明" })).toHaveValue("");
});

test("limited-diff receipt flow: preview then confirm generation (v0.0.11 §3)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "提交");
  // 选择受限差异模式：先展示外发回执，不调用模型。
  await page.getByLabel("生成输入模式").selectOption("limited-diff");
  await expect(
    page.getByText(/受限差异模式：生成前会先展示外发回执/),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成建议草稿" }).click();

  const receiptRegion = page.getByRole("region", {
    name: "受限差异外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("受限差异外发回执（尚未发送）"),
  ).toBeVisible();
  await expect(
    receiptRegion.getByText("提交说明（commit-draft）"),
  ).toBeVisible();
  await expect(receiptRegion.getByText("单文件 6000 字符")).toBeVisible();
  await expect(receiptRegion.getByText("已分析 1")).toBeVisible();
  await expect(receiptRegion.getByText("截断 1")).toBeVisible();
  await expect(receiptRegion.getByText("预算外 0")).toBeVisible();
  await expect(
    receiptRegion.getByText(/数据保留策略由模型服务商策略决定/),
  ).toBeVisible();
  // 确认前不生成建议。
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).not.toBeVisible();

  // 展开包含 / 排除文件清单。
  await receiptRegion
    .getByRole("button", { name: "展开包含 / 排除文件清单" })
    .click();
  await expect(
    receiptRegion.getByText("src/webview/app/FeatureRouter.svelte"),
  ).toBeVisible();

  // 确认后生成带证据与覆盖率的建议。
  await receiptRegion.getByRole("button", { name: "开始模型生成" }).click();
  const suggestionRegion = page.getByRole("region", {
    name: "提交说明建议草稿",
  });
  await expect(suggestionRegion).toBeVisible();
  await expect(
    suggestionRegion.getByText("差异覆盖率：已分析 1"),
  ).toBeVisible();
  await expect(
    suggestionRegion.getByText("证据引用（1 条有效）"),
  ).toBeVisible();
  // §5：逐条说明展示状态与证据。
  await expect(suggestionRegion.getByText("逐条说明与证据状态")).toBeVisible();
  await expect(suggestionRegion.getByText("已证实")).toBeVisible();
  // 回执面板在生成后清除。
  await expect(receiptRegion).not.toBeVisible();
});

test("limited-diff receipt can be dismissed without sending (v0.0.11 §3)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByLabel("生成输入模式").selectOption("limited-diff");
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  const receiptRegion = page.getByRole("region", {
    name: "受限差异外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await receiptRegion.getByRole("button", { name: "放弃" }).click();
  await expect(receiptRegion).not.toBeVisible();
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).not.toBeVisible();
});

test("validated evidence opens the file diff (v0.0.11 §4)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByLabel("生成输入模式").selectOption("limited-diff");
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  const receiptRegion = page.getByRole("region", {
    name: "受限差异外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始模型生成" }).click();
  const suggestionRegion = page.getByRole("region", {
    name: "提交说明建议草稿",
  });
  await expect(suggestionRegion).toBeVisible();
  // 有效证据提供“打开差异”入口，点击进入该文件差异视图。
  await suggestionRegion
    .getByRole("button", { name: "打开差异" })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "查看本地修改" }),
  ).toBeVisible();
});

test("partial completion retries only failed items (v0.0.11 §6)", async ({
  page,
}) => {
  // commitMessage=partial：mock 建议包含读取失败项，展示“重试失败项”。
  await page.goto("/?commitMessage=partial");
  await openModule(page, "提交");
  await page.getByLabel("生成输入模式").selectOption("limited-diff");
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  const receiptRegion = page.getByRole("region", {
    name: "受限差异外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始模型生成" }).click();
  const suggestionRegion = page.getByRole("region", {
    name: "提交说明建议草稿",
  });
  await expect(suggestionRegion).toBeVisible();
  // 逐文件覆盖情况列出失败项，提供重试入口。
  await expect(
    suggestionRegion.getByText("逐文件覆盖情况（3 个候选）"),
  ).toBeVisible();
  // §5：partial 场景的待确认声明可见。
  await expect(suggestionRegion.getByText("待确认")).toBeVisible();
  await suggestionRegion
    .getByRole("button", { name: "重试失败项（1）" })
    .click();
  // 重试同样先展示回执（本次覆盖失败项），再确认生成。
  await expect(receiptRegion).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始模型生成" }).click();
  await expect(suggestionRegion).toBeVisible();
  await expect(
    suggestionRegion.getByText("本次重试仅覆盖上次读取失败或预算外的文件。"),
  ).toBeVisible();
});

test("keeps AI file selection advisory and user-editable", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "提交");
  // V014-D：选择控制台收进按需展开区，先展开再操作。
  await page.getByText("完整文件选择与策略").click();
  await page.getByRole("button", { name: "获取 AI 建议" }).click();
  await expect(
    page.getByText("建议选择 1 个文件；1 个需要人工确认，1 个建议排除。"),
  ).toBeVisible();
  await expect(page.getByText(/来源：模型建议/)).toBeVisible();
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
  // V014-D：选择控制台与规则入口收进按需展开区，先展开再断言。
  await page.getByText("完整文件选择与策略").click();
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
  // V014-D：手动规则入口位于“团队规则详情”按需展开区；
  // 一次性反馈随选择控制台收进“完整文件选择与策略”，断言前展开。
  await page.getByText("团队规则详情").click();
  await page.getByRole("button", { name: "应用本地规则" }).click();
  await page.getByText("完整文件选择与策略").click();
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
  // V014-D：选择控制台（含 AI 建议入口与文件复选框）位于按需展开区；
  // 失败结果到达后 AI 折叠区自动展开。
  await page.getByText("完整文件选择与策略").click();
  await page.getByRole("button", { name: "获取 AI 建议" }).click();
  await expect(
    page.getByText("AI 建议获取失败，已保留当前选择。"),
  ).toBeVisible();
  await expect(page.getByText(/失败原因：/)).toBeVisible();
  // 当前选择保留，未被失败结果替换（文件选择展开区此前已展开）。
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();

  // 恢复动作为 AI 折叠区失败卡片上的“应用本地规则”（ai-recover-button）。
  await page.locator(".ai-recover-button").click();
  await expect(
    page.getByText(
      "已按本地规则应用推荐选择 2 个文件；1 个文件待确认，可手动勾选。",
    ),
  ).toBeVisible();
});

test("marks stale AI results as view-only", async ({ page }) => {
  await page.goto("/?commitAi=stale");
  await openModule(page, "提交");
  // V014-D：AI 入口位于文件选择按需展开区。
  await page.getByText("完整文件选择与策略").click();
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
  // V014-D：规则更新一次性反馈随选择控制台收进按需展开区。
  await page.getByText("完整文件选择与策略").click();
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
  await page.getByRole("button", { name: "比较所选修订" }).click();
  await expect(page.getByText("修订比较 r41 → r42")).toBeVisible();
});

test("keeps conflict advice separate from explicit resolve", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "冲突");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await page.getByText("需要帮助（合并建议与解释）").click();
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
  const acceptanceTab = page.getByRole("tab", { name: "验收清单" });
  if ((await acceptanceTab.count()) > 0) {
    await acceptanceTab.click();
    await page.getByRole("button", { name: "核心流程" }).click();
    await expect(page.getByText("确认安全提交链路。")).toBeVisible();
  } else {
    await expect(acceptanceTab).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "环境检查项目" }),
    ).toBeVisible();
  }
});

test("requires an update preview before running svn update", async ({
  page,
}) => {
  await page.goto("/");
  // v0.0.17 批次 A：更新是独立模块，不再从仓库任务进入。
  await openModule(page, "更新");
  await expect(
    page.getByRole("heading", { name: "更新当前范围" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "生成更新预览" }).click();
  await expect(page.getByText("中风险")).toBeVisible();
  // v0.1.5 V015-B2：预览工具栏已迁入 PrimaryActionBar，主动作含远端数量。
  await page.getByRole("button", { name: "确认更新（2）" }).click();
  const updateDialog = page.getByRole("dialog", {
    name: /更新 (\d+ 个远端变更|当前范围)/,
  });
  await expect(updateDialog).toBeVisible();
  // 标题与摘要均含“远端变更”，此处校验摘要特有字段避免歧义
  await expect(updateDialog.getByText(/重叠风险/)).toBeVisible();
  // 确认按钮数量与标题同源（远端变更数）
  await updateDialog.getByRole("button", { name: /确认更新/ }).click();
  await expect(page.getByText("已更新到 r43")).toBeVisible();
  // v0.0.17 批次 B（U-06）：更新结果页常驻冲突 CTA，直达冲突模块。
  const conflictCta = page.locator("[data-update-conflict-cta]");
  await expect(conflictCta).toBeVisible();
  await expect(conflictCta.getByText("当前范围有 2 个冲突")).toBeVisible();
  // v0.1.5 V015-B2：结果出口已给出处理冲突主动作，冲突栏不再重复同名 primary，全页仅此一个。
  await page.getByRole("button", { name: "处理 2 个冲突" }).click();
  await expect(
    page.getByRole("heading", { name: "处理文件冲突" }),
  ).toBeVisible();
});

test("shows the scope recommendation strip with dismiss (v0.0.17)", async ({
  page,
}) => {
  await page.goto("/");
  // mock 初始 scope 携带“检查建议的 3 个文件”推荐（与 Host 推导规则一致）。
  const strip = page.locator(".recommendation-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByText("检查建议的 3 个文件")).toBeVisible();
  await expect(strip.getByText(/本地修改/)).toBeVisible();
  // 推荐主按钮直达目标模块。
  await strip.getByRole("button", { name: "前往检查并提交" }).click();
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
});

test("recommendation strip can be dismissed and stays dismissed (v0.0.17)", async ({
  page,
}) => {
  await page.goto("/");
  const strip = page.locator(".recommendation-strip");
  await expect(strip).toBeVisible();
  await strip.getByRole("button", { name: "忽略" }).click();
  await expect(strip).toHaveCount(0);
  // 同一推荐（同 key）刷新后不再出现。
  await page
    .getByRole("button", { name: "刷新", exact: false })
    .first()
    .click();
  await expect(page.locator(".recommendation-strip")).toHaveCount(0);
});

test("onboarding guide walks the safe loop and stops before commit (v0.0.18)", async ({
  page,
}) => {
  // mock 环境默认关闭引导；?guide=1 开启（真实 Host 首次进入默认展示）。
  await page.goto("/?guide=1");
  const strip = page.locator(".onboarding-strip");
  // 第 1 步进入工作台即完成，第 2 步看到候选文件即完成。
  await expect(
    strip.getByText(/引导步骤 3\/5：选择建议提交的文件/),
  ).toBeVisible();
  // 第 3 步：按引导说明点击“选择推荐项”（真实交互推进）。
  await page.getByRole("button", { name: "选择推荐项" }).click();
  await expect(
    strip.getByText(/引导步骤 4\/5：查看提交预览与来源说明/),
  ).toBeVisible();
  // 第 4 步：进入提交页生成预览（V014-D：选择推荐项与预览入口分别位于首屏摘要展开区与唯一主操作）。
  await page.getByRole("button", { name: /检查并提交所选/ }).click();
  await page.getByText("完整文件选择与策略").click();
  await page.getByRole("button", { name: /预览提交/ }).click();
  await expect(strip.getByText(/引导步骤 5\/5：最终确认前结束/)).toBeVisible();
  // 最后一步只有完成按钮，不出现任何执行提交的动作。
  const finish = strip.getByRole("button", {
    name: "完成引导（未执行任何提交）",
  });
  await expect(finish).toBeVisible();
  await finish.click();
  // 完成后引导条无痕隐藏。
  await expect(page.locator(".onboarding-strip")).toHaveCount(0);
});

test("history load-more appends older revisions and distinguishes not-loaded (v0.0.18)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "历史");
  await expect(
    page.getByText(/已加载最近 \d+ 条修订（可能还有更早修订）/),
  ).toBeVisible();
  await page.getByRole("button", { name: /加载更早修订/ }).click();
  // mock 追加更早修订并标记“已是全部历史”。
  await expect(page.getByText(/已是全部历史/)).toBeVisible();
  await expect(page.getByText("更早期的修订（加载更早演示）")).toBeVisible();
});

test("history load-more sends revision, author and date conditions (v0.0.18)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "历史");
  await page.getByText("按条件加载更早修订").click();
  await page.getByLabel("较早修订号").fill("10");
  await page.getByLabel("较晚修订号").fill("20");
  await page.getByLabel("历史作者").fill("yangnan");
  await page.getByLabel("历史开始日期").fill("2026-07-01");
  await page.getByLabel("历史结束日期").fill("2026-07-31");
  await page.getByRole("button", { name: /加载更早修订/ }).click();

  await expect(page.getByText(/已按条件加载更早修订/)).toBeVisible();
  await expect(
    page.getByText(
      /当前按修订 r10 至 r20、作者“yangnan”、日期 2026-07-01 至 2026-07-31加载/,
    ),
  ).toBeVisible();
});

test("turns a grouping suggestion into a previewed SVN changelist", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "变更集");
  await page.getByRole("button", { name: "生成分组建议" }).click();
  await page.getByRole("button", { name: "套用并调整" }).click();
  await page.getByRole("button", { name: "生成应用预览" }).click();
  // 预览与对话框均含同一命令，使用 direct child code 避免对话框重复匹配
  await expect(
    page.locator(".changelist-preview > code").first(),
  ).toBeVisible();
  await expect(
    page.locator(".changelist-preview > code").first(),
  ).toContainText('svn changelist "webview"');
  await page.getByRole("button", { name: "确认应用变更集" }).click();
  const changelistDialog = page.getByRole("dialog", {
    name: /应用变更集到 \d+ 个文件/,
  });
  await expect(changelistDialog).toBeVisible();
  await changelistDialog
    .getByRole("button", { name: /确认应用变更集/ })
    .click();
  await expect(page.getByText("文件已加入 webview。")).toBeVisible();
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
  // v0.0.14 意向单二次确认
  const fileOpDialog = page.getByRole("dialog", {
    name: /加入版本控制 \d+ 个文件/,
  });
  await expect(fileOpDialog).toBeVisible();
  await fileOpDialog.getByRole("button", { name: /确认加入版本控制/ }).click();
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
  // v0.1.5 V015-C1：恢复预览改走通用意向单（仍为显式确认，信息更全）。
  const restoreDialog = page.getByRole("dialog", {
    name: "历史恢复 1 个文件",
  });
  await expect(restoreDialog).toContainText("不会自动提交");
  await expect(restoreDialog).toContainText("原内容不可自动恢复");
  await restoreDialog
    .getByRole("button", { name: "确认覆盖 1 个文件" })
    .click();
  await expect(
    page.getByText("src/extension.ts 已恢复为 r42 内容；尚未提交。"),
  ).toBeVisible();
});

test("previews SVN property changes before applying them", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "仓库操作");
  await page.getByRole("button", { name: "SVN 属性", exact: true }).click();
  // v0.0.10：属性行含选择按钮与行内复制按钮，用行定位选择入口。
  await page
    .locator(".property-item__select", { hasText: "svn:ignore" })
    .click();
  await page.getByRole("button", { name: "预览设置" }).click();
  await expect(page.locator(".property-preview > code").first()).toBeVisible();
  await expect(page.locator(".property-preview > code").first()).toContainText(
    'svn propset "svn:ignore"',
  );
  await page.getByRole("button", { name: "确认设置属性" }).click();
  const propDialog = page.getByRole("dialog", { name: /修改属性 svn:ignore/ });
  await expect(propDialog).toBeVisible();
  await propDialog.getByRole("button", { name: /确认设置属性/ }).click();
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
  await expect(page.locator(".property-preview > code").first()).toBeVisible();
  await expect(page.locator(".property-preview > code").first()).toContainText(
    "svn cleanup",
  );
  await page.getByRole("button", { name: "确认清理工作副本" }).click();
  const cleanupDialog = page.getByRole("dialog", { name: "清理工作副本" });
  await expect(cleanupDialog).toBeVisible();
  await cleanupDialog.getByRole("button", { name: /确认清理工作副本/ }).click();
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
  await expect(page.getByText("正在编辑工作副本")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeDisabled();

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
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeEnabled();

  // Ctrl+S 保存：mock 返回成功并刷新快照。
  await page.keyboard.press("Control+s");
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeDisabled();
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
  await expect(page.getByText("正在编辑工作副本")).toBeVisible();

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
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeDisabled();
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
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeDisabled();

  // 第二次真实编辑并保存：mock Host 校验 editToken/expectedContentHash，
  // 携带旧基准会得到 diskChanged 拒绝——这里必须成功。
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 第二次保存");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/保存被拒绝/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeDisabled();
});

test("change understanding: local check then receipt-confirmed model analysis (v0.0.12)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "变更解读");
  await expect(
    page.getByText(/理解当前修改、找出需要确认的风险/),
  ).toBeVisible();
  await expect(page.getByText(/AI 不会修改文件或执行提交/)).toBeVisible();

  // 只运行本地检查。
  await page.getByRole("button", { name: "只运行本地检查" }).click();
  await expect(
    page.getByRole("heading", { name: "这次改了什么" }),
  ).toBeVisible();
  await expect(page.getByText("修改了 2 个文件")).toBeVisible();

  // 受限差异回执：先展示回执，再确认开始模型分析。
  await page.getByRole("button", { name: /重新分析|查看并开始分析/ }).click();
  const receiptRegion = page.getByRole("region", {
    name: "变更解读外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("变更解读（understand-changes）"),
  ).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始模型分析" }).click();
  await expect(page.getByRole("heading", { name: "需要你确认" })).toBeVisible();
  await expect(page.getByText("已证实")).toBeVisible();
  // 会话内确认。
  await page
    .getByLabel("输入要确认的事实")
    .fill("确认 src/extension.ts 仅影响命令注册。");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByText("确认 src/extension.ts 仅影响命令注册。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "清除会话内确认" }).click();
  await expect(
    page.getByText("确认 src/extension.ts 仅影响命令注册。"),
  ).not.toBeVisible();
});

test("change understanding: validated evidence opens the file diff (v0.0.12)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "变更解读");
  await page.getByRole("button", { name: /重新分析|查看并开始分析/ }).click();
  const receiptRegion = page.getByRole("region", {
    name: "变更解读外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始模型分析" }).click();
  await page.getByRole("button", { name: "打开差异" }).first().click();
  await expect(
    page.getByRole("heading", { name: "查看本地修改" }),
  ).toBeVisible();
});

test("semantic changelist split: receipt-confirmed then purpose/deps suggestions (v0.0.12 batch B)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "变更集");
  await page.getByRole("button", { name: /按改动意图拆分/ }).click();
  const receiptRegion = page.getByRole("region", {
    name: "语义拆分外发回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("语义拆分（changelist-split）"),
  ).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始语义拆分" }).click();
  await expect(page.getByText(/目的：基于受限差异/)).toBeVisible();
  await expect(page.getByText("依赖 1 条已确认事实")).toBeVisible();
});

test("commit suggestion notes usage of still-valid confirmations (v0.0.12 batch B)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "提交");
  await page.getByRole("button", { name: "生成建议草稿" }).click();
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).toBeVisible();
  await expect(
    page.getByText(/已使用 1 条变更解读中的会话内确认事实/),
  ).toBeVisible();
});

test("conflict intent interpretation: receipt-confirmed six-section output (v0.0.12 batch C)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "冲突");
  await page
    .getByRole("button", { name: /选择一个冲突文件|app\/conflicted/ })
    .isVisible()
    .catch(() => undefined);
  await page.getByRole("button", { name: "解释冲突意图" }).first().click();
  const receiptRegion = page.getByRole("region", {
    name: "冲突意图解释回执",
  });
  await expect(receiptRegion).toBeVisible();
  await expect(
    receiptRegion.getByText("冲突意图解释（conflict-interpret）"),
  ).toBeVisible();
  await receiptRegion.getByRole("button", { name: "开始解释" }).click();
  await page.getByText("需要帮助（合并建议与解释）").click();
  await expect(page.getByRole("heading", { name: "意图解释" })).toBeVisible();
  await expect(page.getByText("我的修改意图")).toBeVisible();
  await expect(page.getByText("对方修改意图")).toBeVisible();
  await expect(page.getByText("无法判断的业务选择")).toBeVisible();
  await expect(page.getByText("保存后应运行的验证")).toBeVisible();
});
