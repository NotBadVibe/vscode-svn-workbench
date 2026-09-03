import { expect, test } from "@playwright/test";

/*
 * V014-F1 · 日常主路径串联（§2.2 门禁核心用例）。
 * 链路：Changes（恢复载荷）→ 断言恢复与播报 → 打开活动文件 Diff →
 * Diff 页内编辑并 Ctrl+S 保存 → 返回本地修改 → 断言合法选择保留 →
 * 主操作进 Commit → 断言交接来源与带入数量 → 预览提交 → 意向单断言。
 * mock 组合 `?continuity=restore&commitHandoff=basic` 已受现有 mock 支持
 * （changesSnapshot 读 continuity、commitSnapshot 读 commitHandoff，
 * open-module 保留查询参数），无需扩展旧语义。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout 死等。
 */
test("V014-F1：日常主路径 Changes→Diff→返回→Commit→意向单无范围扩大", async ({
  page,
}) => {
  // 第 1 步：进入本地修改（携带恢复载荷与交接载荷组合）。
  await page.goto("/?module=changes&continuity=restore&commitHandoff=basic");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 第 2 步：断言选择/活动行/视图恢复与播报（与 continuity-restore 同口径）。
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/webview/App.svelte" }),
  ).toBeChecked();
  await expect(
    page.getByText(/已按最新快照保留 2 个选择，移除 1 个失效项。/),
  ).toBeVisible();
  await expect(page.getByLabel("共享提交草稿")).toHaveValue(
    "feat(workbench): 完善统一 Svelte 工作台",
  );
  const activeRow = page.locator(".file-row--active");
  await expect(activeRow).toHaveCount(1);
  await expect(activeRow).toContainText("extension.ts");

  // 第 3 步：打开活动文件 Diff（来源文件保持可达）。
  await page
    .getByRole("button", { name: "查看 src/extension.ts 差异" })
    .click();
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
  const backButton = page.getByRole("button", { name: "返回本地修改" });
  await expect(backButton).toBeVisible();
  await expect(backButton).not.toHaveClass(/button--primary/);

  // 第 4 步：Diff 页内编辑并 Ctrl+S 保存（mock Host 成功路径）。
  await page.getByRole("button", { name: "页内编辑" }).click();
  await expect(page.getByText("正在编辑工作副本")).toBeVisible();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  // 编辑器挂载竞态双门：先确认节点已挂载且可编辑，再点击聚焦。
  await expect(editable).toBeAttached();
  await expect(editable).toBeEditable();
  await editable.click();
  await expect(editable).toBeFocused();
  // 编辑会话完全建立后再输入（目标切换后 Editor 异步挂载，逐字输入更可靠）。
  await expect(page.getByText("编辑只作用于工作副本")).toBeVisible();
  const saveButton = page.getByRole("button", { name: "保存到工作副本" });
  await expect(saveButton).toBeVisible();
  await editable.pressSequentially("// daily-path-edit", { delay: 10 });
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  // 保存按钮 enabled 为执行保存前的输入完成门。
  await expect(saveButton).toBeEnabled();
  await page.keyboard.press("Control+s");
  // 保存完成以轮询收敛异步落盘与快照刷新：按钮回到禁用或脏标消失。
  await expect
    .poll(
      async () => {
        const disabled = await saveButton.isDisabled().catch(() => true);
        const dirtyCount = await page.getByText(/有未保存的修改/).count();
        return disabled || dirtyCount === 0;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await expect(page.getByText(/有未保存的修改/)).toHaveCount(0);
  // 保存后先回到审阅态（退出编辑），再使用返回入口回到本地修改。
  await page.getByRole("button", { name: "回到审阅" }).click();
  await expect(page.getByText("正在编辑工作副本")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "页内编辑" })).toBeVisible();

  // 第 5 步：返回本地修改（同一组合载荷重新消费，再次恢复）。
  const returnButton = page.getByRole("button", { name: "返回本地修改" });
  await expect(returnButton).toBeVisible();
  await returnButton.click();
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 第 6 步：断言合法选择保留、新状态文件未自动加入、活动行/滚动锚恢复。
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/webview/App.svelte" }),
  ).toBeChecked();
  // 未纳入版本控制的新状态文件不因过去的全选自动加入。
  await expect(
    page.getByRole("checkbox", { name: "选择 dist/debug.log" }),
  ).not.toBeChecked();
  await expect(
    page.getByText(/已按最新快照保留 2 个选择，移除 1 个失效项。/),
  ).toBeVisible();
  const restoredActive = page.locator(".file-row--active");
  await expect(restoredActive).toHaveCount(1);
  await expect(restoredActive).toContainText("extension.ts");
  await expect(restoredActive).toBeVisible();

  // 第 7 步：主操作进 Commit（B 收敛后的唯一主操作，数量来自权威选择）。
  const mainOp = page.getByRole("button", { name: /检查并提交所选/ });
  await expect(mainOp).toContainText("（2）");
  await mainOp.click();
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();

  // 第 8 步：断言交接来源行与带入数量（E 交接显示，范围未扩大）。
  const summary = page.getByRole("region", { name: "待提交文件摘要" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("来自本地修改，范围未扩大")).toBeVisible();
  await expect(summary.getByText(/已带入 \d+ 个文件/)).toBeVisible();
  // 交接不带入范围外文件：阻止项/外部依赖不出现在摘要带入数之外的选择中。
  await expect(summary.getByText("vendor/external-lib")).toHaveCount(0);
  // 紧凑模式唯一主操作（D 口径）：首屏只有一个 primary。
  await expect(page.locator(".commit-compact .button--primary")).toHaveCount(1);
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await expect(previewEntry).toBeVisible();
  await expect(previewEntry).toContainText("2 个文件");

  // 第 9 步：点击预览提交，生成可执行的提交预览。
  await previewEntry.click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();

  // 第 10 步：打开意向单（预览后的确认入口），断言渲染与数量一致。
  const openIntent = page.getByRole("button", { name: /确认提交/ });
  await expect(openIntent).toBeEnabled();
  // 预览权威数量：预览事实条与待打开意向单数量一致（mock 交接带入 2 个）。
  await expect(page.getByText("2 个文件").first()).toBeVisible();
  await openIntent.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 意向单标题与数量来自 preview.selectedPaths（mock 为 2 个）。
  await expect(dialog.getByText("提交 2 个文件").first()).toBeVisible();
  await expect(dialog.getByText("影响 2 个路径")).toBeVisible();
  // 意向单内唯一 primary（确认），取消为次级。
  await expect(dialog.locator(".button--primary")).toHaveCount(1);
  const confirmBtn = dialog.getByRole("button", { name: /确认提交/ });
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeVisible();
  // 意向单无范围扩大：只含交接带入的合法文件，不含范围外阻止项。
  await expect(dialog.getByText("src/extension.ts").first()).toBeVisible();
  await expect(dialog.getByText("vendor/external-lib")).toHaveCount(0);
  await expect(dialog.getByText("dist/out.js")).toHaveCount(0);
});

