import { expect, test, type Page } from "@playwright/test";

/*
 * 阶段 0 Spike 实测（v0.0.4 规划 §5）：
 * - P0：@pierre/diffs 在生产等价严格 CSP（style-src 无 'unsafe-inline'）下
 *   能否完整渲染增删行着色与语法高亮；样式注入通道归因（adoptedStyleSheets /
 *   内联 <style> / style 属性）。
 * - P0 对照：同一页面在放开 style-src 'unsafe-inline' 的 CSP 下的渲染结果，
 *   用于判定被拦截部分是否影响最终像素。
 * - P1：VS Code 变量 → --diffs-* 映射在 light/dark/hc 三主题下增删行可辨识。
 * - 附带验证：同 CSP 下 CodeMirror MergeView（现状实现）是否本来就被拦截。
 * 探测数据由被测页面挂到 window.__spike（见 tests/spike/src/main.ts）。
 */

interface CspViolationRecord {
  blockedURI: string;
  effectiveDirective: string;
  disposition: string;
  sample: string;
}

interface PierreProbe {
  containerCount: number;
  adoptedSheets: number;
  shadowStyleElements: number;
  rowCounts: { addition: number; deletion: number; context: number };
  additionRowBg: string;
  deletionRowBg: string;
  contextRowBg: string;
  additionIndicator: string;
  preHeights: number[];
  patchErrors: string[];
  gutterAdditionMarker: string;
  tokenSpanCount: number;
  tokenInlineStyleCount: number;
  firstTokenInlineStyle: string;
  firstTokenComputedColor: string;
  headerFontFamily: string;
  expandButtons: {
    count: number;
    tagName: string;
    role: string | null;
    tabIndex: number;
    ariaLabel: string | null;
    textContent: string;
  };
}

interface CmProbe {
  hasEditor: boolean;
  headStyleElements: number;
  headStyleSnippet: string;
  documentAdoptedSheets: number;
  contentPaddingLeft: string;
  contentMinHeight: string;
  gutterVisible: boolean;
}

interface SpikeReport {
  ready: boolean;
  theme: string;
  view: string;
  cspViolations: CspViolationRecord[];
  patchStatus: string;
  patchGitStatus: string;
  pierre: PierreProbe | null;
  cm: CmProbe | null;
  cspSelfTest: {
    setPropertyColor: string;
    cssTextColor: string;
    setAttributeColor: string;
    innerHtmlColor: string;
  } | null;
}

