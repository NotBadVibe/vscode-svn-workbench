import { expect, test } from "@playwright/test";
import { openModule } from "./navigation";

test("conflict draft: edit then save failure preserves draft and allows copy/export, retry succeeds (v0.0.13)", async ({
  page,
}) => {
  await page.goto("/?conflictSave=fail");
  await openModule(page, "冲突");
  await expect(page.getByRole("heading", { name: "待处理冲突" })).toBeVisible();
  // 打开第一条冲突的编辑区（工作副本 tab 已默认）
  const editHost = page.locator(".conflict-codemirror-host").first();
  await expect(editHost).toBeVisible();
  // 先做块级合并编辑：产生脏草稿并使保存按钮可用（保存按钮要求 workingDirty）
  await page.getByRole("button", { name: "采用对方修改" }).first().click();
  // 等待 mock 的 draft-update 回环完成（草稿同步通知出现）
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
    timeout: 15_000,
  });
  // 点击保存（mock 会根据 ?conflictSave=fail 返回失败并保留草稿）
  await page.getByRole("button", { name: "保存工作副本合并结果" }).click();
  // 保存失败应内联展示，且草稿保留
  await expect(
    page.getByText(/保存失败：模拟磁盘写入失败；草稿已保留/),
  ).toBeVisible();
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible();
  await expect(page.getByRole("button", { name: "复制草稿" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导出草稿" })).toBeEnabled();
  await page.getByRole("button", { name: "复制草稿" }).click();
  await expect(page.getByText("草稿已复制")).toBeVisible();
  await page.getByRole("button", { name: "导出草稿" }).click();
  await expect(page.getByText("草稿已导出")).toBeVisible();
  // 重试成功：去掉 fail 参数，重新编辑并保存
  await page.goto("/");
  await openModule(page, "冲突");
  await page.getByRole("button", { name: "采用对方修改" }).first().click();
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "保存工作副本合并结果" }).click();
  await expect(
    page.getByText("工作副本合并结果已保存；请生成解决预览。"),
  ).toBeVisible();
});

test("conflict draft: switch file with dirty draft shows three-way dialog and 30s timer notice (v0.0.13)", async ({
  page,
}) => {
  await page.goto("/");
  await openModule(page, "冲突");
  // 触发编辑产生脏草稿（通过点击块级合并的“采用对方修改”会产生 draft-update）
  await page.getByRole("button", { name: "采用对方修改" }).first().click();
  // 等待 draft-checkpointed 通知（mock 会注入 draft）
  await expect(page.getByText("Host 内存草稿已同步")).toBeVisible({
    timeout: 15_000,
  });
  // 切换到另一个冲突：mock 检测到当前文件草稿脏，按 Host 行为下发三选一确认
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
  const switchDialog = page.getByRole("dialog", { name: "未保存草稿处理" });
  await expect(switchDialog).toBeVisible();
  await expect(
    switchDialog.getByText(/30 秒未选择将自动保存检查点并继续/),
  ).toBeVisible();
  await expect(
    switchDialog.getByRole("button", { name: "保存检查点并继续" }),
  ).toBeVisible();
  await expect(
    switchDialog.getByRole("button", { name: "留在当前文件" }),
  ).toBeVisible();
  await expect(
    switchDialog.getByRole("button", { name: "放弃草稿" }),
  ).toBeVisible();
});
