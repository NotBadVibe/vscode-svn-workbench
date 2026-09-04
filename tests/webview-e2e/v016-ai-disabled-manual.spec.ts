import { expect, test, type Page } from "@playwright/test";

/*
 * V016-F2(1) · AI 关闭四模块人工路径（§5「AI 未配置核心路径成功率 5/5」）。
 * 只改测试与 mock（mock 只加 `?ai=disabled` 分支，不改旧语义）；不动业务源码。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout；断言平台无关。
 * 每模块：不断言 AI 降级提示墙（无「模型建议」冒充、无阻塞墙），主路径完整可达。
 */

async function setupConsoleCollector(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __consoleErrors: string[] }).__consoleErrors = [];
    (window as unknown as { __pageErrors: string[] }).__pageErrors = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      (window as unknown as { __consoleErrors: string[] }).__consoleErrors.push(
        args.map(String).join(" "),
      );
      origError.apply(console, args as []);
    };
    window.addEventListener("error", (event) => {
      (window as unknown as { __pageErrors: string[] }).__pageErrors.push(
        event.message,
      );
    });
    window.addEventListener(
      "unhandledrejection",
      (event: PromiseRejectionEvent) => {
        (window as unknown as { __pageErrors: string[] }).__pageErrors.push(
          String(event.reason),
        );
      },
    );
  });
}

async function expectCleanConsole(page: Page, label: string) {
  const consoleErrors = await page.evaluate(
    () =>
      (window as unknown as { __consoleErrors: string[] }).__consoleErrors ??
      [],
  );
  const pageErrors = await page.evaluate(
    () => (window as unknown as { __pageErrors: string[] }).__pageErrors ?? [],
  );
  expect(consoleErrors, `${label} 不应有 console.error`).toEqual([]);
  expect(pageErrors, `${label} 不应有未捕获异常`).toEqual([]);
}

test("V016-F2(1a)：AI 关闭 Commit 人工路径可选→填说明→预览（意向单前止步）", async ({
  page,
}) => {
  await setupConsoleCollector(page);
  await page.goto("/?module=commit&ai=disabled");
  await expect(
    page.getByRole("heading", { name: "提交当前范围" }),
  ).toBeVisible();

  // 选择：完整文件选择收进折叠区（V014-D 紧凑模式），先展开再操作
  // （范围只缩小不扩大：取消再恢复）。
  await page.locator("summary", { hasText: "完整文件选择与策略" }).click();
  const fileCheck = page.getByLabel("选择 src/extension.ts");
  await expect(fileCheck).toBeVisible();
  await fileCheck.uncheck();
  await expect(fileCheck).not.toBeChecked();
  await fileCheck.check();
  await expect(fileCheck).toBeChecked();

  // 说明：手写提交说明（不展开 AI）。
  const messageBox = page.getByRole("textbox", { name: "提交说明" });
  await expect(messageBox).toBeVisible();
  await messageBox.fill("fix(workbench): 人工提交说明");
  await expect(messageBox).toHaveValue("fix(workbench): 人工提交说明");

  // AI 入口如实禁用，本地检查摘要仍在（无 AI 降级提示墙）。
  const generateButton = page.getByRole("button", {
    name: "生成建议草稿",
  });
  await expect(generateButton).toBeDisabled();
  await expect(page.getByText("本地检查").first()).toBeVisible();
  await expect(page.getByText("模型建议")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "提交说明建议草稿" }),
  ).toHaveCount(0);

  // 预览：主路径完整，到意向单前止步（不打开确认对话框）。
  await page.getByRole("button", { name: /预览提交 \d+ 个文件/ }).click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expectCleanConsole(page, "Commit 人工路径");
});

