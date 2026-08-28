/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test, type Page } from "@playwright/test";

const PRODUCTION_EQUIVALENT_CSP =
  "default-src 'none'; img-src 'self' data:; font-src 'self'; " +
  "style-src 'self'; script-src 'self'; connect-src 'none'";

interface ViolationRecord {
  directive: string;
  sample: string;
}

async function setupCspCollector(page: Page) {
  await page.addInitScript(() => {
    const violations: ViolationRecord[] = [];
    (
      window as unknown as { __cspViolations: ViolationRecord[] }
    ).__cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.effectiveDirective,
        sample: event.sample ?? "",
      });
    });
  });
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if ((headers["content-type"] ?? "").includes("text/html")) {
      headers["content-security-policy"] = PRODUCTION_EQUIVALENT_CSP;
    }
    await route.fulfill({ response, headers });
  });
}

async function collectViolations(page: Page): Promise<ViolationRecord[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __cspViolations: ViolationRecord[] })
        .__cspViolations,
  );
}

async function setupMockCapture(page: Page) {
  await page.addInitScript(() => {
    (window as any).__capturedActions = [];
    window.addEventListener("svn-workbench:mock-action", (event: Event) => {
      const detail = (event as CustomEvent).detail;
      (window as any).__capturedActions.push(detail);
    });
  });
}

async function getCapturedActions(
  page: Page,
): Promise<Record<string, unknown>[]> {
  return page.evaluate(() => (window as any).__capturedActions ?? []);
}

async function clearCapturedActions(page: Page) {
  await page.evaluate(() => {
    (window as any).__capturedActions = [];
  });
}

function hasWriteAction(actions: Record<string, unknown>[]): boolean {
  return actions.some((item) => {
    const payload = item.payload as { action?: string } | undefined;
    const action = payload?.action ?? (item.action as string | undefined) ?? "";
    if (typeof action !== "string") return false;
    return (
      action.includes("save-working") ||
      action.includes("resolve") ||
      action.includes("commit/execute") ||
      action.includes("commit/preview")
    );
  });
}

