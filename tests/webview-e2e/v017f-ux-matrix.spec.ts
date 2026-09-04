import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * V017-F · UX-01~UX-10 自动化矩阵补齐（最低断言）。
 * 只补已有覆盖的缺口；已有覆盖见各源用例（括号内注明）：
 * - UX-01/02（中文术语/时间数量）：chinese-scroll ZH-01~04/09；
 * - UX-03（IME）：组件 OperationIntentDialog/ShortcutHelp + e2e V014-F1/revert-switch-relocate；
 * - UX-04（危险确认）：revert-switch-relocate/history-restore-intent/daily-path；
 * - UX-05（右键深链接）：workbench.spec 右键菜单 + daily-path；
 * - UX-06（局部滚动）：chinese-scroll SCR-01~08b；
 * - UX-07（键盘）：list-operations + v017c-focus + 组件 FocusRoundtrip；
 * - UX-08（主题）：visual-accessibility + v016-visual-matrix；
 * - UX-09（视口缩放）：chinese-scroll SCR-12~15 + v016-visual-matrix；
 * - UX-10（降级过期）：workbench.spec AI 关闭/失败/stale 系列。
 * 本文件只新增：大列表窗口化键盘真行为、意向单 e2e（Tab/Esc/IME/底栏）、
 * Diff/冲突代码滚动与块导航与编辑器焦点与查找可发现、200% 两条核心路径、
 * `?` 当前区域帮助与列表提示条。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout；断言平台无关。
 */

async function assertNoPageHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>(".workbench-content");
      return (
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1 &&
        document.body.scrollWidth <= document.body.clientWidth + 1 &&
        (!content || content.scrollWidth <= content.clientWidth + 1)
      );
    }),
  ).toBe(true);
}

async function assertInsideContent(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await expect(target, label).toBeVisible();
  const [contentBox, targetBox] = await Promise.all([
    page.locator(".workbench-content").boundingBox(),
    target.boundingBox(),
  ]);
  expect(contentBox, `${label} 缺少内容区布局`).not.toBeNull();
  expect(targetBox, `${label} 缺少可视区域`).not.toBeNull();
  expect(targetBox!.y, `${label} 被裁切到内容区上方`).toBeGreaterThanOrEqual(
    contentBox!.y - 1,
  );
  expect(
    targetBox!.y + targetBox!.height,
    `${label} 被裁切到内容区下方`,
  ).toBeLessThanOrEqual(contentBox!.y + contentBox!.height + 1);
}

test("V017-F(LARGE-01)：5000 项窗口化列表 PageUp/PageDown/Home/End/Shift+F10 真行为", async ({
  page,
}) => {
  await page.goto("/?dataset=large");
  const list = page.getByRole("list", { name: "SVN 变更文件" });
  await expect(list).toHaveClass(/file-list--virtual/);
  await list.focus();

  // PageDown 真分页：scrollTop 增大；PageUp 回滚。
  await list.press("PageDown");
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  const afterDown = await list.evaluate((element) => element.scrollTop);
  expect(afterDown).toBeGreaterThan(0);
  await list.press("PageUp");
  await expect
    .poll(() => list.evaluate((element) => element.scrollTop))
    .toBeLessThan(afterDown);

  // End 到末项：file-4999.ts 挂载可见，仍保持窗口化。
  await list.press("End");
  await expect(
    page.locator(".path-cell__name", { hasText: "file-4999.ts" }),
  ).toBeVisible();
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(
    0,
  );
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);

  // Home 回首项：file-0000.ts 挂载可见，仍保持窗口化。
  await list.press("Home");
  await expect(
    page.locator(".path-cell__name", { hasText: "file-0000.ts" }),
  ).toBeVisible();
  expect(await list.getByRole("listitem").count()).toBeLessThan(100);

  // Shift+F10 打开活动行菜单；Esc 关闭后焦点回到列表内。
  await list.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          !!document.activeElement.closest(
            '[role="list"][aria-label="SVN 变更文件"]',
          ),
      ),
    )
    .toBe(true);
});

