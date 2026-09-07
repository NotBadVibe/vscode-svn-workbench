import { expect, test, type Page } from "@playwright/test";

/**
 * V020-R01 · 大冲突简化编辑器连续输入丢焦点回归。
 *
 * 背景（v0.1.8 G1 实证遗留）：500 块/12000 行简化编辑器每次草稿回环
 * （Host 快照）后焦点回到 BODY，连续键盘键入第二字起被吞；v018g 只用
 * 单次粘贴原子落稿，未证明逐键输入正常。
 *
 * 本文件全部使用真实连续键入（pressSequentially 逐键事件），不用 fill，
 * 不用重聚焦循环掩盖问题；断言平台无关（文本/testid/角色，无像素、
 * 无毫秒硬门禁，无 waitForTimeout）。
 */

interface CapturedMockAction {
  payload?: {
    action?: unknown;
    data?: { content?: unknown; relativePath?: unknown };
  };
}

async function setupCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (
      window as unknown as { __capturedActions?: CapturedMockAction[] }
    ).__capturedActions = [];
    window.addEventListener("svn-workbench:mock-action", (event: Event) => {
      const detail = (event as CustomEvent).detail as CapturedMockAction;
      (
        window as unknown as { __capturedActions?: CapturedMockAction[] }
      ).__capturedActions?.push(detail);
    });
  });
}

async function getActions(page: Page): Promise<CapturedMockAction[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __capturedActions?: CapturedMockAction[] })
        .__capturedActions ?? [],
  );
}

/** 最近一次指定动作携带的 content（字符串），找不到返回 undefined。 */
async function lastActionContent(
  page: Page,
  actionName: string,
): Promise<string | undefined> {
  const actions = await getActions(page);
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const item = actions[index];
    if (item.payload?.action !== actionName) continue;
    const content = item.payload?.data?.content;
    if (typeof content === "string") return content;
  }
  return undefined;
}

/** 等待草稿回环完成：draft-update 携带给出标记。 */
async function waitDraftEcho(page: Page, marker: string): Promise<void> {
  await expect
    .poll(async () => lastActionContent(page, "conflict/draft-update"), {
      timeout: 30_000,
    })
    .toContain(marker);
}

