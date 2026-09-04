import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * V017-G · 两条核心路径键盘全程 e2e（v0.1.7 §3.7 形成性验收的自动化部分）。
 * 中文注释：本文件只覆盖“自动化键盘路径已覆盖”的部分，真机人工任务
 * （真实 VS Code 窗口 + 真实输入法 + 读屏/触屏）未执行，见测试与验收基线记录。
 *
 * - 路径 1「Changes→Diff→返回→Commit→意向单确认前」：全程只用 page.keyboard
 *   （Tab 前进导航 / Space 切换选择 / Enter 激活 / 方向键移动 / Esc 关闭），
 *   禁用鼠标点击（本文件无 click/check/fill/dblclick），关键步骤断言焦点位置。
 * - 路径 2「冲突编辑→保存→Resolve 确认前」：冲突模块内 Tab/Shift+Tab/Enter
 *   块编辑、Ctrl/⌘+S 写检查点、导航到解决预览并在确认按钮前止步（不执行
 *   Resolve）。正向 Tab 经过 pierre 编辑器宿主时宿主消费 Tab（编辑器缩进语义）
 *   且 Esc 不移出焦点，路径 2 用 Shift+Tab 同模块回退到达保存栏；该正向陷阱
 *   列入遗留观察项，未声称通过。
 * - IME 嵌入：路径 1 在提交说明框与提交意向单内组合输入期间真实 Enter
 *   不触发预览/确认；路径 2 在筛选框组合输入期间 Enter 不触发、在合并结果区
 *   组合输入期间 Ctrl/⌘+S 不写检查点；组合结束后恢复正常。
 * - V017-G 真修：块级采用后被卸载按钮曾使焦点掉到 body，本文件断言焦点仍在
 *   冲突区；修复见 ConflictsModule.applyBlock（触发控件卸载后收回块列表区）。
 * - 全程确定性：只用 expect 轮询/断言，不用 waitForTimeout；按键使用 ControlOrMeta
 *   兼顾 macOS/Windows/Linux，不依赖平台修饰键。
 */

// 中文注释：断言焦点落在指定容器内（activeElement 归属），不绑定具体控件实现细节。
async function expectFocusWithin(
  page: Page,
  selector: string,
  label: string,
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((sel) => {
          const active = document.activeElement as HTMLElement | null;
          return active ? active.closest(sel) !== null : false;
        }, selector),
      { timeout: 8000, message: label },
    )
    .toBe(true);
}

// 中文注释：纯键盘 Tab 前进直到目标聚焦；到达即停，上限防止死循环。
// 注意：调用方须传入单一定位（必要时 .first()），全程不使用鼠标点击。
async function tabTo(
  page: Page,
  target: Locator,
  maxTabs = 120,
): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    const focused = await target
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

// 中文注释：纯键盘 Shift+Tab 回退直到目标聚焦（与 tabTo 对称）。
// 路径 2 用它从块列表回退到保存栏：正向 Tab 会经过 pierre 编辑器宿主
// （宿主消费 Tab 作缩进，属编辑器标准行为），回退是同模块内的键盘可达路线。
async function shiftTabTo(
  page: Page,
  target: Locator,
  maxTabs = 120,
): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    const focused = await target
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) return;
    await page.keyboard.press("Shift+Tab");
  }
  await expect(target).toBeFocused();
}

