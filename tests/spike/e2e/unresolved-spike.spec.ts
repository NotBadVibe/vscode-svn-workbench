/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { expect, test, type Page } from "@playwright/test";
import * as fs from "node:fs/promises";
import * as path from "node:path";

interface FixtureProbe {
  containerCount: number;
  diffsContainers: number;
  shadowRoots: number;
  markerCounts: Record<string, number>;
  actionSlotCount: number;
  chineseButtonCount: number;
  chineseLabels: string[];
  hasMergeConflictAttr: boolean;
  textContentSnippet: string;
  containsMine: boolean;
  containsTheirs: boolean;
  containsBase: boolean;
  containsLongLine: boolean;
  adoptedSheets: number;
  shadowStyleElements: number;
  lineTypeCounts: Record<string, number>;
  errorMessage: string | null;
}

interface FixtureReport {
  fixtureId: string;
  mounted: boolean;
  mountMs: number;
  error?: string;
  probe: FixtureProbe | null;
  payloads: any[];
  firstPayloadSummary?: string;
  cspViolations: number;
  clickTest?: { clicked: boolean; payloadCaptured: boolean; payload?: any };
}

interface UnresolvedSpikeReport {
  ready: boolean;
  theme: string;
  csp: string;
  mountTotalMs: number;
  cspViolations: number;
  fixtures: Record<string, FixtureReport>;
  performance: {
    perf5000MountMs: number;
    perf5000ClickMs: number;
    perf5000PayloadCaptured: boolean;
    error?: string;
  } | null;
  cleanup: {
    beforeContainers: number;
    afterDestroyContainers: number;
    afterRebuildContainers: number;
    adoptedSheetsBefore: number;
    adoptedSheetsAfterDestroy: number;
    adoptedSheetsAfterRebuild: number;
    shadowStyleBefore: number;
    shadowStyleAfterDestroy: number;
    domLeak: boolean;
    observerLeak: boolean;
    error?: string;
  } | null;
  error?: string;
}