/*
 * V014-F1 · IME 主路径保护（Commit 说明框）。
 * 现状：提交说明仅 Ctrl/⌘+Enter 触发预览，且 isImeComposing 双拦截。
 * 本用例：组合输入开始后 Ctrl+Enter 不触发预览；组合结束后恢复正常。
 * 全程确定性：合成 CompositionEvent + isComposing 按键事件，不用死等。
 */
test("V014-F1：Commit 说明框组合输入期间 Ctrl+Enter 不触发预览", async ({
  page,
}) => {
  // 进入提交模块（无交接载荷，聚焦 IME 主路径本身）。
  await page.goto("/?module=commit");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  const messageBox = page.getByRole("textbox", { name: "提交说明" });
  await expect(messageBox).toBeVisible();
  await messageBox.fill("日常主路径提交说明");

  // 尚无预览：预览入口可见，就绪横幅不可见。
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await expect(previewEntry).toBeVisible();
  await expect(page.getByText("范围、状态和远端检查已通过")).toHaveCount(0);

  // 组合输入开始后：合成 isComposing 的 Ctrl+Enter 不得触发预览。
  await messageBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    const composingKey = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(composingKey, "isComposing", { value: true });
    Object.defineProperty(composingKey, "keyCode", { value: 229 });
    element.dispatchEvent(composingKey);
  });
  // 仍无预览：预览入口仍在，就绪横幅仍不可见。
  await expect(previewEntry).toBeVisible();
  await expect(page.getByText("范围、状态和远端检查已通过")).toHaveCount(0);

  // 组合输入结束后：真实 Ctrl+Enter 恢复正常，生成预览。
  await messageBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  await messageBox.focus();
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
});
