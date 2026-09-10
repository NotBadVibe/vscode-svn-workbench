/*
 * V027-R53 大 Diff 与冲突可读可操作性能：本轮重测基线（前序修复后的生产构建）。
 *
 * 矩阵（固定，不缩小）：
 * - Diff：ts-100-mid / ts-1000-mid / ts-5000-mid / ts-10000-mid
 * - 冲突：conflictBlocks=10 / 100 / 500(+conflictLines=12000，简化档)
 *
 * 每档：冷启动（全新 context 首访）× COLD_RUNS + 暖启动（同 context reload）× WARM_RUNS。
 * 指标：
 * - Diff：首个可读内容（goto→diffs-container 有文本，可滚动真实代码）/
 *   首个可操作（变更块位置可见）/ 滚动探针。
 * - 冲突：首屏（标题）/ 首个可操作冲突（首个“采用我的修改”可见）/
 *   降级出口可用（conflict-perf-summary 可见 + 简化/外部按钮可点击，
 *   仅 reduced/simplified 档）/ 块动作（点击→Host 内存草稿已同步；
 *   simplified 按需加载档无块按钮时如实记 no-data，不等待超时）/
 *   简化编辑就绪（点出口→简化编辑器可交互，tier-500 交付路径）/
 *   简化编辑输入（逐键 rAF；tier-500 用 200 键连续输入，附内容一致+
 *   焦点保持断言）/ 连续切换 100 次稳定性（tier-10/100 交替，DOM/堆增长+
 *   页面错误计数）。
 * actualLines：Diff 取 fixture 行数；冲突按 mock 生成器确定性公式
 * （1 + 块数×7 + (块数-1)×3 + 1 + 长行，conflictLines 目标取大）。
 * 结果写入 <evidenceDir>/v027-r53-<stage>.json（stage=baseline|after），
 * 不覆盖已发布 evidence。候选门禁逐档断言：超预算则 passed=false 且进程
 * exit 非零（fail-closed）；设备/样本分布为信息对照，与门禁分开记录。
 * 纪律：性能失败不缩 fixture、不放宽断言（注释保留）。
 */
/* global document, requestAnimationFrame, getComputedStyle */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = 41736;
const baseUrl = `http://127.0.0.1:${port}`;
const STAGE = process.env.V027_R53_STAGE === "after" ? "after" : "baseline";
const COLD_RUNS = 5;
const WARM_RUNS = 5;
const INPUT_KEYS = 10;
// V027-R53终审 P1-6：tier-500 简化交付路径用 200 键连续输入补测。
const STABILITY_INPUT_KEYS = 200;
// V027-R53终审 P1-6：连续切换次数（tier-10/100 交替，与 v018g-lifecycle 同口径）。
const SWITCH_RUNS = 100;

const DIFF_FIXTURES = [
  { id: "ts-100-mid", lines: 100 },
  { id: "ts-1000-mid", lines: 1000 },
  { id: "ts-5000-mid", lines: 5000 },
  { id: "ts-10000-mid", lines: 10000 },
];

const CONFLICT_TIERS = [
  { id: "tier-10", blocks: 10, query: "conflictBlocks=10" },
  { id: "tier-100", blocks: 100, query: "conflictBlocks=100" },
  {
    id: "tier-500",
    blocks: 500,
    query: "conflictBlocks=500&conflictLines=12000",
  },
];

function conflictActualLines(query) {
  const params = new URLSearchParams(query);
  const blocks = Number.parseInt(params.get("conflictBlocks") ?? "0", 10);
  const linesTarget = Number.parseInt(params.get("conflictLines") ?? "0", 10);
  const longLine = params.get("conflictLongLine") === "1" ? 1 : 0;
  let total = 1 + blocks * 7 + Math.max(0, blocks - 1) * 3 + 1 + longLine;
  if (Number.isFinite(linesTarget) && linesTarget > total) total = linesTarget;
  return total;
}

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
    Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1),
    )
  ];
}

function summarize(samples) {
  const valid = samples.filter((v) => typeof v === "number");
  if (valid.length === 0) return { runs: 0, p50: null, p95: null, samples: [] };
  const rounded = valid.map((v) => Math.round(v * 100) / 100);
  return {
    runs: rounded.length,
    p50: Math.round(percentile(rounded, 0.5) * 100) / 100,
    p95: Math.round(percentile(rounded, 0.95) * 100) / 100,
    min: Math.min(...rounded),
    max: Math.max(...rounded),
    samples: rounded,
  };
}