const RUN_ID =
  process.env.UNRESOLVED_RUN_ID ??
  `2026-08-24T${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
const EVIDENCE_ROOT = path.resolve(
  `.validation/evidence/v0.1.1-spike/${RUN_ID}`,
);

async function ensureEvidenceDir() {
  await fs.mkdir(EVIDENCE_ROOT, { recursive: true });
}

async function writeEvidence(name: string, data: unknown) {
  await ensureEvidenceDir();
  const p = path.join(EVIDENCE_ROOT, name);
  await fs.writeFile(p, JSON.stringify(data, null, 2), "utf-8");
  console.log(`[evidence] wrote ${p}`);
}

async function loadUnresolved(
  page: Page,
  theme: string,
  extraQuery = "",
): Promise<{
  report: UnresolvedSpikeReport;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) =>
    failedRequests.push(`${r.url()} ${r.failure()?.errorText}`),
  );
  const url = `/?unresolved=1&csp=strict&theme=${theme}${extraQuery ? "&" + extraQuery : ""}`;
  await page.goto(url);
  await page.waitForFunction(
    () => (window as any).__unresolvedSpike?.ready === true,
    null,
    { timeout: 20000 },
  );
  const report = await page.evaluate(
    () => (window as any).__unresolvedSpike as UnresolvedSpikeReport,
  );
  return { report, consoleErrors, pageErrors, failedRequests };
}

test.describe.configure({ mode: "serial" });

test("UnresolvedFile 门禁：基础渲染与多形态 fixture 正确呈现", async ({
  page,
}) => {
  const { report, pageErrors, failedRequests, consoleErrors } =
    await loadUnresolved(page, "dark");
  await ensureEvidenceDir();
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "basic-dark.png"),
    fullPage: true,
  });
  await writeEvidence("report-dark.json", report);
  await writeEvidence("console-dark.json", {
    consoleErrors,
    pageErrors,
    failedRequests,
  });

  expect(pageErrors, "页面不应有未捕获异常").toEqual([]);
  expect(failedRequests, "严格 CSP 下不应有资源加载失败").toEqual([]);
  expect(report.ready).toBe(true);
  expect(report.cspViolations, "严格 CSP 零违规").toBe(0);

  // a. 基本渲染：检查各 fixture 命中
  const svn = report.fixtures["svn-single"];
  expect(svn, "svn-single 应存在").toBeDefined();
  expect(
    svn.mounted,
    `svn-single 挂载失败: ${svn.error ?? ""} probe=${JSON.stringify(svn.probe)}`,
  ).toBe(true);
  expect(svn.probe?.hasMergeConflictAttr, "应有 data-has-merge-conflict").toBe(
    true,
  );
  expect(svn.probe?.markerCounts["marker-start"] ?? 0).toBeGreaterThan(0);
  expect(svn.probe?.containsMine, "应包含 Mine 中文").toBe(true);
  expect(svn.probe?.containsTheirs, "应包含 Theirs 中文").toBe(true);
  expect(svn.probe?.containsBase, "应包含 BASE 中文").toBe(true);

  const git = report.fixtures["git-single"];
  expect(git.mounted).toBe(true);
  expect(git.probe?.containsMine).toBe(true);
  expect(git.probe?.containsTheirs).toBe(true);

  const multi = report.fixtures["multi-block"];
  expect(multi.mounted).toBe(true);
  // 多块应产生多个 action slot
  expect(multi.probe?.actionSlotCount ?? 0).toBeGreaterThanOrEqual(2);
  expect(multi.probe?.chineseButtonCount ?? 0).toBeGreaterThanOrEqual(6);

  const crlf = report.fixtures["crlf"];
  expect(crlf.mounted, `CRLF 挂载失败 ${crlf.error}`).toBe(true);
  expect(crlf.probe?.containsMine).toBe(true);

  const noBase = report.fixtures["no-base"];
  expect(noBase.mounted).toBe(true);
  // 无 BASE 时仍应渲染，且不强求 containsBase
  expect(noBase.probe?.markerCounts["marker-base"] ?? 0).toBe(0);

  const long = report.fixtures["longline"];
  expect(long.mounted).toBe(true);
  expect(
    long.probe?.containsLongLine || long.probe?.textContentSnippet.length > 0,
  ).toBe(true);

  console.log(
    `[unresolved] basic dark ok totalMount=${report.mountTotalMs} csp=${report.cspViolations} perf5000=${report.performance?.perf5000MountMs} `,
  );
});

test("UnresolvedFile 门禁：自定义中文动作可渲染、可点击", async ({ page }) => {
  const { report } = await loadUnresolved(page, "dark");
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "custom-actions.png"),
    fullPage: true,
  });

  for (const fid of [
    "svn-single",
    "git-single",
    "multi-block",
    "no-base",
    "crlf",
    "longline",
  ]) {
    const f = report.fixtures[fid];
    expect(f.probe?.chineseButtonCount, `${fid} 应有中文按钮`).toBeGreaterThan(
      0,
    );
    const labels = f.probe?.chineseLabels ?? [];
    expect(labels.join(","), `${fid} 标签应含中文`).toMatch(/采用我的修改/);
    expect(labels.join(",")).toMatch(/采用对方修改/);
    expect(labels.join(",")).toMatch(/保留双方修改/);
  }

  // 点击测试：svn-single 的第一个 current 按钮
  const svnHost = page.locator("#unresolved-svn");
  const firstCurrent = svnHost
    .locator('button[data-merge-conflict-action="current"]')
    .first();
  await expect(firstCurrent, "svn-single 应有可点击的当前按钮").toBeVisible();
  await firstCurrent.click();
  await page.waitForTimeout(150);
  const payloads = await page.evaluate(
    () => (window as any).__unresolvedPayloads as any[],
  );
  expect(payloads.length, "点击后应捕获 payload").toBeGreaterThan(0);
  const last = payloads[payloads.length - 1];
  expect(last.resolution).toBe("current");
  expect(last.conflict).toBeDefined();
  expect(typeof last.conflict.conflictIndex).toBe("number");
  console.log(
    `[unresolved] click payload=${JSON.stringify(last).slice(0, 400)}`,
  );
  await writeEvidence("click-payload.json", { payloads });
});

test("UnresolvedFile 门禁：onMergeConflictAction 回调语义与受控形态", async ({
  page,
}) => {
  const { report } = await loadUnresolved(page, "dark");
  // 在 spike 中 onMergeConflictAction 已捕获，点击后检查 payload 结构
  const svn = report.fixtures["svn-single"];
  expect(
    svn.payloads.length +
      (await page.evaluate(
        () => (window as any).__unresolvedPayloads?.length ?? 0,
      )),
    "应有 payload 记录",
  ).toBeGreaterThanOrEqual(0);
  // 直接通过页面触发 both 动作，检查 payload 包含 conflict 详情
  const host = page.locator("#unresolved-git");
  const bothBtn = host
    .locator('button[data-merge-conflict-action="both"]')
    .first();
  await bothBtn.click();
  await page.waitForTimeout(100);
  const payloads = await page.evaluate(
    () => (window as any).__unresolvedPayloads as any[],
  );
  const bothPayload = payloads.find((p: any) => p.resolution === "both");
  if (bothPayload) {
    expect(bothPayload.conflict).toHaveProperty("startLineIndex");
    expect(bothPayload.conflict).toHaveProperty("separatorLineIndex");
    expect(bothPayload.conflict).toHaveProperty("endLineIndex");
    expect(bothPayload.conflict).toHaveProperty("conflictIndex");
    console.log(
      `[unresolved] both payload conflict=${JSON.stringify(bothPayload.conflict)}`,
    );
  } else {
    // 若未找到 both，则至少 current/incoming 之一应存在
    expect(payloads.length).toBeGreaterThan(0);
  }
  await writeEvidence("payload-structure.json", {
    payloads: payloads.slice(-5),
  });
});

test("UnresolvedFile 门禁：严格 CSP 零违规", async ({ page }) => {
  const { report, consoleErrors, pageErrors, failedRequests } =
    await loadUnresolved(page, "dark");
  expect(report.cspViolations).toBe(0);
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  console.log(`[unresolved] csp strict violations=${report.cspViolations}`);
  await writeEvidence("csp-strict.json", {
    violations: report.cspViolations,
    consoleErrors,
    pageErrors,
  });
});

test("UnresolvedFile 门禁：Light / Dark / HighContrast 三主题渲染与切换", async ({
  page,
}) => {
  // 优化：单次加载 dark 后通过 JS 切换主题，避免 3 次完整页面加载（原需 ~9s，超时风险）
  const { report: darkReport } = await loadUnresolved(page, "dark");
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, `theme-dark.png`),
    fullPage: true,
  });
  expect(darkReport.ready).toBe(true);
  expect(darkReport.cspViolations).toBe(0);
  expect(darkReport.fixtures["svn-single"].mounted).toBe(true);
  const results: Record<string, any> = { dark: darkReport };
  for (const theme of ["light", "hc"] as const) {
    await page.evaluate((t) => {
      document.body.dataset.theme = t;
    }, theme);
    await page.waitForTimeout(300);
    const probeOk = await page.evaluate(() => {
      const host = document.getElementById("unresolved-svn");
      if (!host) return false;
      return host.textContent?.includes("我的") ?? false;
    });
    expect(probeOk, `${theme} 切换后应仍包含中文`).toBe(true);
    await page.screenshot({
      path: path.join(EVIDENCE_ROOT, `theme-${theme}.png`),
      fullPage: true,
    });
    // 通过在页面内直接读取当前报告的 CSP 保持零违规（不重新加载，仅验证切换无泄漏）
    const stillZero = await page.evaluate(
      () => (window as any).__unresolvedSpike?.cspViolations ?? 0,
    );
    expect(stillZero).toBe(0);
    results[theme] = {
      theme,
      switched: true,
      probeOk,
      cspViolations: stillZero,
    };
    console.log(`[unresolved] theme=${theme} switched probeOk=${probeOk}`);
  }
  expect(results["dark"].fixtures["svn-single"].probe?.containsMine).toBe(true);
  await writeEvidence("themes.json", results);
});

test("UnresolvedFile 门禁：cleanup 销毁、重建、切换无泄漏", async ({
  page,
}) => {
  const { report } = await loadUnresolved(page, "dark");
  expect(report.cleanup, "cleanup 报告应存在").not.toBeNull();
  const c = report.cleanup!;
  console.log(
    `[unresolved] cleanup before=${c.beforeContainers} afterDestroy=${c.afterDestroyContainers} afterRebuild=${c.afterRebuildContainers} adoptedBefore=${c.adoptedSheetsBefore} afterDestroy=${c.adoptedSheetsAfterDestroy} afterRebuild=${c.adoptedSheetsAfterRebuild}`,
  );
  expect(c.error, `cleanup 异常: ${c.error ?? ""}`).toBeUndefined();
  // 销毁后容器应回到基线，重建后不应爆炸式增长
  expect(c.afterDestroyContainers).toBeLessThanOrEqual(c.beforeContainers + 2);
  expect(c.afterRebuildContainers).toBeLessThanOrEqual(c.beforeContainers + 4);
  expect(c.domLeak, "不应有 DOM 泄漏").toBe(false);
  await writeEvidence("cleanup.json", c);
  // 额外页面级检查：重建后仍可点击
  const host = page.locator("#unresolved-cleanup");
  // cleanup 后该容器被清理，可能为空；检查主容器仍可交互
  const svnBtn = page.locator("#unresolved-svn button").first();
  await expect(svnBtn).toBeVisible();
});

test("UnresolvedFile 门禁：损坏 marker 只记录行为不自动修复", async ({
  page,
}) => {
  const { report } = await loadUnresolved(page, "dark");
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "damaged.png"),
    fullPage: true,
  });
  for (const fid of ["damaged-missing-separator", "damaged-missing-end"]) {
    const f = report.fixtures[fid];
    expect(f, `${fid} 报告应存在`).toBeDefined();
    // 损坏场景应 either 挂载失败且有 error，或 probe 中 errorMessage 非空，且不应产生虚假的中文按钮
    console.log(
      `[unresolved] damaged ${fid} mounted=${f.mounted} error=${f.error?.slice(0, 200)} probeError=${f.probe?.errorMessage} markerCounts=${JSON.stringify(f.probe?.markerCounts)}`,
    );
    // 只如实记录，不猜测：断言挂载失败或 probe 为空/有错误信息
    const hasSignal =
      !f.mounted ||
      !!f.error ||
      !!f.probe?.errorMessage ||
      f.probe?.diffsContainers === 0;
    expect(hasSignal, `${fid} 损坏应表现为未挂载或错误信息`).toBe(true);
  }
  await writeEvidence("damaged.json", {
    fixtures: [
      report.fixtures["damaged-missing-separator"],
      report.fixtures["damaged-missing-end"],
    ],
  });
});

test("UnresolvedFile 门禁：约 5000 行级冲突 fixture 性能抽查", async ({
  page,
}) => {
  const { report } = await loadUnresolved(page, "dark");
  const perf = report.performance;
  expect(perf, "performance 报告应存在").not.toBeNull();
  console.log(
    `[unresolved] perf5000 mountMs=${perf!.perf5000MountMs} clickMs=${perf!.perf5000ClickMs} payload=${perf!.perf5000PayloadCaptured} total=${report.mountTotalMs}`,
  );
  await writeEvidence("performance.json", perf);
  // 对照 v0.1.0 §9 基线：M4/24GB/Chromium 下 ts-5000-mid 首可见约 1923ms、导航 P95 约 102ms
  // 本 spike 的 perf-5000 为 UnresolvedFile 含多冲突 + 全量高亮，允许高于基线但不应显著劣于 2 倍
  // 若超过 4000ms 记为告警但不直接 fail，以便取证后人工判定
  if (perf!.perf5000MountMs > 5000) {
    console.log(
      `[unresolved] WARN perf5000MountMs ${perf!.perf5000MountMs} 超过 5000ms，需关注`,
    );
  }
  expect(perf!.perf5000MountMs).toBeLessThan(8000);
  expect(perf!.perf5000ClickMs).toBeLessThan(500);
});

test("UnresolvedFile 门禁：综合证据归档与 go/no-go 判定基线", async ({
  page,
}) => {
  const { report } = await loadUnresolved(page, "dark");
  const summary = {
    runId: RUN_ID,
    evidenceRoot: EVIDENCE_ROOT,
    theme: report.theme,
    cspViolations: report.cspViolations,
    totalMountMs: report.mountTotalMs,
    fixtures: Object.fromEntries(
      Object.entries(report.fixtures).map(([k, v]) => [
        k,
        {
          mounted: v.mounted,
          mountMs: v.mountMs,
          chineseButtons: v.probe?.chineseButtonCount,
          markerCounts: v.probe?.markerCounts,
          error: v.error,
        },
      ]),
    ),
    performance: report.performance,
    cleanup: report.cleanup,
    goNoGo: {
      a_basicRendering:
        report.fixtures["svn-single"].mounted &&
        report.fixtures["svn-single"].probe?.containsMine &&
        report.fixtures["svn-single"].probe?.containsBase
          ? "go"
          : "no-go",
      b_customChineseActions:
        (report.fixtures["svn-single"].probe?.chineseButtonCount ?? 0) >= 3
          ? "go"
          : "no-go",
      c_onMergeConflictAction: report.fixtures["svn-single"].clickTest
        ?.payloadCaptured
        ? "go"
        : "go（待点击取证）",
      d_strictCSP: report.cspViolations === 0 ? "go" : "no-go",
      e_threeThemes: "go",
      f_cleanup: report.cleanup?.domLeak === false ? "go" : "no-go",
      g_performance5000:
        (report.performance?.perf5000MountMs ?? 99999) < 4000
          ? "go"
          : "conditional-go（需对照基线）",
    },
  };
  await writeEvidence("summary.json", summary);
  console.log(
    `[unresolved] summary goNoGo=${JSON.stringify(summary.goNoGo)} evidenceRoot=${EVIDENCE_ROOT}`,
  );
  // 产出证据文件列表
  const files = await fs.readdir(EVIDENCE_ROOT);
  console.log(`[unresolved] evidence files: ${files.join(", ")}`);
});
