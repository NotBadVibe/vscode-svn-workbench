import { expect, test } from "@playwright/test";

/*
 * v0.1.8 V018-B：大 Diff 打开不冻结（no-go 下保持 FileDiff 的回归门）。
 *
 * V018-B 决策（diffPerformancePolicy.ts decideV018BRenderer）：虚拟化自动
 * 切换 no-go，默认保持 FileDiff。本用例锁定 5000 行档（完整模式上限阈值）
 * 在生产构建 preview 下可打开、可导航、可滚动、无页面异常；
 * 降级原因可见由 tests/components/DiffModule.test.ts（高亮失败纯文本提示、
 * patch/挂载失败中文降级）覆盖，此处不重复触发失败注入。
 */

test("V018-B：5000 行 Diff 可打开、可导航、可滚动且无页面异常", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/?module=diff&diffFixture=ts-5000-mid", {
    waitUntil: "domcontentloaded",
  });
  // 不冻结：首个可用内容在慷慨超时内出现（预算对照见 evidence，不在此断言毫秒）。
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const container = document.querySelector(
            ".diff-view-frame diffs-container",
          );
          return (container?.shadowRoot?.textContent ?? "").trim().length;
        }),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);

  // 变更块位置可见（导航仍可用）。
  await expect(page.locator(".diff-hunk-position")).toBeVisible();

  // 差异内容区可滚动到底（滚动归属明确，不冻结主线程）。
  const scrolled = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const frame = document.querySelector(".diff-view-frame");
        if (!frame) {
          resolve(false);
          return;
        }
        let current: HTMLElement | null = frame as HTMLElement;
        let scroller: HTMLElement | null = null;
        while (current && current !== document.body) {
          const style = getComputedStyle(current);
          if (
            (style.overflowY === "auto" || style.overflowY === "scroll") &&
            current.scrollHeight > current.clientHeight + 4
          ) {
            scroller = current;
            break;
          }
          current = current.parentElement;
        }
        if (!scroller) {
          resolve(false);
          return;
        }
        scroller.scrollTop = scroller.scrollHeight;
        requestAnimationFrame(() =>
          requestAnimationFrame(() =>
            resolve(
              (scroller as HTMLElement).scrollTop +
                (scroller as HTMLElement).clientHeight >=
                (scroller as HTMLElement).scrollHeight - 4,
            ),
          ),
        );
      }),
  );
  expect(scrolled).toBe(true);

  // 下一处差异导航有响应（目标进入正确滚动区，不抛错）。
  const nextButton = page.getByRole("button", { name: "下一处差异" });
  if (await nextButton.isVisible()) {
    await nextButton.click();
    await expect(page.locator(".diff-hunk-position")).toBeVisible();
  }

  expect(pageErrors).toEqual([]);
});
