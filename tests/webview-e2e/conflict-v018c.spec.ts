/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "@playwright/test";

/**
 * V018-C 冲突大文件降级 e2e：大冲突打开不冻结 + 降级可见。
 * - 100 块（精简档）：首屏可操作 + 降级摘要可见 + 恢复出口可用。
 * - 500 块（简化档）：页面保持响应 + 简化出口可见，切换保留草稿。
 * 断言平台无关（只用可见文本/testid，不用计时硬门禁）。
 */
test.describe("V018-C 大冲突降级", () => {
  test("120 块精简档：可操作 + 降级原因/模式/恢复出口可见", async ({
    page,
  }) => {
    await page.goto("/?module=conflicts&conflictBlocks=120", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible(
      { timeout: 30000 },
    );
    // 首个可操作冲突（块动作按钮出现即未冻结）
    await expect(
      page.getByRole("button", { name: "采用我的修改" }).first(),
    ).toBeVisible({ timeout: 30000 });
    const summary = page.getByTestId("conflict-perf-summary");
    await expect(summary).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId("conflict-perf-mode")).toContainText(
      "精简视图",
    );
    // 恢复出口可用：强制完整视图后可再回到降级视图
    await page.getByTestId("restore-full-perf").click();
    await expect(page.getByTestId("restore-perf-perf")).toBeVisible();
    await page.getByTestId("restore-perf-perf").click();
    await expect(page.getByTestId("conflict-perf-summary")).toBeVisible();
  });

  test("500 块简化档：不冻结 + 简化出口 + 切换保留草稿", async ({ page }) => {
    const actions: any[] = [];
    await page.exposeFunction("__noop", () => {});
    await page.addInitScript(() => {
      (window as any).__capturedActions = [];
      window.addEventListener("svn-workbench:mock-action", (event: Event) => {
        (window as any).__capturedActions.push((event as CustomEvent).detail);
      });
    });
    await page.goto(
      "/?module=conflicts&conflictBlocks=500&conflictLines=12000",
      {
        waitUntil: "domcontentloaded",
      },
    );
    await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible(
      { timeout: 60000 },
    );
    await expect(page.getByTestId("conflict-perf-summary")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByTestId("conflict-perf-mode")).toContainText(
      "简化编辑器",
    );
    // 页面仍响应：外部工具出口可点击且只发 open-file
    await page.getByTestId("open-external-perf").click();
    // 使用简化编辑器：切换后草稿提示保留
    await page.getByTestId("use-simplified-perf").click();
    await expect(page.getByTestId("simplified-fallback-notice")).toBeVisible();
    const captured = await page.evaluate(
      () => (window as any).__capturedActions ?? [],
    );
    void actions;
    const resolveHit = (captured as any[]).some((item) => {
      const action =
        (item as any).payload?.action ?? (item as any).action ?? "";
      return typeof action === "string" && action.includes("conflict/resolve");
    });
    expect(resolveHit).toBe(false);
  });
});