async function openSimplifiedEditor(page: Page): Promise<void> {
  await page.goto("/?module=conflicts&conflictBlocks=500&conflictLines=12000", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("conflict-perf-summary")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByTestId("use-simplified-perf").click();
  await expect(page.getByTestId("simplified-fallback-notice")).toBeVisible({
    timeout: 30_000,
  });
}

function simplifiedContent(page: Page) {
  return page.locator(".conflict-codemirror-host .cm-content").first();
}

test("V020-R01：500 块/12000 行连续输入 200 字符内容逐字一致且焦点保留", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await setupCapture(page);
  await openSimplifiedEditor(page);

  const editor = simplifiedContent(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click({ position: { x: 20, y: 20 } });
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 真实连续键入：两段各 100 字符，中间等待一次 Host 草稿回环。
  const chunk1 = `v020r01-first-${"Ab3-".repeat(25)}`.slice(0, 100);
  const chunk2 = `v020r01-second-${"Zk9-".repeat(25)}`.slice(0, 100);
  expect(chunk1.length).toBe(100);
  expect(chunk2.length).toBe(100);

  await editor.pressSequentially(chunk1, { delay: 10 });
  // 回环到达后焦点必须仍在编辑器（核心回归：此前焦点回到 BODY）。
  await waitDraftEcho(page, chunk1.slice(-12));
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 停顿后续写：第二段同样逐键键入。
  await editor.pressSequentially(chunk2, { delay: 10 });
  await waitDraftEcho(page, chunk2.slice(-12));
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 内容逐字一致：最后一次 draft-update 携带完整 200 字符序列。
  const full = `${chunk1}${chunk2}`;
  await expect
    .poll(async () => lastActionContent(page, "conflict/draft-update"), {
      timeout: 30_000,
    })
    .toContain(full);
  console.log(`V020R01-CONTINUOUS-200 ok len=${full.length} focused=true`);
  expect(pageErrors).toEqual([]);
});

test("V020-R01：中文 composition 中 Enter 不触发确认，候选完成后正文一致", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await setupCapture(page);
  await openSimplifiedEditor(page);

  const editor = simplifiedContent(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click({ position: { x: 20, y: 20 } });
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 进入中文候选：合成 compositionstart（经冒泡触发模块 IME 守卫）。
  await editor.evaluate((node) => {
    node.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
  });
  // 候选阶段按 Enter：不得触发保存/确认，不得发出写操作。
  await page.keyboard.press("Enter");
  await editor.evaluate((node) => {
    node.dispatchEvent(
      new CompositionEvent("compositionend", { data: "中文候选" }),
    );
  });
  const afterEnter = await getActions(page);
  const writeActions = afterEnter.filter((item) =>
    [
      "conflict/save-working",
      "conflict/preview-resolve",
      "conflict/execute-resolve",
    ].includes(item.payload?.action as string),
  );
  expect(
    writeActions,
    "composition 中 Enter 不得触发保存/确认类写操作",
  ).toEqual([]);
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 候选完成后真实键入，正文一致且回环同步。
  const marker = "v020r01-ime-done-候选完成";
  await editor.pressSequentially(marker, { delay: 10 });
  await waitDraftEcho(page, "v020r01-ime-done-");
  const synced = await lastActionContent(page, "conflict/draft-update");
  expect(synced).toContain(marker);
  console.log(`V020R01-IME ok marker=${marker}`);
  expect(pageErrors).toEqual([]);
});

test("V020-R01：undo/redo、模块切换返回、保存后草稿不丢", async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await setupCapture(page);
  await openSimplifiedEditor(page);

  const editor = simplifiedContent(page);
  await expect(editor).toBeVisible({ timeout: 30_000 });
  await editor.click({ position: { x: 20, y: 20 } });
  await expect(editor).toBeFocused({ timeout: 15_000 });

  const marker = "v020r01-undo-marker-987654321";
  await editor.pressSequentially(marker, { delay: 5 });
  await waitDraftEcho(page, marker.slice(-10));

  // undo：撤销键入，草稿同步为撤销后内容，焦点保留。
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => lastActionContent(page, "conflict/draft-update"), {
      timeout: 30_000,
    })
    .toBeDefined();
  const afterUndo = await lastActionContent(page, "conflict/draft-update");
  expect(afterUndo?.includes(marker)).toBe(false);
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // redo：恢复键入，草稿同步恢复，焦点保留。
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await waitDraftEcho(page, marker.slice(-10));
  await expect(editor).toBeFocused({ timeout: 15_000 });

  // 模块切换再返回（同堆 mock-action，不重载页面，Host 内存草稿保留）。
  await page.evaluate(() => {
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
          payload: {
            action: "open-diff",
            data: { relativePath: "src/app.ts" },
          },
        },
      }),
    );
  });
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible({
    timeout: 30_000,
  });
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("svn-workbench:mock-action", {
        detail: {
          protocolVersion: 2,
          type: "workbench/action",
          moduleId: "conflicts",
          taskId: "conflicts/overview",
          sessionId: "mock-session-id",
          repositoryUuid: "mock-repository-uuid",
          scopeHash: "mock-scope-hash",
          payload: { action: "open-module", data: { moduleId: "conflicts" } },
        },
      }),
    );
  });
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible({
    timeout: 30_000,
  });
  // 返回后需重新进入简化编辑器，Host 内存草稿应恢复（含 marker）。
  await expect(page.getByTestId("conflict-perf-summary")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByTestId("use-simplified-perf").click();
  await expect(page.getByTestId("simplified-fallback-notice")).toBeVisible({
    timeout: 30_000,
  });
  const returned = simplifiedContent(page);
  await expect(returned).toContainText(marker.slice(0, 12), {
    timeout: 30_000,
  });

  // 保存后草稿不丢：保存成功且编辑器仍含 marker。
  await returned.click({ position: { x: 20, y: 20 } });
  await expect(returned).toBeFocused({ timeout: 15_000 });
  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await expect(saveButton).toBeEnabled({ timeout: 30_000 });
  await saveButton.click();
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(simplifiedContent(page)).toContainText(marker.slice(0, 12), {
    timeout: 30_000,
  });
  console.log(`V020R01-UNDO-SWITCH-SAVE ok marker=${marker}`);
  expect(pageErrors).toEqual([]);
});
