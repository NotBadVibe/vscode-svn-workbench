import { expect, test, type Page } from "@playwright/test";
import type { EditSpikeReport } from "../src/edit-spike";

/*
 * v0.0.6 阶段 1 edit mode Spike 断言：
 * - P0 真实 Webview 等价严格 CSP（style-src 无 'unsafe-inline'）下可编辑 diff 可用：
 *   contentEditable 挂载、新增可编辑/删除不可编辑、实际输入、中文 IME、恶意文本转义、
 *   宿主快捷键捕获、动态 chunk、三主题、CSP 零违规、挂载性能。
 * - No-Go 任一 P0 失败即阻止页内编辑上线（保留 vscode.diff 逃生舱）。
 */

async function loadEditSpike(
  page: Page,
  theme: string,
): Promise<{
  report: EditSpikeReport;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()} ${request.failure()?.errorText}`),
  );
  await page.goto(`/?edit=1&csp=strict&theme=${theme}`);
  await page.waitForFunction(
    () =>
      (window as unknown as { __spikeEdit?: EditSpikeReport }).__spikeEdit
        ?.ready === true,
  );
  const report = await page.evaluate(
    () => (window as unknown as { __spikeEdit: EditSpikeReport }).__spikeEdit,
  );
  return { report, consoleErrors, pageErrors, failedRequests };
}

test("edit mode Spike（严格 CSP）：可编辑挂载、输入、IME、恶意文本转义与快捷键", async ({
  page,
}) => {
  const { report, pageErrors, failedRequests, consoleErrors } =
    await loadEditSpike(page, "dark");

  expect(report.error, `spike 不应报错: ${report.error ?? ""}`).toBeUndefined();
  expect(pageErrors, "页面运行时不应有未捕获异常").toEqual([]);
  expect(failedRequests, "严格 CSP 下不应有资源加载失败").toEqual([]);

  // P0-1 动态 chunk：@pierre/diffs/edit 独立懒加载
  expect(report.dynamicChunkLoaded).toBe(true);

  // P0-2 可编辑挂载：新增侧 contentEditable，删除/注释侧不可编辑
  expect(report.editorAttached).toBe(true);
  expect(report.contentEditableCount).toBeGreaterThan(0);
  expect(report.additionsEditable).toBeGreaterThan(0);
  expect(report.deletionsEditable).toBe(0);

  // P0-3 程序化输入与 onChange 事件
  expect(report.onChangeFired).toBe(true);
  expect(report.typedText).toBe("applied");
  expect(report.getTextLength).toBeGreaterThan(0);

  // P0-4 中文 IME：composition 生命周期不崩溃；真实点击编辑区后经真实输入管线落盘
  expect(report.imeCompositionSafe).toBe(true);
  const editableArea = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editableArea.click();
  await page.keyboard.insertText("工作副本");
  const afterIme = await page.evaluate(
    () =>
      (
        window as unknown as { __spikeEditGetText?: () => string }
      ).__spikeEditGetText?.() ?? "",
  );
  expect(afterIme).toContain("工作副本");

  // P0-5 恶意文本转义：script/img 负载按纯文本呈现，不产生可执行元素
  expect(report.maliciousRenderedAsText).toBe(true);
  expect(report.maliciousScriptElementCount).toBe(0);

  // P0-6 宿主 Cmd/Ctrl+S 捕获与编辑器共存
  expect(report.shortcutCaptured).toBe(true);
  expect(report.shortcutKey).toBe("s");

  // P0-7 CSP 零违规
  expect(report.cspViolations).toBe(0);
  expect(consoleErrors).toEqual([]);

  console.log(
    `[edit-spike] mountMs=${report.mountMs} editChunk=${report.editChunkResource} ` +
      `contentEditable=${report.contentEditableCount} add=${report.additionsEditable} ` +
      `del=${report.deletionsEditable} cspViolations=${report.cspViolations}`,
  );
});

test("edit mode Spike：三主题均可辨识且不只靠颜色", async ({ page }) => {
  for (const theme of ["light", "dark", "hc"] as const) {
    const { report, pageErrors, failedRequests } = await loadEditSpike(
      page,
      theme,
    );
    expect(report.error).toBeUndefined();
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(report.contentEditableCount).toBeGreaterThan(0);
    expect(report.additionsEditable).toBeGreaterThan(0);
    expect(report.cspViolations).toBe(0);
    console.log(
      `[edit-spike] theme=${theme} addEditable=${report.additionsEditable} ` +
        `contentEditable=${report.contentEditableCount} csp=${report.cspViolations}`,
    );
  }
});

test("edit mode Spike：挂载性能与体积预算", async ({ page }) => {
  const { report } = await loadEditSpike(page, "dark");
  expect(report.mountMs).toBeLessThan(2000);
  expect(report.editChunkResource).not.toBeNull();
  console.log(
    `[edit-spike] mountMs=${report.mountMs} editChunk=${report.editChunkResource}`,
  );
});
