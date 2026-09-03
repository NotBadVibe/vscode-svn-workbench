import { expect, test } from "@playwright/test";

/*
 * V015-F1 · Revert/Switch/Relocate 确认路径 e2e。
 * 全程确定性：只用 expect 轮询与键盘事件，不用 waitForTimeout 死等；
 * 断言平台无关（不依赖系统修饰键）。
 *
 * - Revert：Changes 勾选 2 个文件 → 右键「还原本地变更」→ 预览
 *   （consequences/可恢复性）→ 意向单「确认还原本地修改（2）」，
 *   确认前断言唯一 primary 与数量一致；C2 后无「我已核对」复选框。
 * - Switch：Repository 危险操作「切换」→ 生成预览 → 意向单确认前断言
 *   （九要素行、唯一 primary）；无前置复选框。
 * - Relocate：Repository「重定位」→ 预览 → 意向单复述框白名单：
 *   错误地址禁用+中文提示；归一化等价地址（协议/主机大小写、尾斜杠）放行，
 *   路径大小写差异仍拒绝；IME composition Enter 不触发执行。
 */

test("V015-F1：Revert 确认路径（预览→意向单→唯一主操作与数量一致）", async ({
  page,
}) => {
  await page.goto("/?module=changes");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 第 1 步：选择 2 个可操作文件（批量还原的作用集合）。
  await page.getByLabel("选择 src/extension.ts").check();
  await page.getByLabel("选择 src/webview/App.svelte").check();
  await expect(page.getByLabel("选择 src/extension.ts")).toBeChecked();
  await expect(page.getByLabel("选择 src/webview/App.svelte")).toBeChecked();

  // 第 2 步：键盘打开活动行菜单，触发批量还原预览（选中集合决定预览数量）。
  // 右键菜单与 Shift+F10 走同一行菜单入口；键盘路径确定且平台无关。
  const fileList = page.getByRole("list", { name: "SVN 变更文件" });
  await fileList.focus();
  await expect(fileList).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator(".file-row--active")).toContainText("extension.ts");
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "还原本地变更" }).click();

  // 第 3 步：预览渲染 consequences、可恢复性与精确命令。
  // 意向单 DOM 在预览生成后即隐藏渲染，断言用 exact/first 收敛到可见预览。
  const preview = page.getByRole("dialog", { name: "SVN 文件操作预览" });
  await expect(preview).toBeVisible();
  await expect(
    preview.getByRole("heading", { name: "还原本地修改" }),
  ).toBeVisible();
  await expect(preview.getByText("2 个文件", { exact: true })).toBeVisible();
  await expect(
    preview.getByText("操作只影响当前明确选择的文件，不会自动提交。"),
  ).toBeVisible();
  await expect(preview.getByText("可恢复性：").first()).toBeVisible();
  await expect(
    preview.getByText("未提交内容无法从 SVN 恢复。").first(),
  ).toBeVisible();
  // 命令在折叠区内：展开后断言（与历史恢复意向单用例同口径）。
  await preview.getByText("查看文件与命令").click();
  await expect(preview.getByText(/svn revert/).first()).toBeVisible();

  // 第 4 步：打开意向单（C2 一次确认：预览后直开意向单，无前置复选框）。
  await expect(page.getByText("我已核对")).toHaveCount(0);
  const openIntent = preview.getByRole("button", {
    name: "确认还原本地修改",
  });
  await expect(openIntent).toBeEnabled();
  await openIntent.click();

  // 第 5 步：意向单九要素（动作/数量/清单/命令/可恢复性/范围行）。
  const dialog = page.getByRole("dialog", { name: "还原本地修改 2 个文件" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("还原本地修改 2 个文件").first()).toBeVisible();
  await expect(dialog.getByText("影响 2 个路径")).toBeVisible();
  await expect(dialog.getByText("范围：")).toBeVisible();
  await expect(dialog.getByText("可恢复性：")).toBeVisible();
  await expect(dialog.getByText("未提交内容无法从 SVN 恢复。")).toBeVisible();
  await expect(dialog.getByText("src/extension.ts").first()).toBeVisible();
  await expect(
    dialog.getByText("src/webview/App.svelte").first(),
  ).toBeVisible();
  await dialog.getByText(/查看将执行的命令/).click();
  await expect(dialog.getByText(/svn revert/)).toBeVisible();

  // 第 6 步：确认前断言唯一 primary、数量一致、无前置复选框。
  await expect(dialog.locator(".button--primary")).toHaveCount(1);
  const confirm = dialog.getByRole("button", {
    name: "确认还原本地修改（2）",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByText("我已核对")).toHaveCount(0);
});