async function assertNoHorizontalOverflow(page: Page) {
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

test.describe("V011-F 冲突 Webview E2E 自动化验收", () => {
  test("1：三种结果草稿可见且不触发 Host 写操作", async ({ page }) => {
    await setupMockCapture(page);
    await page.goto("/?module=conflicts");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
    await expect(page.getByTestId("block-progress")).toBeVisible();
    const editorContent = page.locator(".conflict-codemirror-host .cm-content");
    await expect(editorContent).toBeVisible();
    await clearCapturedActions(page);
    const mineButton = page
      .getByRole("button", { name: "采用我的修改" })
      .first();
    await expect(mineButton).toBeVisible();
    await mineButton.click();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
      timeout: 15000,
    });
    await expect(editorContent).toContainText("local");
    let actions = await getCapturedActions(page);
    expect(
      hasWriteAction(actions),
      "采用我的修改不应触发 save-working/resolve/commit",
    ).toBe(false);
    expect(
      actions.some(
        (a) =>
          (a.payload as { action?: string } | undefined)?.action ===
          "conflict/draft-update",
      ),
    ).toBe(true);
    await clearCapturedActions(page);
    await page.goto("/?module=conflicts");
    await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
    await expect(editorContent).toBeVisible();
    await clearCapturedActions(page);
    const theirsButton = page
      .getByRole("button", { name: "采用对方修改" })
      .first();
    await expect(theirsButton).toBeVisible();
    await theirsButton.click();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
      timeout: 15000,
    });
    await expect(editorContent).toContainText("svelte");
    actions = await getCapturedActions(page);
    expect(hasWriteAction(actions), "采用对方修改不应触发 Host 写操作").toBe(
      false,
    );
    expect(
      actions.some(
        (a) =>
          (a.payload as { action?: string } | undefined)?.action ===
          "conflict/draft-update",
      ),
    ).toBe(true);
    await clearCapturedActions(page);
    await page.goto("/?module=conflicts");
    await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
    await clearCapturedActions(page);
    const bothButton = page.getByRole("button", { name: "保留两者" }).first();
    await expect(bothButton).toBeVisible();
    await bothButton.click();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
      timeout: 15000,
    });
    await expect(editorContent).toContainText("local");
    await expect(editorContent).toContainText("svelte");
    actions = await getCapturedActions(page);
    expect(hasWriteAction(actions), "保留两者不应触发 Host 写操作").toBe(false);
    expect(
      actions.some(
        (a) =>
          (a.payload as { action?: string } | undefined)?.action ===
          "conflict/draft-update",
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "保存工作副本合并结果" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "复制草稿" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "导出草稿" })).toBeEnabled();
    actions = await getCapturedActions(page);
    const forbiddenPreview = actions.filter((a) => {
      const act = (a.payload as { action?: string } | undefined)?.action ?? "";
      return (
        typeof act === "string" &&
        (act === "conflict/save-working" ||
          act === "conflict/preview-resolve" ||
          act === "conflict/resolve")
      );
    });
    expect(forbiddenPreview).toEqual([]);
  });

  test("2：切换文件时草稿三选一不退化", async ({ page }) => {
    await page.goto("/?module=conflicts");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    const theirsButton = page
      .getByRole("button", { name: "采用对方修改" })
      .first();
    await theirsButton.click();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
      timeout: 15000,
    });
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("svn-workbench:mock-action", {
          detail: {
            protocolVersion: 2,
            type: "workbench/action",
            moduleId: "conflicts",
            taskId: "conflicts/resolve",
            sessionId: "mock-session-id",
            repositoryUuid: "mock-repository-uuid",
            scopeHash: "mock-scope-hash",
            payload: {
              action: "conflict/select",
              data: { relativePath: "src/conflict/other.ts" },
            },
          },
        }),
      );
    });
    const dialog = page.getByRole("dialog", { name: "未保存草稿处理" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/30 秒未选择将自动保存检查点并继续/),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "保存检查点并继续" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "留在当前文件" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "放弃草稿" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "留在当前文件" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "保存工作副本合并结果" }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent("svn-workbench:mock-action", {
          detail: {
            protocolVersion: 2,
            type: "workbench/action",
            moduleId: "conflicts",
            taskId: "conflicts/resolve",
            sessionId: "mock-session-id",
            repositoryUuid: "mock-repository-uuid",
            scopeHash: "mock-scope-hash",
            payload: {
              action: "conflict/select",
              data: { relativePath: "src/conflict/other.ts" },
            },
          },
        }),
      );
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "放弃草稿" }).click();
    await expect(dialog).not.toBeVisible();
  });

  test("3：故障降级 damaged / binary / truncated / missing 均出现 fallback 且草稿保留", async ({
    page,
  }) => {
    await test.step("damaged 场景", async () => {
      await page.goto("/?module=conflicts&conflictScenario=damaged");
      await expect(page.getByTestId("conflict-fallback-warning")).toBeVisible();
      await expect(page.getByText("差异视图暂不可用")).toBeVisible();
      await expect(page.getByTestId("use-simple-editor")).toBeVisible();
      // export-draft-fallback 仅在有草稿时可见（damaged 初始无草稿时不强制）
      const exportFallback = page.getByTestId("export-draft-fallback");
      if ((await exportFallback.count()) > 0) {
        await expect(exportFallback).toBeVisible();
      }
      await expect(page.getByTestId("open-in-editor-fallback")).toBeVisible();
      await expect(page.getByText(/草稿/).first()).toBeVisible();
      await page.getByTestId("use-simple-editor").click();
      await expect(
        page.getByTestId("simplified-fallback-notice"),
      ).toBeVisible();
      await expect(page.getByText(/草稿已保留/)).toBeVisible();
    });
    await test.step("binary 场景", async () => {
      await page.goto("/?module=conflicts&conflictScenario=binary");
      await expect(page.getByTestId("content-fallback-warning")).toBeVisible();
      await expect(page.getByText("内容暂不可用")).toBeVisible();
      await expect(page.getByText(/二进制文件不支持内嵌合并/)).toBeVisible();
      await expect(page.getByTestId("use-simple-editor-content")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "在编辑器中打开" }).first(),
      ).toBeVisible();
      await expect(page.getByText(/草稿/).first()).toBeVisible();
      await page.getByTestId("use-simple-editor-content").click();
      await expect(
        page.getByTestId("simplified-fallback-notice"),
      ).toBeVisible();
    });
    await test.step("truncated 场景", async () => {
      await page.goto("/?module=conflicts&conflictScenario=truncated");
      await expect(page.getByTestId("content-fallback-warning")).toBeVisible();
      await expect(page.getByText("内容暂不可用")).toBeVisible();
      await expect(page.getByTestId("use-simple-editor-content")).toBeVisible();
      await expect(page.getByText(/草稿/).first()).toBeVisible();
      await page.getByTestId("use-simple-editor-content").click();
      await expect(
        page.getByTestId("simplified-fallback-notice"),
      ).toBeVisible();
    });
    await test.step("missing 场景", async () => {
      await page.goto("/?module=conflicts&conflictScenario=missing");
      await expect(page.getByTestId("content-fallback-warning")).toBeVisible();
      await expect(page.getByText("内容暂不可用")).toBeVisible();
      await expect(page.getByTestId("use-simple-editor-content")).toBeVisible();
      await expect(page.getByText(/草稿/).first()).toBeVisible();
      await page.getByTestId("use-simple-editor-content").click();
      await expect(
        page.getByTestId("simplified-fallback-notice"),
      ).toBeVisible();
    });
  });

  test("4：720×480 小高度下顶部导航、角色条、块进度、草稿区可达且主体有滚动归属", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    await page.goto("/?module=conflicts&dataset=scroll");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "冲突导航" });
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("button", { name: "上一个文件" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "下一个文件" })).toBeVisible();
    const roleBar = page.getByTestId("conflict-role-bar");
    await expect(roleBar).toBeVisible();
    await expect(roleBar.getByText("我的修改（本地）")).toBeVisible();
    await expect(roleBar.getByText("对方修改（仓库）")).toBeVisible();
    await expect(roleBar.getByText("共同基线（BASE）")).toBeVisible();
    await expect(roleBar.getByText("合并结果")).toBeVisible();
    const blockProgress = page.getByTestId("block-progress");
    await expect(blockProgress).toBeVisible();
    await expect(blockProgress).toHaveText(/块 \d+\/\d+/);
    const workspace = page.getByRole("region", { name: "冲突处理工作区" });
    await expect(workspace).toBeVisible();
    await expect(workspace).toHaveAttribute("data-scroll-region", "");
    const metrics = await workspace.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      tabIndex: element.getAttribute("tabindex"),
    }));
    expect(["auto", "scroll"]).toContain(metrics.overflowY);
    expect(metrics.tabIndex).toBe("0");
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
    const saveButton = page.getByRole("button", {
      name: "保存工作副本合并结果",
    });
    await expect(page.getByText(/工作副本/).first()).toBeVisible();
    await saveButton.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeVisible();
    await workspace.focus();
    await expect(workspace).toBeFocused();
    await workspace.press("PageDown");
    const afterScroll = await workspace.evaluate(
      (element) => element.scrollTop,
    );
    expect(afterScroll).toBeGreaterThan(0);
    await workspace.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(saveButton).toBeVisible();
    await nav.scrollIntoViewIfNeeded();
    await expect(nav).toBeVisible();
    await expect(roleBar).toBeVisible();
    await expect(blockProgress).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("5：严格 CSP 生产等价构建下冲突页零违规", async ({ page }) => {
    await setupCspCollector(page);
    await page.goto("/?module=conflicts");
    await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
    await expect(page.getByTestId("block-progress")).toBeVisible();
    await page.waitForFunction(() => {
      const container = document.querySelector("diffs-container");
      if (!container || !container.shadowRoot) return false;
      return container.shadowRoot.adoptedStyleSheets.length > 0;
    });
    const styling = await page.evaluate(() => {
      const container = document.querySelector("diffs-container");
      const root = container?.shadowRoot;
      if (!root) return { adoptedSheets: -1, hasSpans: false };
      const spans = Array.from(root.querySelectorAll("span"));
      return {
        adoptedSheets: root.adoptedStyleSheets.length,
        hasSpans: spans.length > 0,
      };
    });
    expect(styling.adoptedSheets).toBeGreaterThan(0);
    const violations = await collectViolations(page);
    expect(violations, "严格 CSP 下冲突页不应产生违规").toEqual([]);
    await page.getByRole("button", { name: "采用我的修改" }).first().click();
    await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
      timeout: 15000,
    });
    expect(await collectViolations(page)).toEqual([]);
  });

  test("6：块导航键盘可达且焦点不丢", async ({ page }) => {
    await page.goto("/?module=conflicts");
    await expect(page.getByTestId("block-progress")).toBeVisible();
    const prevButton = page.getByRole("button", { name: "上一个冲突块" });
    const nextButton = page.getByRole("button", { name: "下一个冲突块" });
    await expect(prevButton).toBeVisible();
    await expect(nextButton).toBeVisible();
    await expect(prevButton).toBeEnabled();
    await expect(nextButton).toBeEnabled();
    await prevButton.focus();
    await expect(prevButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(nextButton).toBeFocused();
    const beforeProgress = await page
      .getByTestId("block-progress")
      .textContent();
    await page.keyboard.press("Enter");
    await expect(nextButton).toBeFocused();
    const afterProgress = await page
      .getByTestId("block-progress")
      .textContent();
    expect(afterProgress).toBe(beforeProgress);
    await page.keyboard.press("Shift+Tab");
    await expect(prevButton).toBeFocused();
    await page.keyboard.press(" ");
    await expect(prevButton).toBeFocused();
    await nextButton.click();
    await expect(nextButton).toBeFocused();
    await expect(page.getByTestId("block-progress")).toBeVisible();
    await page.keyboard.press("Tab");
    const focusedAfterTab = await page.evaluate(
      () => document.activeElement?.textContent ?? "",
    );
    expect(focusedAfterTab.length).toBeGreaterThan(0);
    await prevButton.focus();
    await page.keyboard.press("ArrowDown");
    // ArrowDown 在块导航区不强制移动焦点，只需保证焦点未丢失到 body
    await expect(
      page.evaluate(() => document.activeElement?.tagName !== "BODY"),
    ).resolves.toBe(true);
  });
});
