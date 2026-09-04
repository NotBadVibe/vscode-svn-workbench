import { expect, test } from "@playwright/test";

/*
 * V017-C · 焦点往返 e2e（A2 焦点图缺口 T6 冒烟）。
 * - T6：模块打开后焦点不在 body，落在模块主区（section tabindex=-1）；
 *   切换模块后落到新模块主区。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout 死等；断言平台无关。
 */

test("V017-C(1)：模块主区落点聚焦（changes→diff 切换不掉到 body）", async ({
  page,
}) => {
  await page.goto("/?module=changes");
  const changesSection = page.locator("section.feature-layout");
  await expect(changesSection).toHaveCount(1);
  await expect(changesSection).toHaveAttribute("tabindex", "-1");
  // 初次打开：焦点进入 Changes 主区内，不在 body。
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body &&
          !!document.activeElement.closest("section.feature-layout"),
      ),
    )
    .toBe(true);

  // 切换模块：焦点落到新模块主区。
  await page.goto("/?module=diff");
  const diffSection = page.locator("section.diff-feature");
  await expect(diffSection).toHaveCount(1);
  await expect(diffSection).toHaveAttribute("tabindex", "-1");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body &&
          !!document.activeElement.closest("section.diff-feature"),
      ),
    )
    .toBe(true);
});

test("V017-C(2)：冲突模块主区同样可聚焦落点", async ({ page }) => {
  await page.goto("/?module=conflicts");
  const conflictSection = page.locator("section.conflict-layout");
  await expect(conflictSection).toHaveCount(1);
  await expect(conflictSection).toHaveAttribute("tabindex", "-1");
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body &&
          !!document.activeElement.closest("section.conflict-layout"),
      ),
    )
    .toBe(true);
});
