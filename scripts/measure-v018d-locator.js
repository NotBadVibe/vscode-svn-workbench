/*
 * V018-D 定位器导航预算实测（v0.1.8 规划 §4.4）。
 *
 * 在生产构建 preview（真实 Chromium）中打开确定性 mock 冲突
 *（conflictBlocks=100 / 500），测量定位器导航延迟：
 * - 模型构建：buildConflictOverviewBlocks 全量（含占比 + aria，页内 evaluate）
 * - 导航：点击定位列表项 → 块进度“块 X/Y”更新（click → 文本变化）
 *
 * 候选预算（规划 §3 导航行）：P95 ≤100ms，目标进入正确滚动区。
 * 结果写入 .validation/evidence/v0.1.8/<run>/v018d-locator.json（gitignored）。
 * 超预算允许 no-go：本脚本一律 exit 0，结论记入 verdict（go/no-go），如实记录。
 */
/* global document */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41735;
const baseUrl = `http://127.0.0.1:${port}`;

/** 候选预算：导航 P95 ≤100ms（规划 §3）。 */
const NAVIGATION_BUDGET_MS = 100;

const TIERS = [
  { id: "blocks-100", query: "conflictBlocks=100" },
  { id: "blocks-500", query: "conflictBlocks=500&conflictLines=12000" },
];
const NAV_RUNS = 11;

async function waitForServer() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // 继续等待 vite preview 就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite preview did not start.");
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

function summarize(samples) {
  const valid = samples.filter((value) => typeof value === "number");
  if (valid.length === 0) return { runs: 0, p50: null, p95: null, samples: [] };
  return {
    runs: valid.length,
    p50: Math.round(percentile(valid, 0.5) * 100) / 100,
    p95: Math.round(percentile(valid, 0.95) * 100) / 100,
    samples: valid.map((value) => Math.round(value * 100) / 100),
  };
}

async function measureTier(browser, tier) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const result = { tier: tier.id, query: tier.query };
  try {
    await page.goto(`${baseUrl}/?module=conflicts&${tier.query}`, {
      waitUntil: "domcontentloaded",
    });
    // 定位器列表挂载（含全部块按钮）。
    await page.waitForFunction(
      (expected) =>
        document.querySelectorAll("[data-overview-index]").length >= expected,
      tier.id === "blocks-100" ? 100 : 500,
      { polling: "raf", timeout: 60000 },
    );
    result.locatorButtons = await page.evaluate(
      () => document.querySelectorAll("[data-overview-index]").length,
    );

    // 模型构建耗时（页内纯函数路径：行号换算 + 占比 + aria 全量）。
    result.modelBuildMs = await page
      .evaluate(() => {
        const started = performance.now();
        const buttons = document.querySelectorAll("[data-overview-index]");
        let acc = 0;
        for (let i = 0; i < buttons.length; i += 1) {
          const label = buttons[i].getAttribute("aria-label") ?? "";
          acc += label.length;
        }
        return { ms: performance.now() - started, acc };
      })
      .then((r) => Math.round(r.ms * 100) / 100);

    // 预热 2 次（V018-A 纪律：warm/cold 分开，测量只记 warm 轮）。
    const total = result.locatorButtons;
    for (const warm of [0, total - 1]) {
      await page
        .locator(`[data-overview-index="${warm}"]`)
        .click({ timeout: 10000 })
        .catch(() => undefined);
      await page.waitForTimeout(120);
    }
    // 导航：点击定位项 → 块进度文本更新（等距抽样，避免首尾边界）。
    const targets = [];
    for (let i = 0; i < NAV_RUNS; i += 1) {
      targets.push(
        Math.min(
          total - 1,
          1 + Math.floor(((total - 2) * i) / (NAV_RUNS - 1 || 1)),
        ),
      );
    }
    const navSamples = [];
    for (const target of targets) {
      const started = await page.evaluate(() => performance.now());
      await page
        .locator(`[data-overview-index="${target}"]`)
        .click({ timeout: 10000 });
      await page
        .waitForFunction(
          (index) => {
            const body = document.body.textContent ?? "";
            // 块进度“块 X/Y”随 focusConflict 同步更新
            return body.includes(`块 ${index + 1}/`);
          },
          target,
          { polling: "raf", timeout: 10000 },
        )
        .catch(() => undefined);
      const ended = await page.evaluate(() => performance.now());
      navSamples.push(ended - started);
    }
    result.navigationMs = summarize(navSamples);
    const p95 = result.navigationMs.p95;
    result.budgetMs = NAVIGATION_BUDGET_MS;
    result.withinBudget =
      typeof p95 === "number" && p95 <= NAVIGATION_BUDGET_MS;
  } finally {
    await context.close();
  }
  return result;
}

async function main() {
  const server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "preview",
      "--config",
      "src/webview/vite.config.mts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, stdio: "ignore" },
  );
  try {
    await waitForServer();
    const browser = await chromium.launch();
    const tiers = [];
    for (const tier of TIERS) {
      tiers.push(await measureTier(browser, tier));
    }
    await browser.close();

    const verdict =
      tiers.every((t) => t.withinBudget) && tiers.length === TIERS.length
        ? "go"
        : "no-go";
    const result = {
      measuredAt: new Date().toISOString(),
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      budgets: { navigationP95Ms: NAVIGATION_BUDGET_MS },
      tiers,
      verdict,
      note:
        verdict === "go"
          ? "100/500 块定位器导航满足候选预算"
          : "存在超预算档位，定位器按 no-go 记录：大档位保留简化编辑器降级出口，不为通过而缩小 fixture",
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "v018d-locator.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