test("V017-G(PATH-1)：Changes→Diff→返回→Commit→意向单确认前键盘全程", async ({
  page,
}) => {
  // 第 1 步：进入本地修改（恢复载荷 + 交接载荷组合，mock 已支持，无需扩展语义）。
  await page.goto("/?module=changes&continuity=restore&commitHandoff=basic");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 第 2 步：断言恢复结果（与 continuity-restore 同口径：保留 2 个合法选择）。
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/webview/App.svelte" }),
  ).toBeChecked();
  const activeRow = page.locator(".file-row--active");
  await expect(activeRow).toHaveCount(1);
  await expect(activeRow).toContainText("extension.ts");

  // 第 3 步：断言初始焦点已落在列表区（恢复后焦点在活动行，直接可按方向键）。
  await expectFocusWithin(
    page,
    ".file-list, .file-row",
    "初始焦点不在变更列表",
  );

  // 第 4 步：Home 回到首行（方向键导航），断言活动行与焦点不丢。
  await page.keyboard.press("Home");
  await expect(page.locator(".file-row--active")).toContainText("example.ts");
  await expectFocusWithin(page, ".file-list, .file-row", "Home 后焦点离开列表");

  // 第 5 步：ArrowDown 走到 extension.ts（恢复的选择行）。
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".file-row--active")).toContainText("extension.ts");
  await expectFocusWithin(
    page,
    ".file-list, .file-row",
    "方向键下移后焦点离开列表",
  );

  // 第 6 步：ArrowDown 到 App.svelte，用 Space 取消再恢复选择（焦点不动选择动）。
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".file-row--active")).toContainText("App.svelte");
  const appCheck = page.getByRole("checkbox", {
    name: "选择 src/webview/App.svelte",
  });
  await page.keyboard.press(" ");
  await expect(appCheck).not.toBeChecked();
  await expectFocusWithin(page, ".file-row", "Space 切换后焦点离开活动行");
  await page.keyboard.press(" ");
  await expect(appCheck).toBeChecked();

  // 第 7 步：ArrowUp 回到 extension.ts，按 Enter 打开差异（键盘激活）。
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".file-row--active")).toContainText("extension.ts");
  await page.keyboard.press("Enter");
  await expect(page.getByText("BASE ↔ 工作副本").first()).toBeVisible();
  const diffRegion = page.locator('section[aria-label*="src/extension.ts"]');
  await expect(diffRegion).toBeVisible();

  // 第 8 步：断言焦点进入差异区；Alt+↓/↑ 块导航后指示区仍可见。
  await expectFocusWithin(
    page,
    'section[aria-label*="src/extension.ts"]',
    "Enter 后焦点未进入差异区",
  );
  const position = page.locator(".diff-hunk-position");
  await expect(position).toBeVisible();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(position).toBeVisible();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(position).toBeVisible();

  // 第 9 步：Tab 前进到返回入口并 Enter（全键盘返回，不用鼠标）。
  const backButton = page.getByRole("button", { name: "返回本地修改" });
  await tabTo(page, backButton, 40);
  await expect(backButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "工作副本修改" }),
  ).toBeVisible();

  // 第 10 步：返回后焦点回到列表，合法选择保留（同一组合载荷重新消费）。
  await expectFocusWithin(
    page,
    ".file-list, .file-row",
    "返回后焦点未回到列表",
  );
  await expect(page.locator(".file-row--active")).toContainText("extension.ts");
  await expect(
    page.getByRole("checkbox", { name: "选择 src/extension.ts" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "选择 src/webview/App.svelte" }),
  ).toBeChecked();

  // 第 11 步：Tab 前进到主操作并 Enter 进入提交（数量来自权威选择）。
  const mainOp = page.getByRole("button", { name: /检查并提交所选/ });
  await expect(mainOp).toContainText("（2）");
  await tabTo(page, mainOp, 80);
  await expect(mainOp).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();

  // 第 12 步：断言交接来源行（范围未扩大）。
  const summary = page.getByRole("region", { name: "待提交文件摘要" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("来自本地修改，范围未扩大")).toBeVisible();

  // 第 13 步：Tab 到提交说明框并键盘逐字输入（无 fill、无粘贴鼠标语义）。
  const messageBox = page.getByRole("textbox", { name: "提交说明" });
  await tabTo(page, messageBox, 60);
  await expect(messageBox).toBeFocused();
  await messageBox.pressSequentially("V017-G 键盘全程提交说明", {
    delay: 10,
  });
  await expect(messageBox).toHaveValue("V017-G 键盘全程提交说明");

  // 第 14 步：IME 嵌入（提交说明框）——组合输入期间真实 Enter 不触发预览与意向单。
  // 中文注释：提交框 Ctrl/⌘+Enter 守卫读取按键事件自带的 isComposing 标志
  // （真实浏览器在候选期自动置位，Playwright 注入按键无法复现），此处不断言
  // 该组合键；候选期 Enter 由共享输入逻辑拦截，本步验证真实键盘不断言通过。
  await messageBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("Enter");
  await expect(page.getByText("范围、状态和远端检查已通过")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await messageBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 第 15 步：组合结束后 Ctrl/⌘+Enter 生成预览（键盘直达预览）。
  await expect(messageBox).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();

  // 第 16 步：Tab 到确认入口并 Enter 打开意向单（到确认前止步，不按确认）。
  const openIntent = page.getByRole("button", { name: /确认提交/ });
  await expect(openIntent).toBeEnabled();
  await tabTo(page, openIntent, 60);
  await expect(openIntent).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("提交 2 个文件").first()).toBeVisible();
  await expect(dialog.getByText("影响 2 个路径")).toBeVisible();
  await expect(dialog.locator(".button--primary")).toHaveCount(1);
  const confirmBtn = dialog.getByRole("button", { name: /确认提交/ });
  await expect(confirmBtn).toBeVisible();
  await expect(confirmBtn).toBeEnabled();

  // 第 17 步：IME 嵌入（意向单）——组合输入期间真实 Enter 不触发确认，对话框保持打开。
  await dialog.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(confirmBtn).toBeEnabled();
  await dialog.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 第 18 步：Esc 关闭意向单并返回触发点（确认前止步，全程未执行写操作）。
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(openIntent).toBeFocused();
});

