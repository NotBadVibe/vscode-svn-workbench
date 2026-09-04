import { expect, test } from "@playwright/test";

/*
 * v0.1.8 V018-D：空白选项 + overview/locator e2e（§4.4）。
 * 断言平台无关（可见文本/testid/角色，不用像素与毫秒硬门禁）：
 * - Diff：显示空白图例、忽略空白横幅标注、定位器点击导航同步位置指示。
 * - 冲突：空白切换为纯呈现（无 save/resolve 误发）、定位器键盘可达。
 * - 720×480：定位器可折叠，主编辑区不被永久占用。
 */
test.describe("V018-D 空白与定位器", () => {
  test("Diff：空白开关标注 + 定位器点击导航", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));
    await page.goto("/?module=diff&diffFixture=ts-1000-mid", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".diff-hunk-position")).toBeVisible({
      timeout: 30000,
    });
    // 定位器可见：分布条 + 列表 + 摘要
    await expect(page.getByTestId("diff-overview")).toBeVisible();
    await expect(page.getByTestId("diff-overview-rail")).toBeVisible();
    await expect(page.getByTestId("diff-overview-list")).toBeVisible();

    // 显示空白字符：仅图例，不改内容
    await page.getByRole("button", { name: "显示设置" }).click();
    await page.getByRole("checkbox", { name: /显示空白字符/ }).click();
    await expect(page.getByTestId("show-whitespace-legend")).toBeVisible();
    await expect(page.getByTestId("show-whitespace-legend")).toContainText(
      "最终文本不受影响",
    );

    // 忽略空白：只改比较且明确标注
    const ignoreBox = page.getByRole("checkbox", { name: /忽略空白差异/ });
    if (await ignoreBox.isEnabled()) {
      await ignoreBox.click();
      const banner = page.getByTestId("ignore-whitespace-banner");
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("最终文本不受影响");
    }

    // 定位器点击导航：位置指示同步
    const items = page.getByRole("button", { name: /定位到第/ });
    const count = await items.count();
    if (count >= 2) {
      await items.nth(1).click();
      await expect(page.locator(".diff-hunk-position")).toContainText("2/");
    }
    expect(pageErrors).toEqual([]);
  });

  test("冲突：空白切换不丢草稿 + 定位器键盘可达", async ({ page }) => {
    const captured: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __captured: string[] }).__captured = [];
      window.addEventListener("svn-workbench:mock-action", (event: Event) => {
        const detail = (event as CustomEvent).detail as {
          payload?: { action?: string };
          action?: string;
        };
        const action =
          detail.payload?.action ?? detail.action ?? "unknown-action";
        (window as unknown as { __captured: string[] }).__captured.push(
          String(action),
        );
      });
    });
    await page.goto("/?module=conflicts&conflictBlocks=10", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible(
      { timeout: 30000 },
    );
    await expect(page.getByTestId("diff-overview")).toBeVisible({
      timeout: 30000,
    });
    // 未处理块双通道（文字，不只颜色）
    await expect(page.getByText("◆ 未处理冲突").first()).toBeVisible();

    // 空白切换：横幅标注，且无 save/resolve 误发
    await page.getByRole("checkbox", { name: /显示空白字符/ }).click();
    await expect(page.getByTestId("show-whitespace-legend")).toBeVisible();
    await page.getByRole("checkbox", { name: /忽略空白差异/ }).click();
    await expect(page.getByTestId("ignore-whitespace-banner")).toContainText(
      "最终文本不受影响",
    );
    const actions = await page.evaluate(
      () => (window as unknown as { __captured: string[] }).__captured ?? [],
    );
    expect(actions.some((a) => a.includes("conflict/resolve"))).toBe(false);
    expect(
      actions.some(
        (a) => a.includes("conflict/save-working") && !a.includes("draft"),
      ),
    ).toBe(false);

    // 键盘可达：定位列表聚焦后方向键移动焦点
    const first = page.getByRole("button", { name: /定位到第 1\// });
    await first.focus();
    await expect(first).toBeFocused();
    await page.getByTestId("diff-overview-list").press("ArrowDown");
    await expect(
      page.getByRole("button", { name: /定位到第 2\// }),
    ).toBeFocused();
    void captured;
  });

  test("720×480：定位器可折叠，主编辑区可达", async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 480 });
    await page.goto("/?module=diff&diffFixture=ts-1000-mid", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator(".diff-hunk-position")).toBeVisible({
      timeout: 30000,
    });
    // 主差异区在窄屏纵向堆叠下不得塌陷（Shadow 内容不参与固有宽度）
    const frameWidth = await page
      .locator(".diff-view-frame")
      .evaluate((element) => element.clientWidth);
    expect(frameWidth).toBeGreaterThan(200);
    const toggle = page.getByTestId("diff-overview-toggle");
    await expect(toggle).toBeVisible();
    // 收起后主差异区仍可见且可达
    await toggle.click();
    await expect(page.getByTestId("diff-overview-list")).toHaveCount(0);
    await expect(page.locator(".diff-hunk-position")).toBeVisible();
    // 展开恢复
    await toggle.click();
    await expect(page.getByTestId("diff-overview-list")).toBeVisible();
  });
});