test("V017-F(DIALOG-01)：提交意向单 Tab 首尾循环/IME 底栏可达/Esc 返回触发点", async ({
  page,
}) => {
  await page.goto("/?module=commit");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "提交说明" })
    .fill("V017-F 意向单键盘验证");
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await previewEntry.click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  const openIntent = page.getByRole("button", { name: /确认提交/ });
  await expect(openIntent).toBeEnabled();
  await openIntent.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Tab 首尾循环：连续 Tab 焦点始终不出对话框。
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("Tab");
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          !!document.activeElement.closest("dialog"),
      ),
    )
    .toBe(true);
  // Shift+Tab 反向同样不出对话框。
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("Shift+Tab");
  }
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          !!document.activeElement.closest("dialog"),
      ),
    )
    .toBe(true);

  // IME 候选阶段 Enter 不确认：对话框保持打开且未执行。
  await dialog.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /确认提交/ })).toBeEnabled();
  await dialog.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 底栏可达：滚动到底后确认操作仍可见（不被内容区推出可视范围）。
  await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(dialog.getByRole("button", { name: /确认提交/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "取消" })).toBeVisible();

  // Esc 关闭并返回触发点。
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openIntent).toBeFocused();
});

test("V017-F(DIFF-01)：差异代码区真实滚动/当前块导航/编辑器焦点", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=diff");
  await expect(page.getByText("BASE ↔ 工作副本").first()).toBeVisible();

  // 代码区真实溢出归属（非页面级滚动）：pierre 差异视图框自带 overflow:auto。
  const frame = page.locator(".diff-view-frame");
  await expect(frame).toBeVisible();
  const metrics = await frame.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(["auto", "scroll"]).toContain(metrics.overflowY);
  expect(metrics.scrollHeight, "差异代码区没有形成真实溢出").toBeGreaterThan(
    metrics.clientHeight + 1,
  );
  // 代码区纵向滚动位置真实变化。
  await frame.evaluate((element) => {
    element.scrollTop = 0;
  });
  const frameTop = await frame.evaluate((element) => element.scrollTop);
  await frame.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => frame.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(frameTop);

  // 当前块导航：按钮与 Alt+↑/↓ 均可用且指示区持续可见。
  const position = page.locator(".diff-hunk-position");
  await expect(position).toBeVisible();
  await expect(page.getByRole("button", { name: "下一处差异" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "上一处差异" })).toBeEnabled();
  await page.getByRole("button", { name: "下一处差异" }).click();
  await expect(position).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(position).toBeVisible();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(position).toBeVisible();

  // 编辑器焦点：进入页内编辑后焦点落在可编辑区，退出后回到审阅态。
  await page.getByRole("button", { name: "页内编辑" }).click();
  await expect(page.getByText("正在编辑工作副本")).toBeVisible();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await expect(editable).toBeAttached();
  await editable.click();
  await expect(editable).toBeFocused();
  await expect(
    page.getByRole("button", { name: "保存到工作副本" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "回到审阅" }).click();
  await expect(page.getByText("正在编辑工作副本")).toHaveCount(0);
  await assertNoPageHorizontalOverflow(page);
});

test("V017-F(CONF-01)：冲突块导航/编辑器单实例/查找可发现/保存到解决预览", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/?module=conflicts&conflictBlocks=10");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  const blockProgress = page.getByTestId("block-progress");
  await expect(blockProgress).toContainText("块 1/10");

  // 块导航：模块级下一块/上一块切换进度，Alt+↑/↓ 同义（focusBlock）。
  // 注：工具栏同名按钮只驱动工具栏内进度（merge-block-progress），
  // 模块进度（block-progress）由模块级按钮与 Alt 导航驱动。
  await expect(page.getByRole("button", { name: "上一个块" })).toBeVisible();
  await page.getByRole("button", { name: "下一个冲突块" }).click();
  await expect(blockProgress).toContainText("块 2/10");
  await page.keyboard.press("Alt+ArrowUp");
  await expect(blockProgress).toContainText("块 1/10");

  // 编辑器单实例且工作区可滚到保存入口。
  const editorHost = page.getByTestId("conflict-result-editor-host");
  await expect(editorHost).toBeVisible();
  await expect(editorHost).toHaveCount(1);
  const workspace = page.getByRole("region", { name: "冲突处理工作区" });
  await workspace.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "保存工作副本合并结果" }),
  ).toBeVisible();

  // 查找可发现：`?` 打开当前区域帮助，含查找绑定且无列表无关命令。
  const helpTrigger = page.getByRole("button", { name: "快捷键帮助" });
  await helpTrigger.focus();
  await page.keyboard.press("?");
  const helpPanel = page.getByTestId("conflict-shortcut-help");
  await expect(helpPanel).toBeVisible();
  await expect(helpPanel.getByText("冲突快捷键")).toBeVisible();
  await expect(helpPanel.getByText("查找").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpPanel).toHaveCount(0);

  // 保存到解决预览前止步（不执行 Resolve）。
  await page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first()
    .click();
  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await expect(saveButton).toBeEnabled({ timeout: 15000 });
  await saveButton.click();
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
  ).toBeVisible({ timeout: 15000 });
  const details = page.getByTestId("conflict-help-details");
  const isOpen = await details
    .evaluate((element) => (element as HTMLDetailsElement).open)
    .catch(() => false);
  if (!isOpen) {
    await page
      .locator('[data-testid="conflict-help-details"] summary')
      .first()
      .click();
  }
  await page.getByRole("button", { name: "生成解决预览" }).click();
  await expect(
    page.getByRole("button", { name: "确认使用当前工作副本内容并标记解决" }),
  ).toBeVisible();
});

