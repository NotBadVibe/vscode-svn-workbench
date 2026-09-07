import { expect, test } from "@playwright/test";
import { openModule } from "./navigation";

/*
 * V021-R17 · 历史变更路径直达该次修改。
 * 全程确定性：只用 expect 轮询，不用 waitForTimeout 死等。
 * mock 语义：history/view-path-diff 按快照真值动作下发 revision-file
 * 快照（A 空→新、D 旧→空、M 上一修订→本修订）；未知路径如实拒绝；
 * history/view-path-history 收窄为单文件历史横幅。
 */
test("V021-R17：查看此修订修改直达单文件只读差异", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "历史");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();

  // 行主动作：r42 对 /trunk/src/extension.ts 的修改（M：r41 → r42）。
  await page
    .getByRole("button", {
      name: "查看 r42 对 /trunk/src/extension.ts 的修改",
    })
    .click();
  // R09 revision-file：真实单文件标题 + 双侧只读基线，无本地提交动作。
  await expect(
    page.getByText("r42 · trunk/src/extension.ts（修改）", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("r41 → r42（只读）")).toBeVisible();
  await expect(
    page.getByText(/r42修改 · trunk\/src\/extension\.ts（只读）/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "提交此文件" }),
  ).not.toBeVisible();
});

test("V021-R17：查看文件历史收窄为单文件历史", async ({ page }) => {
  await page.goto("/");
  await openModule(page, "历史");
  await expect(page.getByRole("heading", { name: "修订历史" })).toBeVisible();

  // 次级动作：查看文件历史。
  await page
    .getByRole("button", {
      name: "查看 /trunk/src/extension.ts 的文件历史",
    })
    .click();
  await expect(
    page.getByText(/当前为单文件历史：trunk\/src\/extension\.ts/),
  ).toBeVisible();
  await expect(
    page.getByText(/已显示 trunk\/src\/extension\.ts 的文件历史/),
  ).toBeVisible();
});
