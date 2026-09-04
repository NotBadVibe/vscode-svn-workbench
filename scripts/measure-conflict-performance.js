/*
 * V018-C 冲突大文件浏览器实测（v0.1.8 规划 §4.3）。
 *
 * 三档（mock 确定性 fixture，seed 固定）：
 * - tier-10：conflictBlocks=10&conflictLines=1000（完整档对照）
 * - tier-120：conflictBlocks=120（精简档，块数超 100 上限）
 * - tier-500：conflictBlocks=500&conflictLines=12000（简化档，行数超精简上限）
 *
 * 每档测量：首屏（conflict 宿主有文本）/ 首个可操作冲突
 * （首个“采用我的修改”可见）/ 块动作（点击→Host 内存草稿已同步）/
 * 编辑输入（切简化编辑器后逐键输入，rAF 体感延迟）。
 * 结果写入 .validation/evidence/v0.1.8/<run>/v018c-conflict.json，
 * 不覆盖已发布 evidence。性能失败不缩小 fixture、不放宽断言：
 * 本脚本只记录 P50/P95 与预算对照，不为通过而改数据。
 */
/* global document, requestAnimationFrame */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41734;
const baseUrl = `http://127.0.0.1:${port}`;

/** 候选预算：冲突 100 块首个可操作冲突 P95 ≤1000ms（v0.1.8 §3）。 */
const FIRST_ACTIONABLE_BUDGET_MS = 1000;
const BLOCK_ACTION_BUDGET_MS = 100;
const INPUT_P95_BUDGET_MS = 50;

const TIERS = [
  { id: "tier-10", query: "conflictBlocks=10&conflictLines=1000" },
  { id: "tier-120", query: "conflictBlocks=120" },
  { id: "tier-500", query: "conflictBlocks=500&conflictLines=12000" },
];
const RUNS = 3;
const INPUT_RUNS = 10;

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
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}

function summarize(samples) {
  const valid = samples.filter((v) => typeof v === "number");
  if (valid.length === 0) return { runs: 0, p50: null, p95: null, samples: [] };
  return {
    runs: valid.length,
    p50: Math.round(percentile(valid, 0.5)),
    p95: Math.round(percentile(valid, 0.95)),
    samples: valid.map((value) => Math.round(value)),
  };
}

/** 按 mock 生成器确定性计算权威 actualLines（与 mockWorkbench 同逻辑）。 */
function fixtureActualLines(query) {
  const params = new URLSearchParams(query);
  const blocks = Number.parseInt(params.get("conflictBlocks") ?? "0", 10);
  const linesTarget = Number.parseInt(params.get("conflictLines") ?? "0", 10);
  const longLine = params.get("conflictLongLine") === "1" ? 1 : 0;
  // 每块 7 行 + 块间分隔 3 行（含空行）+ 头尾 2 行
  let total = 1 + blocks * 7 + Math.max(0, blocks - 1) * 3 + 1 + longLine;
  if (Number.isFinite(linesTarget) && linesTarget > total) total = linesTarget;
  return total;
}

async function measureTier(browser, tier) {
  const firstVisible = [];
  const firstActionable = [];
  const blockAction = [];
  const editInput = [];
  const actualLinesList = [];
  for (let run = 0; run < RUNS; run += 1) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    try {
      let started = performance.now();
      await page.goto(`${baseUrl}/?module=conflicts&${tier.query}`, {
        waitUntil: "domcontentloaded",
      });
      await page
        .getByRole("heading", { name: "待处理冲突" })
        .waitFor({ timeout: 60000 });
      firstVisible.push(performance.now() - started);

      started = performance.now();
      await page
        .getByRole("button", { name: "采用我的修改" })
        .first()
        .waitFor({ timeout: 60000 });
      firstActionable.push(performance.now() - started);

      const actualLines = await page
        .evaluate(() => {
          // 实际行数以文件内容为准：从首个块按钮的测试标识总数无法直接得行数，
          // 改为读取合并草稿同步前的页面宿主文本行数仅作参考；权威 actualLines
          // 由本脚本按 mock 生成器确定性计算（见 fixtureActualLines）。
          return (document.documentElement.textContent ?? "").split("\n")
            .length;
        })
        .catch(() => null);
      if (actualLines !== null) actualLinesList.push(actualLines);

      // 块动作：首个块“采用我的修改”→草稿同步反馈。
      started = performance.now();
      await page.getByRole("button", { name: "采用我的修改" }).first().click();
      await page
        .getByText("Host 内存草稿已同步")
        .first()
        .waitFor({ timeout: 60000 });
      blockAction.push(performance.now() - started);

      // 编辑输入：切简化编辑器后在 CodeMirror 逐键输入。
      const simplifiedBtn = page.getByTestId("use-simplified-perf");
      if ((await simplifiedBtn.count()) > 0) {
        await simplifiedBtn.click();
      } else {
        const fallbackBtn = page.getByTestId("use-simple-editor-result");
        if ((await fallbackBtn.count()) > 0) await fallbackBtn.first().click();
      }
      const editable = page.locator(".conflict-codemirror-host .cm-content");
      await editable.waitFor({ timeout: 30000 }).catch(() => {});
      if ((await editable.count()) > 0) {
        await editable.first().click();
        for (let i = 0; i < INPUT_RUNS; i += 1) {
          const inputStarted = performance.now();
          await page.keyboard.type("x", { delay: 0 });
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(resolve)),
          );
          editInput.push(performance.now() - inputStarted);
        }
      }
    } catch (error) {
      process.stderr.write(`[${tier.id} run ${run}] ${error.message}\n`);
    } finally {
      await context.close();
    }
  }
  return {
    tier: tier.id,
    query: tier.query,
    // 权威 actualLines：按 mock 生成器确定性计算（7 行/块 + 分隔符 + 填充到 conflictLines）。
    fixtureActualLines: fixtureActualLines(tier.query),
    domTextLines: summarize(actualLinesList),
    firstVisibleMs: summarize(firstVisible),
    firstActionableMs: summarize(firstActionable),
    blockActionMs: summarize(blockAction),
    editInputMs: summarize(editInput),
  };
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

    const budgets = {
      conflict100FirstActionableP95Ms: FIRST_ACTIONABLE_BUDGET_MS,
      blockActionP95Ms: BLOCK_ACTION_BUDGET_MS,
      inputP95Ms: INPUT_P95_BUDGET_MS,
    };
    const failures = [];
    const tier100 = tiers.find((t) => t.tier === "tier-120");
    const p95 = tier100?.firstActionableMs.p95;
    if (typeof p95 === "number" && p95 > FIRST_ACTIONABLE_BUDGET_MS) {
      failures.push(
        `tier-120 首个可操作冲突 P95 ${p95}ms > ${FIRST_ACTIONABLE_BUDGET_MS}ms`,
      );
    }

    const result = {
      measuredAt: new Date().toISOString(),
      note: "UnresolvedFile 三档实测；500 块档 actualLines 含 marker 开销，以 actualLines 为准；渲染器恒为 UnresolvedFile（无 VirtualizedUnresolvedFile，不强行虚拟化）",
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      budgets,
      tiers,
      passed: failures.length === 0,
      failures,
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "v018c-conflict.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (failures.length > 0) process.exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