async function measureDiffLoad(page, fixtureId, timeoutMs = 60000) {
  const started = performance.now();
  await page.goto(`${baseUrl}/?module=diff&diffFixture=${fixtureId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => {
      const container = document.querySelector(
        ".diff-view-frame diffs-container",
      );
      return (
        container?.shadowRoot != null &&
        (container.shadowRoot.textContent ?? "").trim().length > 0
      );
    },
    null,
    { polling: "raf", timeout: timeoutMs },
  );
  const firstVisibleMs = performance.now() - started;
  const navStarted = performance.now();
  const firstActionableMs = await page
    .waitForFunction(
      () => {
        const position = document.querySelector(".diff-hunk-position");
        return (
          position != null && (position.textContent ?? "").includes("变更块")
        );
      },
      null,
      { polling: "raf", timeout: 15000 },
    )
    .then(() => performance.now() - navStarted)
    .catch(() => null);
  const scrollProbe = await page
    .evaluate(
      () =>
        new Promise((resolve) => {
          const frame = document.querySelector(".diff-view-frame");
          if (!frame) {
            resolve({ scrollable: false, reason: "no-frame" });
            return;
          }
          let current = frame;
          let scroller = null;
          while (current && current !== document.body) {
            const style = getComputedStyle(current);
            if (
              (style.overflowY === "auto" || style.overflowY === "scroll") &&
              current.scrollHeight > current.clientHeight + 4
            ) {
              scroller = current;
              break;
            }
            current = current.parentElement;
          }
          if (!scroller) {
            resolve({ scrollable: false, reason: "no-scroller" });
            return;
          }
          const begun = performance.now();
          scroller.scrollTop = scroller.scrollHeight;
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              resolve({
                scrollable: true,
                scrollMs: performance.now() - begun,
                reachedBottom:
                  scroller.scrollTop + scroller.clientHeight >=
                  scroller.scrollHeight - 4,
              }),
            ),
          );
        }),
    )
    .catch((error) => ({ scrollable: false, reason: String(error) }));
  return { firstVisibleMs, firstActionableMs, scrollProbe };
}

async function measureConflictLoad(page, tier, timeoutMs = 60000) {
  const started = performance.now();
  await page.goto(`${baseUrl}/?module=conflicts&${tier.query}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { name: "待处理冲突" })
    .waitFor({ timeout: timeoutMs });
  const firstVisibleMs = performance.now() - started;

  // 降级出口可用性：摘要 + 可点击的简化/外部按钮（R53 验收项 5）。
  // 出口计时以任务开始（goto）为起点，验收“任务开始后 500ms 内”。
  // V027-R53终审 P0-1：出口必须在首个可操作探针之前测量——simplified 按需加载档
  // 无块按钮，块等待超时不得污染出口计时（曾实测 60s 假象）。
  const exitStarted = started;
  let perfExitMs = null;
  let perfExitKind = "n/a-full";
  try {
    const summary = page.getByTestId("conflict-perf-summary");
    if ((await summary.count()) > 0) {
      await summary.waitFor({ timeout: 15000 });
      const simplified = page.getByTestId("use-simplified-perf");
      const external = page.getByTestId("open-external-perf");
      const hasSimplified = (await simplified.count()) > 0;
      const target = hasSimplified ? simplified : external;
      if ((await target.count()) > 0) {
        await target.first().waitFor({ timeout: 15000 });
        const enabled = await target
          .first()
          .evaluate((node) => !node.disabled)
          .catch(() => false);
        if (enabled) {
          perfExitMs = performance.now() - exitStarted;
          perfExitKind = hasSimplified ? "simplified" : "external";
        }
      } else {
        perfExitKind = "no-exit-button";
      }
    }
  } catch {
    perfExitMs = null;
    perfExitKind = "timeout";
  }

  // 首个可操作冲突（首个“采用我的修改”可见）：出口之后测量，短超时——
  // simplified 按需加载档按设计无块按钮，快速记 null，不阻塞后续探针。
  const actionStarted = performance.now();
  const firstActionableMs = await page
    .getByRole("button", { name: "采用我的修改" })
    .first()
    .waitFor({ timeout: 5000 })
    .then(() => performance.now() - actionStarted)
    .catch(() => null);
  return { firstVisibleMs, firstActionableMs, perfExitMs, perfExitKind };
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
    const device = {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus()[0]?.model ?? "unknown",
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      node: process.version,
    };

    const diffResults = [];
    for (const fixture of DIFF_FIXTURES) {
      const coldVisible = [];
      const coldActionable = [];
      const warmVisible = [];
      const warmActionable = [];
      let lastProbe = null;
      for (let run = 0; run < COLD_RUNS; run += 1) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        const page = await context.newPage();
        try {
          const sample = await measureDiffLoad(page, fixture.id);
          coldVisible.push(sample.firstVisibleMs);
          if (sample.firstActionableMs !== null)
            coldActionable.push(sample.firstActionableMs);
          lastProbe = sample.scrollProbe;
        } catch (error) {
          process.stderr.write(
            `[diff ${fixture.id} cold ${run}] ${error.message}\n`,
          );
        } finally {
          await context.close();
        }
      }
      const warmContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const warmPage = await warmContext.newPage();
      try {
        for (let run = 0; run < WARM_RUNS; run += 1) {
          try {
            const sample = await measureDiffLoad(warmPage, fixture.id);
            warmVisible.push(sample.firstVisibleMs);
            if (sample.firstActionableMs !== null)
              warmActionable.push(sample.firstActionableMs);
            lastProbe = sample.scrollProbe;
          } catch (error) {
            process.stderr.write(
              `[diff ${fixture.id} warm ${run}] ${error.message}\n`,
            );
          }
        }
      } finally {
        await warmContext.close();
      }
      diffResults.push({
        fixture: fixture.id,
        actualLines: fixture.lines,
        cold: {
          firstVisibleMs: summarize(coldVisible),
          firstActionableMs: summarize(coldActionable),
        },
        warm: {
          firstVisibleMs: summarize(warmVisible),
          firstActionableMs: summarize(warmActionable),
        },
        scrollProbe: lastProbe,
      });
    }

    const conflictResults = [];
    for (const tier of CONFLICT_TIERS) {
      const coldVisible = [];
      const coldActionable = [];
      const coldExit = [];
      const warmVisible = [];
      const warmActionable = [];
      const warmExit = [];
      const blockAction = [];
      const editInput = [];
      const simplifiedReady = [];
      let blockActionNoDataReason = null;
      let inputConsistent = null;
      let focusKept = null;
      let exitKind = "unknown";
      for (let run = 0; run < COLD_RUNS; run += 1) {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 800 },
        });
        const page = await context.newPage();
        try {
          const sample = await measureConflictLoad(page, tier);
          coldVisible.push(sample.firstVisibleMs);
          if (sample.firstActionableMs !== null)
            coldActionable.push(sample.firstActionableMs);
          if (sample.perfExitMs !== null) coldExit.push(sample.perfExitMs);
          exitKind = sample.perfExitKind;
          if (run === 0) {
            // 块动作：首个块“采用我的修改”→Host 内存草稿已同步。
            // simplified 按需加载档无块按钮时如实记 no-data（短超时确认，不等待 30s）。
            let blockButtons = 0;
            try {
              blockButtons = await page
                .getByRole("button", { name: "采用我的修改" })
                .count();
            } catch {
              blockButtons = 0;
            }
            if (blockButtons > 0) {
              try {
                const actionStarted = performance.now();
                await page
                  .getByRole("button", { name: "采用我的修改" })
                  .first()
                  .click({ timeout: 15000 });
                await page
                  .getByText("合并草稿仅本次会话保留")
                  .first()
                  .waitFor({ timeout: 15000 });
                blockAction.push(performance.now() - actionStarted);
              } catch (error) {
                process.stderr.write(
                  `[conflict ${tier.id} block-action] ${error.message}\n`,
                );
              }
            } else {
              blockActionNoDataReason = "simplified-parked-no-block-buttons";
            }
            // 简化编辑输入：切简化编辑器后逐键 rAF 延迟。
            // tier-500 用 200 键连续输入 + 内容一致 + 焦点保持断言（P1-6 补测）。
            try {
              const keysForTier =
                tier.id === "tier-500" ? STABILITY_INPUT_KEYS : INPUT_KEYS;
              const simplifiedBtn = page.getByTestId("use-simplified-perf");
              if ((await simplifiedBtn.count()) > 0) {
                const readyStarted = performance.now();
                await simplifiedBtn.first().click({ timeout: 15000 });
                const editableProbe = page.locator(
                  ".conflict-codemirror-host .cm-content",
                );
                await editableProbe.first().waitFor({ timeout: 15000 });
                simplifiedReady.push(performance.now() - readyStarted);
              } else {
                const fallback = page.getByTestId("use-simple-editor-result");
                if ((await fallback.count()) > 0)
                  await fallback.first().click({ timeout: 15000 });
              }
              const editable = page.locator(
                ".conflict-codemirror-host .cm-content",
              );
              await editable.first().waitFor({ timeout: 30000 });
              await editable.first().click();
              for (let i = 0; i < keysForTier; i += 1) {
                const inputStarted = performance.now();
                await page.keyboard.type("x", { delay: 0 });
                await page.evaluate(
                  () =>
                    new Promise((resolve) => requestAnimationFrame(resolve)),
                );
                editInput.push(performance.now() - inputStarted);
              }
              if (tier.id === "tier-500") {
                // 内容一致：200 个连续输入必须形成完整连续 run（无丢失/乱序）。
                const runText =
                  (await editable
                    .first()
                    .evaluate((node) => node.textContent ?? "")
                    .catch(() => "")) ?? "";
                inputConsistent = runText.includes("x".repeat(keysForTier));
                // 焦点保持：输入后焦点仍在简化编辑器内（未掉到 body/别处）。
                focusKept = await editable
                  .first()
                  .evaluate((node) => {
                    const root = node.getRootNode();
                    const rootActive =
                      root && typeof root.activeElement !== "undefined"
                        ? root.activeElement
                        : null;
                    const active = rootActive ?? document.activeElement;
                    return (
                      active != null &&
                      (node.contains(active) || node === active)
                    );
                  })
                  .catch(() => false);
              }
            } catch (error) {
              process.stderr.write(
                `[conflict ${tier.id} input] ${error.message}\n`,
              );
            }
          }
        } catch (error) {
          process.stderr.write(
            `[conflict ${tier.id} cold ${run}] ${error.message}\n`,
          );
        } finally {
          await context.close();
        }
      }
      const warmContext = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const warmPage = await warmContext.newPage();
      try {
        for (let run = 0; run < WARM_RUNS; run += 1) {
          try {
            const sample = await measureConflictLoad(warmPage, tier);
            warmVisible.push(sample.firstVisibleMs);
            if (sample.firstActionableMs !== null)
              warmActionable.push(sample.firstActionableMs);
            if (sample.perfExitMs !== null) warmExit.push(sample.perfExitMs);
            exitKind = sample.perfExitKind;
          } catch (error) {
            process.stderr.write(
              `[conflict ${tier.id} warm ${run}] ${error.message}\n`,
            );
          }
        }
      } finally {
        await warmContext.close();
      }
      conflictResults.push({
        tier: tier.id,
        query: tier.query,
        conflictBlocks: tier.blocks,
        actualLines: conflictActualLines(tier.query),
        perfExitKind: exitKind,
        cold: {
          firstVisibleMs: summarize(coldVisible),
          firstActionableMs: summarize(coldActionable),
          perfExitMs: summarize(coldExit),
        },
        warm: {
          firstVisibleMs: summarize(warmVisible),
          firstActionableMs: summarize(warmActionable),
          perfExitMs: summarize(warmExit),
        },
        blockActionMs: summarize(blockAction),
        blockActionNoDataReason,
        simplifiedReadyMs: summarize(simplifiedReady),
        simplifiedInputMs: summarize(editInput),
        // tier-500 200 键连续输入：内容一致 + 焦点保持硬门禁（P1-6 补测）。
        continuousInputConsistent: inputConsistent,
        continuousInputFocusKept: focusKept,
      });
    }

    // V027-R53终审 P1-6：连续切换 100 次稳定性（tier-10/100 交替，同 context）。
    const switchDomNodes = [];
    const switchHeapBytes = [];
    let switchPageErrors = 0;
    const switchContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const switchPage = await switchContext.newPage();
    switchPage.on("pageerror", (error) => {
      switchPageErrors += 1;
      process.stderr.write(`[switch-stability pageerror] ${error.message}\n`);
    });
    try {
      for (let i = 0; i < SWITCH_RUNS; i += 1) {
        const tierQuery =
          i % 2 === 0 ? CONFLICT_TIERS[0].query : CONFLICT_TIERS[1].query;
        try {
          await switchPage.goto(`${baseUrl}/?module=conflicts&${tierQuery}`, {
            waitUntil: "domcontentloaded",
          });
          await switchPage
            .getByRole("heading", { name: "待处理冲突" })
            .waitFor({ timeout: 30000 });
          const sample = await switchPage.evaluate(() => {
            const withMemory = performance;
            const heap = withMemory.memory?.usedJSHeapSize;
            return {
              domNodes: document.querySelectorAll("*").length,
              heapBytes: typeof heap === "number" ? Math.round(heap) : null,
            };
          });
          switchDomNodes.push(sample.domNodes);
          if (sample.heapBytes !== null) switchHeapBytes.push(sample.heapBytes);
        } catch (error) {
          process.stderr.write(`[switch-stability ${i}] ${error.message}\n`);
        }
      }
    } finally {
      await switchContext.close();
    }
    await browser.close();
    const average = (values) =>
      values.length === 0
        ? null
        : values.reduce((sum, value) => sum + value, 0) / values.length;
    const firstDomAvg = average(switchDomNodes.slice(0, 10));
    const lastDomAvg = average(switchDomNodes.slice(-10));
    const firstHeapAvg = average(switchHeapBytes.slice(0, 10));
    const lastHeapAvg = average(switchHeapBytes.slice(-10));
    const stability = {
      runs: switchDomNodes.length,
      pageErrors: switchPageErrors,
      domNodes: summarize(switchDomNodes),
      heapBytes: summarize(switchHeapBytes),
      domGrowthRatio:
        firstDomAvg && lastDomAvg ? lastDomAvg / firstDomAvg : null,
      heapGrowthRatio:
        firstHeapAvg && lastHeapAvg ? lastHeapAvg / firstHeapAvg : null,
    };

    /*
     * V027-R53终审 P0-2：候选门禁逐档断言（超预算 passed=false + 进程 exit 非零）。
     * 信息对照（设备/样本分布/无数据档）与门禁分开：无样本档记 no-data（门禁失败，
     * 如实暴露缺失，不记通过）；tier-500 块动作在 simplified 按需加载下无按钮，
     * 其交付路径为简化编辑器，块动作记信息对照（info-only）不入闸。
     * 纪律：失败不缩 fixture、不放宽断言。
     */
    const budgets = {
      actionFeedbackP95Ms: 100,
      simplifiedInputP95Ms: 50,
      diff5000FirstReadableP95Ms: 1500,
      diff10000FirstReadableP95Ms: 3000,
      conflict100FirstActionableP95Ms: 1500,
      conflict500SimplifiedActionableP95Ms: 2000,
      overBudgetExitMs: 500,
    };
    const gates = [];
    const gate = (id, budgetMs, summary, detail) => {
      const p95 =
        summary && typeof summary.p95 === "number" ? summary.p95 : null;
      const runs = summary?.runs ?? 0;
      const pass = p95 !== null && runs > 0 && p95 <= budgetMs;
      gates.push({
        id,
        budgetMs,
        p95,
        runs,
        passed: pass,
        detail: p95 === null ? `${detail}（无样本，如实记失败）` : detail,
      });
    };
    const diffById = (id) => diffResults.find((entry) => entry.fixture === id);
    const tierById = (id) => conflictResults.find((entry) => entry.tier === id);
    gate(
      "diff-5000-cold-first-visible",
      budgets.diff5000FirstReadableP95Ms,
      diffById("ts-5000-mid")?.cold.firstVisibleMs,
      "5000 行冷启动首个可读内容",
    );
    gate(
      "diff-5000-warm-first-visible",
      budgets.diff5000FirstReadableP95Ms,
      diffById("ts-5000-mid")?.warm.firstVisibleMs,
      "5000 行暖启动首个可读内容",
    );
    gate(
      "diff-10000-cold-first-visible",
      budgets.diff10000FirstReadableP95Ms,
      diffById("ts-10000-mid")?.cold.firstVisibleMs,
      "10000 行冷启动首个可读内容",
    );
    gate(
      "diff-10000-warm-first-visible",
      budgets.diff10000FirstReadableP95Ms,
      diffById("ts-10000-mid")?.warm.firstVisibleMs,
      "10000 行暖启动首个可读内容",
    );
    gate(
      "conflict-100-cold-first-actionable",
      budgets.conflict100FirstActionableP95Ms,
      tierById("tier-100")?.cold.firstActionableMs,
      "100 块冷启动首个可操作冲突",
    );
    gate(
      "conflict-100-warm-first-actionable",
      budgets.conflict100FirstActionableP95Ms,
      tierById("tier-100")?.warm.firstActionableMs,
      "100 块暖启动首个可操作冲突",
    );
    gate(
      "conflict-500-cold-exit",
      budgets.overBudgetExitMs,
      tierById("tier-500")?.cold.perfExitMs,
      "500 块冷启动降级出口可交互",
    );
    gate(
      "conflict-500-warm-exit",
      budgets.overBudgetExitMs,
      tierById("tier-500")?.warm.perfExitMs,
      "500 块暖启动降级出口可交互",
    );
    gate(
      "conflict-500-simplified-ready",
      budgets.conflict500SimplifiedActionableP95Ms,
      tierById("tier-500")?.simplifiedReadyMs,
      "500 块简化编辑器可操作（点出口→可交互）",
    );
    for (const tierId of ["tier-10", "tier-100"]) {
      gate(
        `block-action-${tierId}`,
        budgets.actionFeedbackP95Ms,
        tierById(tierId)?.blockActionMs,
        `${tierId} 块动作反馈（点击→草稿已同步）`,
      );
    }
    for (const tier of conflictResults) {
      if ((tier.simplifiedInputMs?.runs ?? 0) > 0) {
        gate(
          `simplified-input-${tier.tier}`,
          budgets.simplifiedInputP95Ms,
          tier.simplifiedInputMs,
          `${tier.tier} 简化编辑逐键输入`,
        );
      }
    }
    // tier-500 200 键连续输入：内容一致 + 焦点保持硬门禁。
    const tier500 = tierById("tier-500");
    gates.push({
      id: "continuous-input-500-consistent",
      budgetMs: null,
      p95: null,
      runs: tier500?.simplifiedInputMs?.runs ?? 0,
      passed: tier500?.continuousInputConsistent === true,
      detail: "500 块 200 键连续输入内容一致（200 字符连续 run 完整）",
    });
    gates.push({
      id: "continuous-input-500-focus",
      budgetMs: null,
      p95: null,
      runs: tier500?.simplifiedInputMs?.runs ?? 0,
      passed: tier500?.continuousInputFocusKept === true,
      detail: "500 块连续输入后焦点仍在简化编辑器内",
    });
    // 连续切换 100 次：零页面错误 + DOM/堆无持续增长（后 10 均值/前 10 均值 ≤1.5）。
    gates.push({
      id: "switch-100-no-errors",
      budgetMs: null,
      p95: null,
      runs: stability.runs,
      passed: stability.runs === SWITCH_RUNS && stability.pageErrors === 0,
      detail: `连续切换 ${SWITCH_RUNS} 次零页面错误（实际 ${stability.runs} 次，错误 ${stability.pageErrors} 个）`,
    });
    gates.push({
      id: "switch-100-no-growth",
      budgetMs: null,
      p95: null,
      runs: stability.runs,
      passed:
        (stability.domGrowthRatio ?? Number.POSITIVE_INFINITY) <= 1.5 &&
        (stability.heapGrowthRatio === null ||
          stability.heapGrowthRatio <= 1.5),
      detail: `连续切换无持续增长（DOM 比 ${stability.domGrowthRatio}，堆比 ${stability.heapGrowthRatio}，阈值 1.5）`,
    });
    const passed = gates.every((entry) => entry.passed);
    const result = {
      tool: "measure-v027-r53",
      stage: STAGE,
      renderer:
        "FileDiff 只读 + UnresolvedFile（虚拟化/Worker/同步多窗格 no-go 不变）",
      coldRuns: COLD_RUNS,
      warmRuns: WARM_RUNS,
      measuredAt: new Date().toISOString(),
      device,
      candidateBudgets: {
        note: "R53 候选体验目标（调整须记录原目标+依据+影响，本轮不放宽）。",
        ...budgets,
      },
      diff: diffResults,
      conflicts: conflictResults,
      stability,
      gates,
      passed,
    };
    const evidenceDirectory =
      process.env.SVN_WORKBENCH_EVIDENCE_DIR ??
      path.join(root, ".validation", "evidence", "v0.2.x", `v027-r53-${STAGE}`);
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      path.join(evidenceDirectory, `v027-r53-${STAGE}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!passed) {
      const failed = gates
        .filter((entry) => !entry.passed)
        .map((entry) => entry.id);
      process.stderr.write(
        `[measure-v027-r53] candidate gates failed (${failed.length}): ${failed.join(", ")}\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