test("V016-F2(1b)：AI 关闭 Conflicts 本地建议可用→编辑→保存（核验前止步）", async ({
  page,
}) => {
  await setupConsoleCollector(page);
  await page.goto("/?module=conflicts&ai=disabled");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  await expect(page.getByTestId("conflict-role-bar")).toBeVisible();

  // 本地建议可用（不标 AI）：先展开帮助面板。
  await page.getByRole("button", { name: "需要帮助" }).click();
  const localButton = page.getByRole("button", { name: "本地建议" });
  await expect(localButton).toBeVisible();
  await expect(localButton).toBeEnabled();
  await expect(page.getByRole("button", { name: "AI 分析" })).toBeDisabled();
  await expect(
    page.getByText(/未配置外部模型，将运行本地规则，不会外发。/),
  ).toBeVisible();

  // 本地建议结果来源如实为本地检查，不标模型建议。
  await localButton.click();
  await expect(page.getByText("两侧都修改了同一处行为")).toBeVisible();
  await expect(page.getByText("本地检查").first()).toBeVisible();
  await expect(page.getByText("模型建议")).toHaveCount(0);

  // 编辑：接受一侧后草稿同步到 Host 内存（无 Host 写操作语义由 mock 保证）。
  await page.getByRole("button", { name: "采用我的修改" }).first().click();
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible();

  // 保存：到核验前止步（保存成功，不进入解决预览确认）。
  const saveButton = page.getByRole("button", {
    name: "保存工作副本合并结果",
  });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText(/工作副本合并结果已保存/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expectCleanConsole(page, "Conflicts 人工路径");
});

test("V016-F2(1c)：AI 关闭 Changelists 自动整理（本地）→预览（意向单前止步）", async ({
  page,
}) => {
  await setupConsoleCollector(page);
  await page.goto("/?module=changelists&ai=disabled");
  await expect(page.getByRole("heading", { name: "变更集管理" })).toBeVisible();

  // 语义拆分入口如实禁用（未配置），自动整理（本地）可用。
  await page.getByRole("button", { name: "需要帮助" }).click();
  await expect(
    page.getByRole("button", { name: "按改动意图拆分" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "收起帮助" }).click();
  const tidyButton = page.getByRole("button", { name: "自动整理" });
  await expect(tidyButton).toBeVisible();
  await expect(tidyButton).toBeEnabled();

  // 自动整理：本地目录/类型建议（来源徽章如实为本地检查；页头说明文案除外）。
  await tidyButton.click();
  await expect(page.getByText("分组 1：webview")).toBeVisible();
  await expect(page.getByText("建议来源：本地检查")).toBeVisible();
  await expect(page.getByText("模型建议", { exact: true })).toHaveCount(0);

  // 预览：套用建议后生成应用预览，到意向单前止步（不打开确认对话框）。
  await page.getByRole("button", { name: "套用并调整" }).first().click();
  await page.getByRole("button", { name: "生成应用预览" }).click();
  await expect(page.getByText(/svn changelist/).first()).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await expectCleanConsole(page, "Changelists 人工路径");
});

test("V016-F2(1d)：AI 关闭 Understanding 只运行本地检查→结果区", async ({
  page,
}) => {
  await setupConsoleCollector(page);
  await page.goto("/?module=understanding&ai=disabled");
  await expect(
    page.getByRole("heading", { name: "变更解读" }).first(),
  ).toBeVisible();

  // 模型分析入口如实禁用（未配置），本地检查主路径可达。
  await page.getByRole("button", { name: "需要帮助" }).click();
  const modelAction = page.getByRole("button", {
    name: /查看并开始分析|重新分析/,
  });
  await expect(modelAction).toBeDisabled();
  await page.getByRole("button", { name: "收起帮助" }).click();

  // 只运行本地检查：结果区展示本地结论，无模型回执。
  const localButton = page.getByRole("button", { name: "只运行本地检查" });
  await expect(localButton).toBeVisible();
  await expect(localButton).toBeEnabled();
  await localButton.click();
  const resultRegion = page.getByRole("heading", { name: "这次改了什么" });
  await expect(resultRegion).toBeVisible();
  await resultRegion.scrollIntoViewIfNeeded();
  await expect(page.getByText("本地检查").first()).toBeVisible();
  await expect(page.getByText("模型建议")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "变更解读外发回执" }),
  ).toHaveCount(0);

  await expectCleanConsole(page, "Understanding 人工路径");
});

test("V016-F2(1e)：AI 关闭四模块聚合无 console 错误且来源如实", async ({
  page,
}) => {
  await setupConsoleCollector(page);
  for (const module of [
    "commit",
    "conflicts",
    "changelists",
    "understanding",
  ]) {
    await test.step(module, async () => {
      await page.goto(`/?module=${module}&ai=disabled`);
      await expect(page.locator(".workbench-content")).toBeVisible();
      // 任一模块都不出现 AI 冒充徽章与降级提示墙（页头说明文案除外，用精确匹配）。
      await expect(page.getByText("模型建议", { exact: true })).toHaveCount(0);
      await expect(page.getByText(/AI.*失败|AI.*错误/)).toHaveCount(0);
    });
  }
  await expectCleanConsole(page, "AI 关闭聚合");
});
