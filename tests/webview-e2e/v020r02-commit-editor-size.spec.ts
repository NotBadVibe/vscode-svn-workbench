import { expect, test } from "@playwright/test";

/**
 * V020-R02 · 提交说明输入框退化为小尺寸回归。
 *
 * 背景：v0.1.4 紧凑模式重构后 `.commit-compose` 祖先类已不存在，
 * global.css 的 `.commit-compose textarea` 规则失效，textarea 回退到
 * UA 默认小尺寸（生产 1280×800 下约 156×39px）。修复将布局归属
 * CommitMessageEditor 自身（scoped 样式：宽 100%、最小高 150px、
 * 纵向可调），字数/团队规则/IME/预览快捷键保持不变。
 *
 * 断言平台无关：只比较同页元素盒模型比例与内容/角色，不做
 * 操作系统相关假设，不使用 waitForTimeout。
 */

test("V020-R02(a)：1280×800 输入框铺满内容区且最小高度达标", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?module=commit");
  const textarea = page.getByRole("textbox", { name: "提交说明" });
  await expect(textarea).toBeVisible();

  const container = page.locator(".commit-message-editor");
  await expect(container).toBeVisible();
  const containerBox = await container.boundingBox();
  const textareaBox = await textarea.boundingBox();
  expect(containerBox, "编辑器容器应有可测盒模型").toBeTruthy();
  expect(textareaBox, "输入框应有可测盒模型").toBeTruthy();
  // 宽度与内容区一致（允许边框/舍入误差）。
  const widthRatio =
    (textareaBox as NonNullable<typeof textareaBox>).width /
    (containerBox as NonNullable<typeof containerBox>).width;
  expect(widthRatio).toBeGreaterThan(0.95);
  // 最小高度达到约定（150px），且远大于退化时的 ~39px。
  expect(
    (textareaBox as NonNullable<typeof textareaBox>).height,
  ).toBeGreaterThanOrEqual(150);
  // 允许纵向调整。
  const resize = await textarea.evaluate(
    (node) => getComputedStyle(node as HTMLTextAreaElement).resize,
  );
  expect(resize).toBe("vertical");
});

test("V020-R02(b)：720×480 可输入、可调高度并滚动到预览按钮", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 480 });
  await page.goto("/?module=commit");
  const textarea = page.getByRole("textbox", { name: "提交说明" });
  await expect(textarea).toBeVisible();

  // 多段中文 + 长路径真实键入（逐键事件，非 fill 掩盖）。
  await textarea.click();
  await textarea.pressSequentially(
    "修复提交说明输入框退化\n第二段：验证换行与中文输入正常\n",
    { delay: 5 },
  );
  await expect(textarea).toHaveValue(
    /修复提交说明输入框退化.*第二段：验证换行与中文输入正常/s,
  );

  // 纵向可调：计算高度允许用户放大（resize 手柄由 resize:vertical 提供，
  // 此处断言样式契约；拖拽手柄属于浏览器原生行为，不在 js 层模拟）。
  const resize = await textarea.evaluate(
    (node) => getComputedStyle(node as HTMLTextAreaElement).resize,
  );
  expect(resize).toBe("vertical");

  // 预览按钮可滚动可达并可用。
  const previewEntry = page.getByRole("button", {
    name: /预览提交 \d+ 个文件/,
  });
  await previewEntry.scrollIntoViewIfNeeded();
  await expect(previewEntry).toBeVisible();
  await previewEntry.click();
  await expect(page.getByText("范围、状态和远端检查已通过")).toBeVisible();

  // 无页面级横向溢出。
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});

test("V020-R02(c)：2000 字符边界后光标及提示正常", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?module=commit");
  const textarea = page.getByRole("textbox", { name: "提交说明" });
  await expect(textarea).toBeVisible();

  // 多段中文 + 长路径 + 填充至 2000 字符边界。
  const longPath = "src/webview/features/commit/CommitMessageEditor.svelte";
  const header = `首段中文说明：本次提交修复输入框尺寸退化。\n长路径：${longPath}\n`;
  const atBoundary = (header + "测".repeat(2000)).slice(0, 2000);
  expect(atBoundary.length).toBe(2000);
  await textarea.fill(atBoundary);
  await expect(textarea).toHaveValue(atBoundary);
  await expect(page.getByText("2000/2000 个字符")).toBeVisible();

  // 边界后再输入被 maxlength 拒绝，内容不变、提示不变。
  await textarea.press("End");
  await textarea.press("x");
  await expect(textarea).toHaveValue(atBoundary);
  await expect(page.getByText("2000/2000 个字符")).toBeVisible();

  // 光标落在末尾，可继续正常编辑（删除一个字符后计数回落）。
  const caret = await textarea.evaluate(
    (node) => (node as HTMLTextAreaElement).selectionStart,
  );
  expect(caret).toBe(2000);
  await textarea.press("Backspace");
  await expect(page.getByText("1999/2000 个字符")).toBeVisible();
});
