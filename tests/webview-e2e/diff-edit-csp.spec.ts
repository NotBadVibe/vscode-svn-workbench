import { expect, test, type Page } from "@playwright/test";

/*
 * v0.0.6 验收：生产构建 + 生产等价严格 CSP 下的页内编辑。
 *
 * 生产 CSP（src/extension/workbench/renderWebviewShell.ts）：
 *   default-src 'none'; img-src ${cspSource} data:; font-src ${cspSource};
 *   style-src ${cspSource}; script-src 'nonce-…' ${cspSource}; connect-src 'none'
 * 普通 http origin 下的等价替换：cspSource → 'self'（与 tests/spike 同一约定）。
 * 关键性质与生产一致：style-src 无 'unsafe-inline'，style 属性与内联 <style>
 * 均在解析期被拦截并上报 securitypolicyviolation。
 *
 * 与 tests/webview-e2e/workbench.spec.ts 的差异：本文件对整个文档响应注入 CSP
 * 响应头，在真实 Chromium 中验证编辑态零违规、样式经生产垫片正常生效。
 */

const PRODUCTION_EQUIVALENT_CSP =
  "default-src 'none'; img-src 'self' data:; font-src 'self'; " +
  "style-src 'self'; script-src 'self'; connect-src 'none'";

interface ViolationRecord {
  directive: string;
  sample: string;
}

async function openDiffUnderStrictCsp(page: Page): Promise<{
  consoleErrors: string[];
  pageErrors: string[];
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    const violations: ViolationRecord[] = [];
    (
      window as unknown as { __cspViolations: ViolationRecord[] }
    ).__cspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.effectiveDirective,
        sample: event.sample ?? "",
      });
    });
  });
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    if ((headers["content-type"] ?? "").includes("text/html")) {
      headers["content-security-policy"] = PRODUCTION_EQUIVALENT_CSP;
    }
    await route.fulfill({ response, headers });
  });
  await page.goto("/?module=diff");
  await expect(page.getByText("BASE ↔ 工作副本 · typescript")).toBeVisible();
  return { consoleErrors, pageErrors };
}

async function collectViolations(page: Page): Promise<ViolationRecord[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __cspViolations: ViolationRecord[] })
        .__cspViolations,
  );
}

test("严格 CSP：只读审阅态零违规且语法着色经垫片生效", async ({ page }) => {
  const { consoleErrors, pageErrors } = await openDiffUnderStrictCsp(page);

  // 高亮与主题注入是异步的：等垫片完成转写再断言。
  await page.waitForFunction(() => {
    const root = document.querySelector("diffs-container")?.shadowRoot;
    if (!root) return false;
    const spans = Array.from(root.querySelectorAll("[data-code] span"));
    return (
      root.adoptedStyleSheets.length > 0 &&
      spans.some((span) => span instanceof HTMLElement && span.style.length > 0)
    );
  });

  const styling = await page.evaluate(() => {
    const container = document.querySelector("diffs-container");
    const root = container?.shadowRoot;
    if (!root) return { tokenStyled: false, adoptedSheets: -1 };
    const spans = Array.from(root.querySelectorAll("[data-code] span"));
    const styled = spans.some(
      (span) => span instanceof HTMLElement && span.style.length > 0,
    );
    return {
      tokenStyled: styled,
      adoptedSheets: root.adoptedStyleSheets.length,
    };
  });
  expect(styling.tokenStyled, "token 颜色应经生产垫片落地").toBe(true);
  expect(
    styling.adoptedSheets,
    "主题变量应转写为 adoptedStyleSheets",
  ).toBeGreaterThan(0);

  expect(await collectViolations(page), "严格 CSP 下不允许违规").toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("严格 CSP：页内编辑零违规、编辑器样式生效、可输入并保存", async ({
  page,
}) => {
  const { consoleErrors, pageErrors } = await openDiffUnderStrictCsp(page);

  await page.getByRole("button", { name: "页内编辑" }).click();
  await expect(page.getByText("编辑模式")).toBeVisible();

  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await expect(editable).toBeVisible();

  // 编辑器挂载与样式注入是异步的：等垫片完成转写再断言。
  await page.waitForFunction(() => {
    const root = document.querySelector("diffs-container")?.shadowRoot;
    return (
      root != null &&
      root.adoptedStyleSheets.length > 0 &&
      document.adoptedStyleSheets.length > 0
    );
  });

  // 编辑器注入的样式通道（data-editor-css / data-editor-theme-css /
  // data-editor-global-css）必须全部经垫片转写，不留被拦截节点。
  const editorStyling = await page.evaluate(() => {
    const container = document.querySelector("diffs-container");
    const root = container?.shadowRoot;
    if (!root) {
      return {
        leftoverShadowStyles: -1,
        shadowAdopted: -1,
        documentAdopted: -1,
      };
    }
    return {
      leftoverShadowStyles: root.querySelectorAll(
        "style[data-editor-css], style[data-editor-theme-css], style[data-theme-css]",
      ).length,
      shadowAdopted: root.adoptedStyleSheets.length,
      documentAdopted: document.adoptedStyleSheets.length,
      leftoverGlobalStyles: document.querySelectorAll(
        "style[data-editor-global-css]",
      ).length,
    };
  });
  expect(editorStyling.leftoverShadowStyles).toBe(0);
  expect(editorStyling.shadowAdopted).toBeGreaterThan(0);
  expect(editorStyling.documentAdopted).toBeGreaterThan(0);
  expect(editorStyling.leftoverGlobalStyles).toBe(0);

  // 真实输入 → 脏状态 → Ctrl+S 保存（mock Host 成功路径）。
  await editable.click();
  await expect(editable).toBeFocused();
  await page.keyboard.type("// 严格 CSP 编辑");
  await expect(page.getByText(/有未保存的修改/)).toBeVisible();
  await page.keyboard.press("Control+s");
  await expect(page.getByRole("button", { name: "保存修改" })).toBeDisabled();

  expect(await collectViolations(page), "编辑态必须零 CSP 违规").toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("严格 CSP：恶意文本按纯文本渲染且不产生违规", async ({ page }) => {
  const { consoleErrors, pageErrors } = await openDiffUnderStrictCsp(page);
  await page.getByRole("button", { name: "页内编辑" }).click();
  const editable = page
    .locator("diffs-container")
    .locator('[contenteditable="true"]')
    .first();
  await editable.click();
  await expect(editable).toBeFocused();
  // 输入 HTML 注入负载：必须作为文本处理，不生成可执行元素。
  await page.keyboard.insertText('<img src=x onerror="alert(1)">');
  const maliciousElements = await page.evaluate(() => {
    const container = document.querySelector("diffs-container");
    const root = container?.shadowRoot;
    return root ? root.querySelectorAll("script, img").length : -1;
  });
  expect(maliciousElements).toBe(0);
  expect(await collectViolations(page)).toEqual([]);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