test("V015-F1：Switch 确认路径（预览→意向单九要素行→唯一主操作）", async ({
  page,
}) => {
  await page.goto("/?module=repository");
  await expect(
    page.getByRole("region", { name: "仓库任务导航" }),
  ).toBeVisible();

  // 第 1 步：展开危险操作组，进入切换任务（默认只展开「分支与集成」）。
  const dangerousToggle = page.getByRole("button", { name: /危险操作/ });
  await dangerousToggle.click();
  await expect(dangerousToggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "切换", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "切换工作副本（Switch）" }),
  ).toBeVisible();

  // 第 2 步：填写目标分支并生成预览。
  await page
    .getByLabel("目标 URL")
    .fill("https://svn.example.test/repos/workbench/branches/feature");
  await page
    .getByRole("button", { name: "生成切换工作副本（Switch）预览" })
    .click();

  // 第 3 步：预览渲染命令与影响（C2 后无「我已核对」复选框）。
  // 预览区与隐藏意向单 DOM 同文案，断言收敛到预览网格作用域。
  await expect(page.locator("#advanced-preview-title")).toHaveText(
    "切换工作副本",
  );
  // 命令与影响清单同时存在于隐藏意向单 DOM，收敛到预览网格作用域。
  const previewGrid = page.locator(".advanced-preview-grid");
  await expect(previewGrid.getByText(/svn switch/)).toBeVisible();
  await expect(
    previewGrid.getByText("只修改当前工作副本；不会自动提交。"),
  ).toBeVisible();
  await expect(page.getByText("我已核对")).toHaveCount(0);
  const openIntent = page.getByRole("button", {
    name: "确认执行切换工作副本",
  });
  await expect(openIntent).toBeEnabled();
  await openIntent.click();

  // 第 4 步：意向单九要素行（范围/修订版本/可恢复性/影响清单/命令）。
  const dialog = page.getByRole("dialog", { name: "切换工作副本" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("切换工作副本").first()).toBeVisible();
  await expect(dialog.getByText("影响 2 个路径")).toBeVisible();
  await expect(dialog.getByText("范围：")).toBeVisible();
  await expect(dialog.getByText("vscode-svn")).toBeVisible();
  await expect(dialog.getByText("修订版本：")).toBeVisible();
  await expect(dialog.getByText("r42")).toBeVisible();
  await expect(dialog.getByText("可恢复性：")).toBeVisible();
  await expect(
    dialog.getByText("此操作不能在工作台中一键撤销。"),
  ).toBeVisible();
  await dialog.getByText(/查看将执行的命令/).click();
  await expect(dialog.getByText(/svn switch/)).toBeVisible();

  // 第 5 步：确认前断言唯一 primary、确认可用、无前置复选框。
  await expect(dialog.locator(".button--primary")).toHaveCount(1);
  const confirm = dialog.getByRole("button", {
    name: "确认执行切换工作副本",
  });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeVisible();
  await expect(dialog.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(page.getByText("我已核对")).toHaveCount(0);
});

test("V015-F1：Relocate 复述白名单（错地址禁用→归一化放行→IME 保护）", async ({
  page,
}) => {
  const newRoot = "https://svn.example.test/repos/workbench-new";
  await page.goto("/?module=repository");
  await expect(
    page.getByRole("region", { name: "仓库任务导航" }),
  ).toBeVisible();

  // 第 1 步：进入重定位任务并填写新根地址。
  const dangerousToggle = page.getByRole("button", { name: /危险操作/ });
  await dangerousToggle.click();
  await expect(dangerousToggle).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "重定位", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "重定位仓库地址（Relocate）" }),
  ).toBeVisible();
  await page.getByLabel("新的仓库根地址").fill(newRoot);
  await page
    .getByRole("button", { name: "生成重定位仓库地址（Relocate）预览" })
    .click();

  // 第 2 步：预览展示新根行与额外确认说明（收敛到预览区作用域）。
  await expect(page.locator("#advanced-preview-title")).toHaveText(
    "重定位仓库根地址",
  );
  const relocatePreview = page.locator(".advanced-preview-grid");
  await expect(relocatePreview.getByText(`新根：${newRoot}`)).toBeVisible();
  await expect(
    page
      .locator(".advanced-preview")
      .getByText("重定位会改写仓库绑定且难以恢复"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认执行重定位仓库地址" }).click();

  // 第 3 步：意向单复述框优先聚焦，初始未复述时确认禁用。
  const dialog = page.getByRole("dialog", { name: "重定位仓库根地址" });
  await expect(dialog).toBeVisible();
  const challenge = dialog.getByLabel("复述新的仓库根 URL");
  await expect(challenge).toBeFocused();
  const confirm = dialog.getByRole("button", {
    name: "确认执行重定位仓库地址",
  });
  await expect(confirm).toBeDisabled();
  await expect(dialog.locator(".button--primary")).toHaveCount(1);

  // 第 4 步：错误地址 → 确认禁用 + 中文恢复提示。
  await challenge.fill("https://wrong.example.test/repos/other");
  await expect(confirm).toBeDisabled();
  await expect(
    dialog.getByText("复述目标与预览的新根地址不一致，无法确认。"),
  ).toBeVisible();

  // 第 5 步：归一化等价（协议/主机大小写 + 尾斜杠）→ 放行。
  await challenge.fill("HTTPS://SVN.EXAMPLE.TEST/repos/workbench-new/");
  await expect(confirm).toBeEnabled();

  // 第 6 步：路径大小写差异（SVN 路径大小写敏感）→ 仍拒绝。
  await challenge.fill("https://svn.example.test/repos/WORKBENCH-NEW");
  await expect(confirm).toBeDisabled();

  // 第 7 步：准确复述 → 放行；IME 候选期 Enter 不触发执行。
  await challenge.fill(newRoot);
  await expect(confirm).toBeEnabled();
  await challenge.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await challenge.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("高级仓库操作已完成；状态已经重新采集。"),
  ).toHaveCount(0);
  await challenge.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 第 8 步：复述框内 Enter（非组合态）同样不触发确认，对话框保持打开。
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByText("高级仓库操作已完成；状态已经重新采集。"),
  ).toHaveCount(0);
});