interface SpikePageResult {
  report: SpikeReport;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

async function loadSpike(page: Page, query: string): Promise<SpikePageResult> {
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
  await page.goto(`/?${query}`);
  await page.waitForFunction(
    () =>
      (window as unknown as { __spike?: SpikeReport }).__spike?.ready === true,
  );
  const report = await page.evaluate(
    () => (window as unknown as { __spike: SpikeReport }).__spike,
  );
  return { report, consoleErrors, pageErrors, failedRequests };
}

function expectPierreHealthy(result: SpikePageResult): PierreProbe {
  const { report, pageErrors, failedRequests } = result;
  expect(pageErrors, "页面运行时不应有未捕获异常").toEqual([]);
  expect(failedRequests, "严格 CSP 下不应有资源加载失败").toEqual([]);
  expect(report.pierre, "pierre 探测应存在").not.toBeNull();
  const pierre = report.pierre as PierreProbe;
  expect(pierre.containerCount).toBe(3);
  expect(report.patchStatus).toMatch(/^rendered:/);
  expect(report.patchGitStatus).toMatch(/^rendered:/);
  expect(pierre.rowCounts.addition).toBeGreaterThan(0);
  expect(pierre.rowCounts.deletion).toBeGreaterThan(0);
  expect(pierre.rowCounts.context).toBeGreaterThan(0);
  expect(pierre.patchErrors).toEqual([]);
  return pierre;
}

test.describe.configure({ mode: "serial" });

test("严格 CSP：pierre 渲染增删行着色，svn/git patch 输入均可用", async ({
  page,
}) => {
  const result = await loadSpike(page, "csp=strict&theme=dark&view=split");
  const pierre = expectPierreHealthy(result);

  // 增删行背景必须与上下文行不同（行级着色生效）
  expect(pierre.additionRowBg).not.toBe("");
  expect(pierre.deletionRowBg).not.toBe("");
  expect(pierre.additionRowBg).not.toBe(pierre.contextRowBg);
  expect(pierre.deletionRowBg).not.toBe(pierre.contextRowBg);
  expect(pierre.additionRowBg).not.toBe(pierre.deletionRowBg);

  // 样式注入通道归因证据
  console.log(
    `[spike] strict 注入通道: adoptedStyleSheets=${pierre.adoptedSheets} ` +
      `shadowStyleElements=${pierre.shadowStyleElements} ` +
      `tokenInlineStyle=${pierre.tokenInlineStyleCount}/${pierre.tokenSpanCount} ` +
      `firstTokenColor=${pierre.firstTokenComputedColor}`,
  );
  const violationSummary = result.report.cspViolations.reduce<
    Record<string, number>
  >((acc, violation) => {
    acc[violation.effectiveDirective] =
      (acc[violation.effectiveDirective] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `[spike] strict CSP violations by directive: ${JSON.stringify(violationSummary)} (total=${result.report.cspViolations.length})`,
  );
  console.log(
    `[spike] strict console errors: ${JSON.stringify(result.consoleErrors)}`,
  );
});

test("严格 CSP 与放开内联的渲染结果对比（像素级归因）", async ({ page }) => {
  const strict = await loadSpike(page, "csp=strict&theme=dark&view=split");
  const relaxed = await loadSpike(
    page,
    "csp=unsafe-inline&theme=dark&view=split",
  );
  const strictPierre = expectPierreHealthy(strict);
  const relaxedPierre = expectPierreHealthy(relaxed);

  console.log(
    `[spike] strict  token: spans=${strictPierre.tokenSpanCount} inline=${strictPierre.tokenInlineStyleCount} color=${strictPierre.firstTokenComputedColor} | ` +
      `relaxed token: spans=${relaxedPierre.tokenSpanCount} inline=${relaxedPierre.tokenInlineStyleCount} color=${relaxedPierre.firstTokenComputedColor}`,
  );
  console.log(
    `[spike] strict  rowBg: add=${strictPierre.additionRowBg} del=${strictPierre.deletionRowBg} ctx=${strictPierre.contextRowBg} | ` +
      `relaxed rowBg: add=${relaxedPierre.additionRowBg} del=${relaxedPierre.deletionRowBg} ctx=${relaxedPierre.contextRowBg}`,
  );
  console.log(
    `[spike] relaxed CSP violations: ${JSON.stringify(relaxed.report.cspViolations)}`,
  );

  // 关键判定：严格 CSP 下增删行背景必须与对照组一致（行级着色不受拦截影响）
  expect(strictPierre.additionRowBg).toBe(relaxedPierre.additionRowBg);
  expect(strictPierre.deletionRowBg).toBe(relaxedPierre.deletionRowBg);
  expect(strictPierre.contextRowBg).toBe(relaxedPierre.contextRowBg);
});

test("严格 CSP + 兼容垫片：零违规且语法高亮完整恢复", async ({ page }) => {
  // cm=0 排除 CodeMirror 对照组（其 head <style> 注入是现状实现的已知行为，
  // 在专门用例中单独记录），只评估 @pierre/diffs 自身的 CSP 兼容性。
  const shimmed = await loadSpike(
    page,
    "csp=strict&theme=dark&view=split&shim=1&cm=0",
  );
  const relaxed = await loadSpike(
    page,
    "csp=unsafe-inline&theme=dark&view=split",
  );
  const shimPierre = expectPierreHealthy(shimmed);
  const relaxedPierre = expectPierreHealthy(relaxed);

  console.log(
    `[spike] shim 注入通道: adoptedStyleSheets=${shimPierre.adoptedSheets} ` +
      `shadowStyleElements=${shimPierre.shadowStyleElements} ` +
      `tokenColor=${shimPierre.firstTokenComputedColor}（对照 ${relaxedPierre.firstTokenComputedColor}）`,
  );
  console.log(
    `[spike] shim CSP violations: ${JSON.stringify(shimmed.report.cspViolations)}`,
  );

  // 垫片后：不应再有任何 CSP 违规
  expect(shimmed.report.cspViolations).toEqual([]);
  // token 语法高亮颜色与放开内联的对照组一致
  expect(shimPierre.firstTokenComputedColor).toBe(
    relaxedPierre.firstTokenComputedColor,
  );
  // 行级着色保持一致
  expect(shimPierre.additionRowBg).toBe(relaxedPierre.additionRowBg);
  expect(shimPierre.deletionRowBg).toBe(relaxedPierre.deletionRowBg);
});

test("三主题：增删行在 light/dark/hc 下均可辨识且不只靠颜色", async ({
  page,
}) => {
  for (const theme of ["light", "dark", "hc"] as const) {
    const result = await loadSpike(
      page,
      `csp=strict&theme=${theme}&view=split`,
    );
    const pierre = expectPierreHealthy(result);
    expect(
      pierre.additionRowBg,
      `${theme} 主题新增行背景应区别于上下文行`,
    ).not.toBe(pierre.contextRowBg);
    expect(
      pierre.deletionRowBg,
      `${theme} 主题删除行背景应区别于上下文行`,
    ).not.toBe(pierre.contextRowBg);
    // 不只依赖颜色：gutter 或行首必须有 +/- 指示符
    const indicator =
      pierre.gutterAdditionMarker !== ""
        ? pierre.gutterAdditionMarker
        : pierre.additionIndicator;
    expect(indicator, `${theme} 主题应存在非颜色增删指示符`).not.toBe("");
    console.log(
      `[spike] theme=${theme} add=${pierre.additionRowBg} del=${pierre.deletionRowBg} ` +
        `ctx=${pierre.contextRowBg} gutterMarker=${JSON.stringify(pierre.gutterAdditionMarker)} ` +
        `indicator=${pierre.additionIndicator}`,
    );
  }
});

test("视图形态：unified 与 split 都能渲染增删行", async ({ page }) => {
  for (const view of ["split", "unified"] as const) {
    const result = await loadSpike(page, `csp=strict&theme=dark&view=${view}`);
    const pierre = expectPierreHealthy(result);
    expect(pierre.additionRowBg).not.toBe(pierre.contextRowBg);
    console.log(
      `[spike] view=${view} rows=${JSON.stringify(pierre.rowCounts)} preHeights=${JSON.stringify(pierre.preHeights)}`,
    );
  }
});

test("附带验证：同 CSP 下 CodeMirror MergeView 样式注入是否被拦截", async ({
  page,
}) => {
  const strict = await loadSpike(page, "csp=strict&theme=dark&view=split");
  const relaxed = await loadSpike(
    page,
    "csp=unsafe-inline&theme=dark&view=split",
  );
  expect(strict.report.cm?.hasEditor).toBe(true);
  console.log(
    `[spike] cm strict:  headStyles=${strict.report.cm?.headStyleElements} ` +
      `paddingLeft=${strict.report.cm?.contentPaddingLeft} minHeight=${strict.report.cm?.contentMinHeight} ` +
      `gutterVisible=${strict.report.cm?.gutterVisible} adoptedSheets=${strict.report.cm?.documentAdoptedSheets}`,
  );
  console.log(
    `[spike] cm relaxed: headStyles=${relaxed.report.cm?.headStyleElements} ` +
      `paddingLeft=${relaxed.report.cm?.contentPaddingLeft} minHeight=${relaxed.report.cm?.contentMinHeight} ` +
      `gutterVisible=${relaxed.report.cm?.gutterVisible}`,
  );
  console.log(
    `[spike] cm headStyleSnippet(strict): ${JSON.stringify(strict.report.cm?.headStyleSnippet)}`,
  );
});

test("可访问性抽查：折叠展开控件的键盘可达与 aria 现状", async ({ page }) => {
  const result = await loadSpike(page, "csp=strict&theme=dark&view=split");
  const pierre = expectPierreHealthy(result);
  console.log(
    `[spike] a11y expandButtons: ${JSON.stringify(pierre.expandButtons)}`,
  );
  // 长未变更区段应产生折叠/展开控件（样例含 19 行未变更 pad 函数）
  expect(pierre.expandButtons.count).toBeGreaterThan(0);
});

test("CSP 行为自测：CSSOM 通道放行、HTML 解析期 style 属性被拦截", async ({
  page,
}) => {
  const result = await loadSpike(
    page,
    "csp=strict&theme=dark&view=split&selftest=1",
  );
  const selfTest = result.report.cspSelfTest;
  expect(selfTest).not.toBeNull();
  console.log(`[spike] cspSelfTest: ${JSON.stringify(selfTest)}`);
  // CSSOM 通道不受 style-src 限制（垫片的依据）
  expect(selfTest?.setPropertyColor).toBe("rgb(1, 2, 3)");
  expect(selfTest?.cssTextColor).toBe("rgb(4, 5, 6)");
  // HTML 解析期 style 属性被拦截，颜色不落盘
  expect(selfTest?.setAttributeColor).not.toBe("rgb(7, 8, 9)");
  expect(selfTest?.innerHtmlColor).not.toBe("rgb(10, 11, 12)");
});