test("V017-F(ZOOM-01)：200% 等价 Changes→Diff→Commit 到确认前无永久裁切", async ({
  page,
}) => {
  // 沿 SCR-12 约定：200% 用 720×480 逻辑视口代理。
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=changes&continuity=restore&commitHandoff=basic");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();
  await assertNoPageHorizontalOverflow(page);

  // Changes→Diff。
  await page
    .getByRole("button", { name: "查看 src/extension.ts 差异" })
    .click();
  await expect(page.getByText("BASE ↔ 工作副本").first()).toBeVisible();
  await assertInsideContent(
    page,
    page.getByRole("button", { name: "返回本地修改" }),
    "200% Diff 返回入口",
  );
  await assertNoPageHorizontalOverflow(page);
  await page.getByRole("button", { name: "返回本地修改" }).click();
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // Diff→Commit 到意向单前止步。
  const mainOp = page.getByRole("button", { name: /检查并提交所选/ });
  await assertInsideContent(page, mainOp, "200% Changes 主操作");
  await mainOp.click();
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await assertInsideContent(page, previewEntry, "200% Commit 预览主操作");
  await previewEntry.click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  const openIntent = page.getByRole("button", { name: /确认提交/ });
  await assertInsideContent(page, openIntent, "200% Commit 确认前入口");
  await assertNoPageHorizontalOverflow(page);
});

test("V017-F(ZOOM-02)：200% 等价冲突保存到 Resolve 确认前无永久裁切", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=conflicts&conflicts=multi");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await assertNoPageHorizontalOverflow(page);

  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await assertInsideContent(page, saveButton, "200% 冲突保存入口");
  await page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first()
    .click();
  await expect(saveButton).toBeEnabled({ timeout: 15000 });
  await saveButton.click();
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
  ).toBeVisible({ timeout: 15000 });
  const details = page.getByTestId("conflict-help-details");
  const isOpen = await details
    .evaluate((element) => (element as HTMLDetailsElement).open)
    .catch(() => false);
  if (!isOpen) {
    await page
      .locator('[data-testid="conflict-help-details"] summary')
      .first()
      .click();
  }
  const previewButton = page.getByRole("button", { name: "生成解决预览" });
  await assertInsideContent(page, previewButton, "200% 解决预览入口");
  await previewButton.click();
  const resolveConfirm = page.getByRole("button", {
    name: "确认使用当前工作副本内容并标记解决",
  });
  await assertInsideContent(page, resolveConfirm, "200% Resolve 确认前");
  await assertNoPageHorizontalOverflow(page);
});

test("V017-F(HELP-01)：列表提示条存在且 `?` 只打开当前区域帮助", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 列表提示条：含 Space/Enter/Shift+F10 真实绑定，可聚焦播报全文。
  const hint = page.getByTestId("list-shortcut-hint");
  await expect(hint).toBeVisible();
  await expect(hint.getByText("Space").first()).toBeVisible();
  await expect(hint.getByText("Shift+F10").first()).toBeVisible();
  await hint.focus();
  await expect(hint).toBeFocused();

  // 冲突区 `?` 只显示当前区域绑定。
  await page.goto("/?module=conflicts");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  const toolbar = page.getByTestId("merge-action-toolbar");
  await toolbar.focus();
  await page.keyboard.press("?");
  const helpPanel = page.getByTestId("conflict-shortcut-help");
  await expect(helpPanel).toBeVisible();
  await expect(helpPanel.getByText("冲突快捷键")).toBeVisible();
  await expect(helpPanel.getByText("上一个块").first()).toBeVisible();
  await expect(helpPanel.getByText("下一个块").first()).toBeVisible();
  await expect(helpPanel.getByText("选择当前筛选可操作项")).toHaveCount(0);
  await page.keyboard.press("?");
  await expect(helpPanel).toHaveCount(0);
  // V017-F 真修：模块级 `?` 关闭后焦点返回工具栏 `?` 按钮（不掉到 body）。
  await expect(page.getByTestId("toolbar-shortcut-help")).toBeFocused();
});