test("V017-G(PATH-2)：冲突编辑→保存→Resolve 确认前键盘全程", async ({
  page,
}) => {
  // 中文注释：捕获 mock 动作，只校验检查点动作是否发出（不触碰凭据与内容）。
  await page.addInitScript(() => {
    (window as unknown as { __keyboardActions: string[] }).__keyboardActions =
      [];
    window.addEventListener("svn-workbench:mock-action", (event: Event) => {
      const action = (event as CustomEvent).detail?.payload?.action;
      if (typeof action === "string") {
        (
          window as unknown as { __keyboardActions: string[] }
        ).__keyboardActions.push(action);
      }
    });
  });
  const capturedActions = (): Promise<string[]> =>
    page.evaluate(
      () =>
        (window as unknown as { __keyboardActions: string[] })
          .__keyboardActions ?? [],
    );
  const clearCaptured = (): Promise<void> =>
    page.evaluate(() => {
      (window as unknown as { __keyboardActions: string[] }).__keyboardActions =
        [];
    });

  // 第 1 步：进入冲突模块（10 块载荷，块导航进度可断言）。
  await page.goto("/?module=conflicts&conflictBlocks=10");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  const blockProgress = page.getByTestId("block-progress");
  await expect(blockProgress).toContainText("块 1/10");

  // 第 2 步：初始焦点在冲突处理区（挂载即聚焦，无需鼠标）。
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "初始焦点不在冲突处理区",
  );

  // 第 3 步：Alt+↓/↑ 块导航（方向键），进度切换且焦点不离开冲突区。
  await page.keyboard.press("Alt+ArrowDown");
  await expect(blockProgress).toContainText("块 2/10");
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "块导航后焦点离开冲突区",
  );
  await page.keyboard.press("Alt+ArrowUp");
  await expect(blockProgress).toContainText("块 1/10");

  // 第 4 步：IME 嵌入（筛选框）——组合输入期间 Enter 不触发（无菜单无跳转）。
  // 中文注释：焦点在区首时一次 Tab 即到筛选框（Tab 顺序第 1 位，确定性强）。
  const filterBox = page.getByRole("textbox", { name: "筛选冲突文件" });
  await page.keyboard.press("Tab");
  await expect(filterBox).toBeFocused();
  await filterBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("Enter");
  await expect(blockProgress).toContainText("块 1/10");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await filterBox.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 第 5 步：Tab 到首个块级“采用我的修改”并 Enter（键盘块编辑，进合并草稿）。
  const firstTake = page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first();
  await tabTo(page, firstTake, 80);
  await expect(firstTake).toBeFocused();
  await page.keyboard.press("Enter");

  // 第 6 步：保存入口可用（块编辑已进草稿）；进度因解决一块而变化；焦点仍在区内。
  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await expect(saveButton).toBeEnabled({ timeout: 15000 });
  await expect
    .poll(() => blockProgress.textContent(), { timeout: 8000 })
    .not.toBe("块 1/10");
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "块采用后焦点离开冲突区",
  );

  // 第 7 步：IME 嵌入（合并结果区）——组合输入期间 Ctrl/⌘+S 不写检查点。
  // 中文注释：立即断言（与 V014-F1 IME 即时断言同口径），阳性恢复见下一步。
  const editorHost = page.getByTestId("conflict-result-editor-host");
  await expect(editorHost).toBeVisible();
  await clearCaptured();
  await editorHost.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("ControlOrMeta+s");
  expect(
    (await capturedActions()).filter(
      (action) => action === "conflict/draft-checkpoint",
    ),
  ).toEqual([]);
  await editorHost.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });

  // 第 8 步：组合结束后 Ctrl/⌘+S 写检查点（阳性对照，状态条播报已保存）。
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => capturedActions(), { timeout: 8000 })
    .toContain("conflict/draft-checkpoint");
  await expect(page.getByTestId("checkpoint-status")).toContainText("已保存");

  // 第 9 步：Shift+Tab 回退到保存入口并 Enter（键盘保存到工作副本，不执行 Resolve）。
  // 中文注释：焦点在块列表区，正向 Tab 会进入 pierre 编辑器宿主（消费 Tab 作缩进
  // 且 Esc 不移出，见遗留观察项），故用标准 Shift+Tab 同模块回退，全程无鼠标。
  await shiftTabTo(page, saveButton, 100);
  await expect(saveButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
  ).toBeVisible({ timeout: 15000 });

  // 第 10 步：Tab 到解决确认折叠区并 Space 展开（原生 summary 键盘语义）。
  const helpSummary = page
    .locator('[data-testid="conflict-help-details"] summary')
    .first();
  await tabTo(page, helpSummary, 120);
  const helpOpen = await page
    .getByTestId("conflict-help-details")
    .evaluate((element) => (element as HTMLDetailsElement).open)
    .catch(() => true);
  if (!helpOpen) {
    await page.keyboard.press(" ");
    await expect(
      page.getByRole("button", { name: "生成解决预览" }),
    ).toBeVisible();
  }

  // 第 11 步：Tab 到生成解决预览并 Enter，到 Resolve 确认前止步（不按确认）。
  const previewButton = page.getByRole("button", {
    name: "生成解决预览",
  });
  await expect(previewButton).toBeVisible();
  await tabTo(page, previewButton, 60);
  await expect(previewButton).toBeFocused();
  await page.keyboard.press("Enter");
  const resolveConfirm = page.getByRole("button", {
    name: "确认使用当前工作副本内容并标记解决",
  });
  await expect(resolveConfirm).toBeVisible();
  await expect(resolveConfirm).toBeEnabled();
});
