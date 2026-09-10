import { expect, test, type Locator, type Page } from "@playwright/test";

/*
 * V027-R52+R54 · 保存语义统一 + 编辑区到保存确认完整键盘路径（自动化部分）。
 * 中文注释：全程只用 page.keyboard（无 click/check/fill/dblclick），按键使用
 * ControlOrMeta 保持平台无关，不用 waitForTimeout；断言平台无关。
 * 真实读屏与 200%/三主题目视按计划列入人工观察项，此处不冒充。
 *
 * - R52-1「检查点≠写盘」：Ctrl/⌘+S 只发 conflict/draft-checkpoint（磁盘语义不变），
 *   Ctrl/⌘+Enter 发 conflict/save-working（与保存按钮同一动作），全程不发 resolve。
 * - R54-1「完整键盘链」：从非首文件进入 → 块编辑 → Esc 正向离开编辑区（旧陷阱：
 *   正向 Tab 被缩进消费）→ Ctrl/⌘+Enter 保存 → 生成解决预览 → 打开 Resolve 确认
 *   → Esc 取消并焦点返回触发点；IME 候选期间 Esc/Enter 不退出任务。
 * - R52-2「保存失败」：?conflictSave=fail 下 Ctrl/⌘+Enter 失败后仍可编辑与导出。
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

// 中文注释：纯键盘 Tab 前进直到焦点进入指定容器（用于进入编辑器宿主等无稳定
// 内部定位的容器）；同时若已到达保存按钮则停（避免越过目标区死循环，由调用方判定）。
async function tabUntilFocusWithin(
  page: Page,
  selector: string,
  label: string,
  maxTabs = 60,
): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    const within = await page
      .evaluate((sel) => {
        const active = document.activeElement as HTMLElement | null;
        return active ? active.closest(sel) !== null : false;
      }, selector)
      .catch(() => false);
    if (within) return;
    await page.keyboard.press("Tab");
  }
  await expectFocusWithin(page, selector, label);
}

// 中文注释：陷阱感知 Tab 前进：正向 Tab 会被编辑器宿主吞作缩进，
// 经过宿主时先 Esc 离开（落到保存栏，后续 Tab 不再回头），再继续前进。
async function tabToTrapAware(
  page: Page,
  target: Locator,
  maxTabs = 120,
): Promise<void> {
  const hostSelector = '[data-testid="conflict-result-editor-host"]';
  for (let index = 0; index < maxTabs; index += 1) {
    const focused = await target
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) return;
    const withinHost = await page
      .evaluate((sel) => {
        const active = document.activeElement as HTMLElement | null;
        return active ? active.closest(sel) !== null : false;
      }, hostSelector)
      .catch(() => false);
    if (withinHost) await page.keyboard.press("Escape");
    else await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function installActionCapture(page: Page): Promise<void> {
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
}

function capturedActions(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __keyboardActions: string[] })
        .__keyboardActions ?? [],
  );
}

function clearCaptured(page: Page): Promise<void> {
  return page.evaluate(() => {
    (window as unknown as { __keyboardActions: string[] }).__keyboardActions =
      [];
  });
}

// 中文注释：回到保存按钮（陷阱感知）：若焦点在编辑器宿主内先 Esc 离开
// （正向 Tab 会被缩进消费），否则 Tab 前进；上限防止死循环。
async function ensureSaveFocused(
  page: Page,
  saveButton: Locator,
  maxRounds = 12,
): Promise<void> {
  const hostSelector = '[data-testid="conflict-result-editor-host"]';
  for (let index = 0; index < maxRounds; index += 1) {
    const focused = await saveButton
      .evaluate((element) => element === document.activeElement)
      .catch(() => false);
    if (focused) return;
    const withinHost = await page
      .evaluate((sel) => {
        const active = document.activeElement as HTMLElement | null;
        return active ? active.closest(sel) !== null : false;
      }, hostSelector)
      .catch(() => false);
    if (withinHost) await page.keyboard.press("Escape");
    else await page.keyboard.press("Tab");
  }
  await expect(saveButton).toBeFocused();
}

test("V027-R52：Ctrl+S 仅检查点、Ctrl+Enter 写盘、全程不接 Resolve", async ({
  page,
}) => {
  await installActionCapture(page);
  await page.goto("/?module=conflicts&conflictBlocks=10");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  const blockProgress = page.getByTestId("block-progress");
  await expect(blockProgress).toContainText("块 1/10");

  // 迁移提示常驻可见：逐项说清对象（检查点≠写盘）。
  const note = page.getByTestId("save-semantics-note");
  await expect(note).toContainText("仅保存会话检查点");
  await expect(note).toContainText("不写入工作副本文件");

  // 块编辑进草稿（键盘）：保存入口可用。
  const firstTake = page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first();
  await tabTo(page, firstTake, 80);
  await page.keyboard.press("Enter");
  const saveButton = page.getByTestId("save-working-copy");
  await expect(saveButton).toBeEnabled({ timeout: 15000 });

  // Ctrl/⌘+S：只发检查点，不写盘、不接 Resolve。
  await clearCaptured(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect
    .poll(() => capturedActions(page), { timeout: 8000 })
    .toContain("conflict/draft-checkpoint");
  expect(await capturedActions(page)).not.toContain("conflict/save-working");
  expect(await capturedActions(page)).not.toContain("conflict/resolve");
  await expect(page.getByTestId("checkpoint-status")).toContainText("已保存");

  // Ctrl/⌘+Enter：与保存按钮同一动作写盘，仍不接 Resolve。
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
  ).toBeVisible({ timeout: 15000 });
  expect(await capturedActions(page)).toContain("conflict/save-working");
  expect(await capturedActions(page)).not.toContain("conflict/resolve");
  expect(await capturedActions(page)).not.toContain("conflict/preview-resolve");
});

test("V027-R54：非首文件进入→编辑→Esc 离开→保存→预览→确认→取消全键盘", async ({
  page,
}) => {
  await installActionCapture(page);
  await page.goto("/?module=conflicts&conflicts=multi&conflictBlocks=10");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "初始焦点不在冲突处理区",
  );

  // 从非首文件进入：方向键到 b.ts，Enter 选中。
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText("src/conflict/b.ts").first()).toBeVisible();
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "选文件后焦点离开冲突区",
  );

  // 块编辑进草稿（键盘）。
  const firstTake = page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first();
  await tabTo(page, firstTake, 80);
  await expect(firstTake).toBeFocused();
  await page.keyboard.press("Enter");
  const saveButton = page.getByTestId("save-working-copy");
  await expect(saveButton).toBeEnabled({ timeout: 15000 });

  // 正向进入编辑器宿主（旧陷阱：Tab 被缩进消费），Esc 正向离开到保存栏，无需鼠标。
  await tabUntilFocusWithin(
    page,
    '[data-testid="conflict-result-editor-host"]',
    "正向 Tab 未进入编辑器宿主",
  );
  // IME 嵌入：候选期间 Esc 不离开编辑区、不退出任务。
  const editorHost = page.getByTestId("conflict-result-editor-host");
  await editorHost.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
  });
  await page.keyboard.press("Escape");
  await expect(saveButton).not.toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await editorHost.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true }),
    );
  });
  // 候选结束后 Esc 离开编辑区，焦点到保存栏。
  await page.keyboard.press("Escape");
  await expect(saveButton).toBeFocused();

  // 反向可离：从保存栏 Shift+Tab 回退仍在保存栏组内（无键盘陷阱）。
  await page.keyboard.press("Shift+Tab");
  await expectFocusWithin(
    page,
    'section[aria-label="冲突处理"]',
    "Shift+Tab 后焦点离开冲突区",
  );

  // 回到保存按钮并 Ctrl/⌘+Enter 保存（键盘写盘，陷阱感知）。
  await ensureSaveFocused(page, saveButton);
  await expect(saveButton).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
  ).toBeVisible({ timeout: 15000 });

  // 生成解决预览 → 到 Resolve 确认前（不执行 Resolve）。
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
  }
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

  // 进入 Resolve 确认（意向单）再 Esc 取消：关闭回原触发点，未执行 Resolve。
  await tabToTrapAware(page, resolveConfirm, 120);
  await expect(resolveConfirm).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "标记解决 1 个冲突" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(resolveConfirm).toBeFocused();
  expect(await capturedActions(page)).not.toContain("conflict/resolve");
});

test("V027-R52：保存失败后继续可编辑与导出", async ({ page }) => {
  await page.goto("/?module=conflicts&conflictBlocks=10&conflictSave=fail");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();

  const firstTake = page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first();
  await tabTo(page, firstTake, 80);
  await page.keyboard.press("Enter");
  const saveButton = page.getByTestId("save-working-copy");
  await expect(saveButton).toBeEnabled({ timeout: 15000 });

  // 键盘保存失败：失败明示，编辑器与草稿保留，复制/导出可用。
  // 中文注释：块列表正向 Tab 会先进入编辑器宿主（缩进陷阱），先 Esc 离开再保存。
  await tabUntilFocusWithin(
    page,
    '[data-testid="conflict-result-editor-host"]',
    "正向 Tab 未进入编辑器宿主",
  );
  await page.keyboard.press("Escape");
  await expect(saveButton).toBeFocused();
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByText(/保存失败/).first()).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByTestId("conflict-result-editor-host")).toBeVisible();
  await expect(page.getByTestId("copy-draft")).toBeEnabled();
  await expect(page.getByTestId("export-draft")).toBeEnabled();
});
