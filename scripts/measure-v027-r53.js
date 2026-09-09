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
 *   仅 reduced/simplified 档）/ 块动作（点击→Host 内存草稿已同步）/
 *   简化编辑输入（逐键 rAF，10 键）。
 * actualLines：Diff 取 fixture 行数；冲突按 mock 生成器确定性公式
 * （1 + 块数×7 + (块数-1)×3 + 1 + 长行，conflictLines 目标取大）。
 * 结果写入 <evidenceDir>/v027-r53-<stage>.json（stage=baseline|after），
 * 不覆盖已发布 evidence。候选门禁只做信息对照，不阻断（exit 0）。
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

  const actionStarted = performance.now();
  const firstActionableMs = await page
    .getByRole("button", { name: "采用我的修改" })
    .first()
    .waitFor({ timeout: timeoutMs })
    .then(() => performance.now() - actionStarted)
    .catch(() => null);

  // 降级出口可用性：摘要 + 可点击的简化/外部按钮（R53 验收项 5）。
  // 出口计时以任务开始（goto）为起点，验收“任务开始后 500ms 内”。
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
            try {
              const actionStarted = performance.now();
              await page
                .getByRole("button", { name: "采用我的修改" })
                .first()
                .click({ timeout: 30000 });
              await page
                .getByText("合并草稿仅本次会话保留")
                .first()
                .waitFor({ timeout: 30000 });
              blockAction.push(performance.now() - actionStarted);
            } catch (error) {
              process.stderr.write(
                `[conflict ${tier.id} block-action] ${error.message}\n`,
              );
            }
            // 简化编辑输入：切简化编辑器后逐键 rAF 延迟。
            try {
              const simplifiedBtn = page.getByTestId("use-simplified-perf");
              if ((await simplifiedBtn.count()) > 0) {
                await simplifiedBtn.first().click({ timeout: 15000 });
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
              for (let i = 0; i < INPUT_KEYS; i += 1) {
                const inputStarted = performance.now();
                await page.keyboard.type("x", { delay: 0 });
                await page.evaluate(
                  () =>
                    new Promise((resolve) => requestAnimationFrame(resolve)),
                );
                editInput.push(performance.now() - inputStarted);
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
        simplifiedInputMs: summarize(editInput),
      });
    }
    await browser.close();

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
        actionFeedbackP95Ms: 100,
        simplifiedInputP95Ms: 50,
        diff5000FirstReadableP95Ms: 1500,
        diff10000FirstReadableP95Ms: 3000,
        conflict100FirstActionableP95Ms: 1500,
        conflict500SimplifiedActionableP95Ms: 2000,
        overBudgetExitMs: 500,
      },
      diff: diffResults,
      conflicts: conflictResults,
      passed: true,
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
  } finally {
    server.kill("SIGTERM");
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
