/* eslint-disable @typescript-eslint/no-explicit-any */
// 中文注释：v0.1.3 主路径闭环 E2E —— 编辑→保存工作副本→核验→意向单一次确认→Resolve→自动下一个→全部完成→返回来路
// 另含：步骤条五阶段可见、AI 未配置主路径不阻塞
import { expect, test, type Page } from "@playwright/test";

// 中文注释：捕获 mock-action，用于必要时校验草稿同步
async function setupCapture(page: Page) {
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

async function clearCaptured(page: Page) {
  await page.evaluate(() => {
    (window as any).__capturedActions = [];
  });
}

// 中文注释：块级“采用我的修改”按钮（限定在块列表，避免命中工具栏）
function takeMineButton(page: Page) {
  return page
    .locator(".merge-block-list")
    .getByRole("button", { name: "采用我的修改" })
    .first();
}

function fallbackTakeMine(page: Page) {
  return page.getByRole("button", { name: "采用我的修改" }).first();
}

async function clickTakeMine(page: Page) {
  const scoped = takeMineButton(page);
  const useScoped =
    (await scoped.count()) > 0 && (await scoped.isVisible().catch(() => false));
  const btn = useScoped ? scoped : fallbackTakeMine(page);
  await expect(btn).toBeVisible();
  await btn.click();
}

// 中文注释：确保“需要帮助”折叠区已展开，使“生成解决预览”等按钮可见
async function ensureHelpOpen(page: Page) {
  const details = page.getByTestId("conflict-help-details");
  const isOpen = await details
    .evaluate((el) => (el as HTMLDetailsElement).open)
    .catch(() => false);
  if (!isOpen) {
    const summary = page
      .locator('[data-testid="conflict-help-details"] summary')
      .first();
    if ((await summary.count()) > 0) {
      await summary.click();
    } else {
      await page.getByText("需要帮助（合并建议与解释）").click();
    }
    await expect(details).toHaveAttribute("open", "");
  }
}

test.describe("V013 主路径闭环", () => {
  // 中文注释：主路径——编辑→保存→预览→意向单一次确认→自动下一个→第二个同样→全部完成
  test("主路径闭环：编辑→保存工作副本→预览→意向单一次确认→自动下一个→全部完成", async ({
    page,
  }) => {
    await setupCapture(page);
    // 中文注释：使用 ?conflicts=multi 注入两个冲突 a.ts / b.ts
    await page.goto("/?module=conflicts&conflicts=multi");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    await expect(page.getByTestId("merge-action-toolbar")).toBeVisible();
    await expect(page.getByTestId("conflict-result-editor-host")).toBeVisible();
    // 中文注释：步骤条五阶段持续可见
    const stepBar = page.getByTestId("conflict-step-bar");
    await expect(stepBar).toBeVisible();
    await expect(page.getByTestId("conflict-step-edit")).toBeVisible();
    await expect(page.getByTestId("conflict-step-save")).toBeVisible();
    await expect(page.getByTestId("conflict-step-verify")).toBeVisible();
    await expect(page.getByTestId("conflict-step-resolve")).toBeVisible();
    await expect(page.getByTestId("conflict-step-next")).toBeVisible();
    await expect(page.getByTestId("conflict-step-edit")).toContainText("编辑");
    await expect(page.getByTestId("conflict-step-save")).toContainText(
      "保存工作副本",
    );
    await expect(page.getByTestId("conflict-step-verify")).toContainText(
      "核验",
    );
    await expect(page.getByTestId("conflict-step-resolve")).toContainText(
      "标记解决",
    );
    await expect(page.getByTestId("conflict-step-next")).toContainText(
      "下一个",
    );

    // 中文注释：左侧冲突列表容器限定作用域，避免命中正文/面包屑/Toast
    const conflictList = page.getByRole("list", { name: "冲突文件" });
    await expect(conflictList).toBeVisible();
    await expect(conflictList.getByText("src/conflict/a.ts")).toBeVisible();
    await expect(conflictList.getByText("src/conflict/b.ts")).toBeVisible();
    const listPane = page.locator(".conflict-list-pane");
    await expect(listPane.getByText("src/conflict/a.ts")).toBeVisible();

    // 中文注释：当前应选中 a.ts（首个）
    await expect(
      page.locator(".conflict-header").getByText("src/conflict/a.ts").first(),
    ).toBeVisible({ timeout: 10_000 });

    // === 第一个冲突 a.ts：编辑 ===
    await clearCaptured(page);
    await clickTakeMine(page);
    // 中文注释：draft-update 草稿同步（中文注释：校验 Host 内存草稿已同步提示出现）
    await expect(page.getByText("Host 内存草稿已同步").first()).toBeVisible({
      timeout: 15_000,
    });
    let actions = await getCapturedActions(page);
    expect(
      actions.some((a: any) => a.payload?.action === "conflict/draft-update"),
    ).toBe(true);

    // 中文注释：保存工作副本
    const saveBtn = page.getByRole("button", { name: "保存工作副本合并结果" });
    await expect(saveBtn).toBeEnabled({ timeout: 5_000 });
    await saveBtn.click();
    await expect(
      page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
    ).toBeVisible({ timeout: 15_000 });

    // 中文注释：生成解决预览 → 出现 svn resolve --accept working
    await ensureHelpOpen(page);
    const previewBtn = page.getByRole("button", { name: "生成解决预览" });
    await expect(previewBtn).toBeVisible();
    await previewBtn.click();
    await expect(
      page
        .getByText('svn resolve --accept working "src/conflict/a.ts"')
        .first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("svn resolve --accept working").first(),
    ).toBeVisible();

    // 中文注释：意向单一次确认（dialog 标题“标记解决 1 个冲突”）
    const intentBtn = page.getByRole("button", {
      name: "确认使用当前工作副本内容并标记解决",
    });
    await expect(intentBtn).toBeVisible();
    await expect(intentBtn).toBeEnabled();
    await intentBtn.click();
    // 中文注释：OperationIntentDialog 出现
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText("标记解决 1 个冲突")).toBeVisible();
    const confirmBtn = dialog.getByRole("button", { name: "确认标记解决" });
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeEnabled();
    // 中文注释：意向单只一次确认，无前置复选框
    await confirmBtn.click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // 中文注释：Resolve 成功后自动进入下一个冲突 b.ts
    await expect(page.getByText("冲突已标记解决").first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.locator(".conflict-header").getByText("src/conflict/b.ts").first(),
    ).toBeVisible({ timeout: 10_000 });
    // 中文注释：已解决文件不重现（限定到左侧冲突列表，避免命中面包屑/Toast/播报）
    await expect(conflictList.getByText("src/conflict/a.ts")).toHaveCount(0);
    await expect(conflictList.getByText("src/conflict/b.ts")).toBeVisible();

    // === 第二个冲突 b.ts：同样保存→预览→Resolve ===
    await clearCaptured(page);
    await clickTakeMine(page);
    await expect(page.getByText("Host 内存草稿已同步").first()).toBeVisible({
      timeout: 15_000,
    });
    actions = await getCapturedActions(page);
    expect(
      actions.some((a: any) => a.payload?.action === "conflict/draft-update"),
    ).toBe(true);
    const saveBtn2 = page.getByRole("button", { name: "保存工作副本合并结果" });
    await expect(saveBtn2).toBeEnabled({ timeout: 5_000 });
    await saveBtn2.click();
    await expect(
      page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
    ).toBeVisible({ timeout: 15_000 });

    await ensureHelpOpen(page);
    const previewBtn2 = page.getByRole("button", { name: "生成解决预览" });
    await expect(previewBtn2).toBeVisible();
    await previewBtn2.click();
    // 中文注释：第二个文件的 resolve 命令
    await expect(
      page
        .getByText('svn resolve --accept working "src/conflict/b.ts"')
        .first(),
    ).toBeVisible({ timeout: 10_000 });

    const intentBtn2 = page.getByRole("button", {
      name: "确认使用当前工作副本内容并标记解决",
    });
    await expect(intentBtn2).toBeVisible();
    await intentBtn2.click();
    const dialog2 = page.getByRole("dialog");
    await expect(dialog2).toBeVisible({ timeout: 10_000 });
    await expect(dialog2.getByText("标记解决 1 个冲突")).toBeVisible();
    const confirmBtn2 = dialog2.getByRole("button", { name: "确认标记解决" });
    await confirmBtn2.click();
    await expect(dialog2).not.toBeVisible({ timeout: 10_000 });

    // 中文注释：全部完成显示摘要 + 已解决文件不重现 + 返回来路按钮可见
    await expect(page.getByText("冲突已标记解决").first()).toBeVisible({
      timeout: 10_000,
    });
    const summary = page.getByTestId("all-resolved-summary");
    await expect(summary).toBeVisible({ timeout: 10_000 });
    await expect(summary.getByText("全部冲突已解决")).toBeVisible();
    // 中文注释：断言限定作用域——仅在冲突文件列表内校验，避免命中面包屑/Toast/播报残留
    await expect(conflictList.getByText("src/conflict/a.ts")).toHaveCount(0);
    await expect(conflictList.getByText("src/conflict/b.ts")).toHaveCount(0);
    // 中文注释：返回来路按钮可见（generic 兜底，至少一个入口可见）
    await expect(
      page.locator('[data-testid^="return-"]').first(),
    ).toBeVisible();
    // 中文注释：显式校验通用返回按钮可达（避免回归）
    const hasGeneric = await page
      .getByTestId("return-to-changes-generic")
      .count();
    if (hasGeneric > 0) {
      await expect(page.getByTestId("return-to-changes-generic")).toBeVisible();
    } else {
      await expect(
        page.locator('[data-testid^="return-"]').first(),
      ).toBeVisible();
    }
    // 中文注释：步骤条仍可见，当前阶段为全部已解决
    await expect(page.getByTestId("conflict-step-bar")).toBeVisible();
    await expect(page.getByTestId("conflict-step-bar-current")).toContainText(
      "全部已解决",
      { timeout: 10_000 },
    );
  });

  // 中文注释：AI 未配置主路径不阻塞（与步骤条合并验证）
  test("AI 未配置时主路径不阻塞且步骤条五阶段持续可达", async ({ page }) => {
    await setupCapture(page);
    await page.goto("/?module=conflicts&conflicts=multi&ai=disabled");
    await expect(
      page.getByRole("heading", { name: "待处理冲突" }),
    ).toBeVisible();
    await expect(page.getByTestId("merge-action-toolbar")).toBeVisible();
    // 中文注释：AI 未配置时按钮文案为“本地建议”而非“AI 分析”，但主路径不受影响
    await expect(page.getByRole("button", { name: "本地建议" })).toBeVisible();
    // 中文注释：步骤条五阶段仍可见
    await expect(page.getByTestId("conflict-step-bar")).toBeVisible();
    await expect(page.getByTestId("conflict-step-edit")).toBeVisible();
    await expect(page.getByTestId("conflict-step-save")).toBeVisible();
    await expect(page.getByTestId("conflict-step-verify")).toBeVisible();
    await expect(page.getByTestId("conflict-step-resolve")).toBeVisible();
    await expect(page.getByTestId("conflict-step-next")).toBeVisible();

    const conflictList = page.getByRole("list", { name: "冲突文件" });
    await expect(conflictList.getByText("src/conflict/a.ts")).toBeVisible();
    await expect(conflictList.getByText("src/conflict/b.ts")).toBeVisible();

    // 中文注释：编辑→保存→预览→Resolve 仍可完成（不依赖 AI）
    await clickTakeMine(page);
    await expect(page.getByText("Host 内存草稿已同步").first()).toBeVisible({
      timeout: 15_000,
    });
    const saveBtn = page.getByRole("button", { name: "保存工作副本合并结果" });
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(
      page.getByText("工作副本合并结果已保存；请生成解决预览。").first(),
    ).toBeVisible({ timeout: 15_000 });
    await ensureHelpOpen(page);
    await page.getByRole("button", { name: "生成解决预览" }).click();
    await expect(
      page.getByText("svn resolve --accept working").first(),
    ).toBeVisible({ timeout: 10_000 });
    const opBtn = page.getByRole("button", {
      name: "确认使用当前工作副本内容并标记解决",
    });
    await opBtn.click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: "确认标记解决" }).click();
    await expect(dlg).not.toBeVisible({ timeout: 10_000 });
    // 中文注释：成功进入下一个冲突，证明 AI 未阻塞
    await expect(
      page.locator(".conflict-header").getByText("src/conflict/b.ts").first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(conflictList.getByText("src/conflict/a.ts")).toHaveCount(0);
    // 中文注释：步骤条播报与当前阶段仍更新
    await expect(page.getByTestId("conflict-step-bar-current")).toBeVisible();
  });
});
