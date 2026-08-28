/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, test } from "@playwright/test";

async function setupMockCapture(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (window as any).__capturedActions = [];
    window.addEventListener("svn-workbench:mock-action", (event: Event) => {
      const detail = (event as CustomEvent).detail;
      (window as any).__capturedActions.push(detail);
    });
  });
}

async function getCapturedActions(page: import("@playwright/test").Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__capturedActions ?? []);
}

async function clearCapturedActions(page: import("@playwright/test").Page) {
  await page.evaluate(() => { (window as any).__capturedActions = []; });
}

function hasWriteAction(actions: any[]): boolean {
  return actions.some((item) => {
    const payload = (item as any).payload as { action?: string } | undefined;
    const action = payload?.action ?? (item as any).action ?? "";
    if (typeof action !== "string") return false;
    return (
      action.includes("save-working") ||
      action.includes("resolve") ||
      action.includes("commit/execute") ||
      action.includes("commit/preview")
    );
  });
}

test.describe("10块连续操作（V011-C 多块 fixture）", () => {
  test("conflictBlocks=10 连续处理10块：每块独立、进度正确、无选错、仅draft-update", async ({ page }) => {
    await setupMockCapture(page);
    await page.goto("/?module=conflicts&conflictBlocks=10");
    await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
    await expect(page.getByTestId("conflict-role-bar")).toBeVisible();
    const blockProgress = page.getByTestId("block-progress");
    await expect(blockProgress).toBeVisible();
    await expect(blockProgress).toHaveText(/块 1\/10/);
    await expect(page.getByText("仍有 10 个冲突块")).toBeVisible();
    const blockList = page.locator(".merge-block-list");
    await expect(blockList).toBeVisible();
    const articles = page.locator(".merge-block-list article");
    await expect(articles).toHaveCount(10);
    const editor = page.locator(".conflict-codemirror-host .cm-content").first();
    await expect(editor).toBeVisible();
    // 初始可见块包含前几块内容（虚拟滚动可能只渲染可见区，故只校验前几块）
    await expect(editor).toContainText("my-block-1-local");
    await expect(editor).toContainText("my-block-2-local");
    // 校检初始 draft-update 未触发，避免误判
    await clearCapturedActions(page);
    const resolutions: Array<"mine" | "theirs" | "both"> = ["mine", "theirs", "both", "mine", "theirs", "both", "mine", "theirs", "both", "mine"];
    const labels: Record<"mine" | "theirs" | "both", string> = {
      mine: "采用我的修改",
      theirs: "采用对方修改",
      both: "保留两者",
    };
    let lastContent = "";
    for (let i = 0; i < 10; i++) {
      const res = resolutions[i];
      const label = labels[res];
      const remainingBefore = 10 - i;
      // 进度与剩余数断言
      await expect(page.getByText(`仍有 ${remainingBefore} 个冲突块`)).toBeVisible();
      await expect(blockProgress).toContainText(`/${remainingBefore}`);
      await expect(articles).toHaveCount(remainingBefore);
      const firstArticle = page.locator(".merge-block-list article").first();
      await expect(firstArticle).toBeVisible();
      await expect(firstArticle.getByText(`块 1`)).toBeVisible();
      const btn = firstArticle.getByRole("button", { name: label });
      await expect(btn).toBeVisible();
      await clearCapturedActions(page);
      await btn.click();
      await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({ timeout: 15000 });
      const actions = await getCapturedActions(page);
      expect(hasWriteAction(actions), `第${i+1}块 ${label} 不应触发 Host 写`).toBe(false);
      const draftAction = actions.find((a: any) => a.payload?.action === "conflict/draft-update");
      expect(draftAction, `第${i+1}块应产生 draft-update`).toBeTruthy();
      const content: string = draftAction?.payload?.content ?? draftAction?.payload?.data?.content ?? "";
      lastContent = content;
      // 校验草稿内容：只改对应块
      const n = i + 1;
      if (res === "mine") {
        expect(content).toContain(`my-block-${n}-local`);
        expect(content, `块${n}采用我的后不应保留对方` ).not.toContain(`their-block-${n}-remote`);
        // base 也应消失（base 在标记内）
        expect(content).not.toContain(`base-block-${n}\n`);
      } else if (res === "theirs") {
        expect(content).toContain(`their-block-${n}-remote`);
        expect(content, `块${n}采用对方后不应保留我的`).not.toContain(`my-block-${n}-local`);
        expect(content).not.toContain(`base-block-${n}\n`);
      } else {
        expect(content).toContain(`my-block-${n}-local`);
        expect(content).toContain(`their-block-${n}-remote`);
        // both 情况下 base 仍消失，但两者保留；检查两者相邻（简单包含即可）
        expect(content).not.toContain(`base-block-${n}\n`);
      }
      // 已解决块的冲突标记应消失
      // 检查该块的局部标记不再以冲突块形式存在：即不应再有该块的 mine/theirs 标记组合紧邻？
      // 由于是顺序处理，第 n 块已解决，其标记应消失，但后续块标记仍存在
      if (i < 9) {
        // 后续块仍应保留冲突标记
        const nextN = n + 1;
        expect(content).toContain(`my-block-${nextN}-local`);
        expect(content).toContain(`their-block-${nextN}-remote`);
        expect(content).toContain("<<<<<<< .mine");
        await expect(page.getByText(`仍有 ${remainingBefore - 1} 个冲突块`)).toBeVisible();
        await expect(blockProgress).toContainText(`/${remainingBefore - 1}`);
        await expect(articles).toHaveCount(remainingBefore - 1);
        // 编辑器虚拟渲染只保证前几块可见，改用捕获内容已验证，此处仅校验仍可见块1的文本（即原块2）
        // 无需校验远端块10的可见性
      } else {
        await expect(page.getByText("未检测到冲突标记")).toBeVisible();
        await expect(blockProgress).toContainText("/0");
        await expect(articles).toHaveCount(0);
        expect(content).not.toContain("<<<<<<< .mine");
        expect(content).not.toContain(">>>>>>> .r101");
      }
    }
    expect(lastContent).toContain("my-block-1-local");
    expect(lastContent).toContain("my-block-10-local");
    const finalActions = await getCapturedActions(page);
    expect(hasWriteAction(finalActions)).toBe(false);
  });
});
