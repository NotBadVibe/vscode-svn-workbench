/*
 * v0.1.0（V010-A/F）Diff 主路径性能测量（before/after baseline 通用）。
 * waitForFunction / evaluate 回调在浏览器侧执行，声明对应全局。
 */
/* global document, window, requestAnimationFrame */
/*
 *
 * 使用 ?module=diff&diffFixture=<id> 的确定性 fixture（src/webview/mocks/
 * diffFixtures.ts，同一 ID 字节级一致），在真实 Chromium 中测量：
 * - 首个可见内容（goto → diffs-container 有文本）
 * - 语法高亮完成（Shadow DOM 出现带样式的 token 节点）
 * - 上一/下一处差异响应（点击 → “变更块 X/Y” 更新）
 * - 编辑态逐键输入延迟（P50/P95）
 * - 保存后再次输入延迟（权威快照刷新不打断输入的体感指标）
 * - 同一 Webview 内切换差异目标（open-diff → 新内容可见）
 * - JS 堆内存增量
 *
 * 结果写入 .validation/evidence/v<版本>/<运行编号>/diff-performance.json，
 * 不覆盖已发布 evidence。所有“性能结论”必须引用本脚本输出中的
 * 数据规模、运行次数、P50/P95 与设备信息。
 */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41733;
const baseUrl = `http://127.0.0.1:${port}`;

/** 候选门禁：5000 行 fixture 首个可见内容 P95 ≤ 800ms（v0.1.0 验收场景 6）。 */
const FIRST_VISIBLE_BUDGET_MS = 800;
const NAVIGATION_BUDGET_MS = 300;
const INPUT_P95_BUDGET_MS = 100;

const FIXTURES = [
  "ts-100-small",
  "ts-1000-mid",
  "ts-5000-mid",
  "ts-10000-mid",
  "ts-5000-mid-longline-crlf-noeol",
  "json-5000-mid",
  "xml-1000-mid",
];
/** 高亮与输入只在文本类 fixture 上测量（text 无高亮资源）。 */
const HIGHLIGHT_FIXTURES = new Set(["ts-1000-mid", "ts-5000-mid"]);
const INPUT_RUNS = 30;
const NAVIGATION_RUNS = 10;

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
  return {
    runs: samples.length,
    p50: Math.round(percentile(samples, 0.5)),
    p95: Math.round(percentile(samples, 0.95)),
    samples: samples.map((value) => Math.round(value)),
  };
}

/** 同帧测量：动作开始 → 条件满足（逐帧轮询，避免固定 sleep）。 */
async function measureUntil(page, action, condition, arg) {
  const started = performance.now();
  await action();
  await page.waitForFunction(condition, arg ?? null, {
    polling: "raf",
    timeout: 5000,
  });
  return performance.now() - started;
}

async function measureFixture(browser, fixtureId) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const result = { fixture: fixtureId };
  const readMemory = () =>
    page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  try {
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
      { polling: "raf" },
    );
    result.firstVisibleMs = Math.round(performance.now() - started);
    // 首个可见内容后的堆基线（渲染完成后的常驻内存）。
    const memoryBaseline = await readMemory();

    if (HIGHLIGHT_FIXTURES.has(fixtureId)) {
      const highlightStarted = performance.now();
      await page.waitForFunction(
        () => {
          const container = document.querySelector(
            ".diff-view-frame diffs-container",
          );
          const rootNode = container?.shadowRoot;
          if (!rootNode) return false;
          return rootNode.querySelector("[style], [data-hl-style]") !== null;
        },
        null,
        { polling: "raf" },
      );
      result.highlightCompleteMs = Math.round(
        performance.now() - highlightStarted,
      );
    }

    // 上一/下一处差异响应：点击 → 位置指示更新。
    // 单块 fixture（如 ts-100-small）无前进空间，跳过导航测量。
    const positionText = await page
      .locator(".diff-hunk-position")
      .textContent()
      .catch(() => "");
    const totalHunks = Number(positionText?.match(/\/(\d+)/)?.[1] ?? 0);
    const navSamples = [];
    for (
      let index = 0;
      index < (totalHunks >= 2 ? NAVIGATION_RUNS : 0);
      index += 1
    ) {
      const forward = index % 2 === 0;
      const sample = await measureUntil(
        page,
        async () => {
          await page
            .getByRole("button", {
              name: forward ? "下一处差异" : "上一处差异",
            })
            .click();
        },
        (direction) => {
          const position = document.querySelector(".diff-hunk-position");
          return (
            position?.textContent?.includes(
              direction ? "变更块 2/" : "变更块 1/",
            ) ?? false
          );
        },
        forward,
      ).catch(() => undefined);
      if (sample !== undefined) navSamples.push(sample);
    }
    result.navigationMs = summarize(navSamples);

    // 同一 Webview 内切换差异目标（mock open-diff 通道）；在进入编辑前
    // 测量，避免脏草稿三选一拦截。
    const switchMs = await measureUntil(
      page,
      async () => {
        await page.evaluate(() => {
          window.dispatchEvent(
            new CustomEvent("svn-workbench:mock-action", {
              detail: {
                protocolVersion: 2,
                type: "workbench/action",
                moduleId: "diff",
                taskId: "diff/working",
                sessionId: "mock-session-id",
                payload: {
                  action: "open-diff",
                  data: { relativePath: "src/other.ts" },
                },
              },
            }),
          );
        });
      },
      () =>
        document.querySelector(".file-title strong")?.textContent ===
        "src/other.ts",
    ).catch(() => undefined);
    if (switchMs !== undefined) {
      result.targetSwitchMs = Math.round(switchMs);
    }

    // 编辑态输入延迟：进入页内编辑后逐键输入。
    await page.getByRole("button", { name: "页内编辑" }).click();
    await page.getByText("正在编辑工作副本").waitFor();
    const editable = page
      .locator("diffs-container")
      .locator('[contenteditable="true"]')
      .first();
    await editable.click();
    const inputSamples = [];
    for (let index = 0; index < INPUT_RUNS; index += 1) {
      const inputStarted = performance.now();
      await page.keyboard.type("x", { delay: 0 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(resolve)),
      );
      inputSamples.push(performance.now() - inputStarted);
    }
    result.inputMs = summarize(inputSamples);

    // 保存后再次输入（Ctrl+S → mock 快照刷新 → 再输入一键）。
    await page.keyboard.press("Control+s");
    await page.getByText(/已于 .* 保存到工作副本/).waitFor();
    await editable.click();
    const reinputStarted = performance.now();
    await page.keyboard.type("y", { delay: 0 });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    result.saveThenReinputMs = Math.round(performance.now() - reinputStarted);

    // 编辑/保存/切换后的堆峰值与 GC 后的回落值。
    result.memoryPeakBytes = await readMemory();
    await page.evaluate(() => {
      if (typeof globalThis.gc === "function") globalThis.gc();
    });
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    const memorySettled = await readMemory();
    result.memoryGrowthAfterGcBytes = Math.max(
      0,
      memorySettled - memoryBaseline,
    );
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
    // expose-gc 供内存回落测量（gc() 后堆稳定值）。
    const browser = await chromium.launch({
      args: ["--js-flags=--expose-gc"],
    });
    const fixtures = [];
    for (const fixtureId of FIXTURES) {
      fixtures.push(await measureFixture(browser, fixtureId));
    }
    await browser.close();

    const failures = [];
    const large = fixtures.find((item) => item.fixture === "ts-5000-mid");
    if (large && large.firstVisibleMs > FIRST_VISIBLE_BUDGET_MS) {
      failures.push(
        `ts-5000-mid 首个可见内容 ${large.firstVisibleMs}ms > ${FIRST_VISIBLE_BUDGET_MS}ms`,
      );
    }
    if (large && large.navigationMs.p95 > NAVIGATION_BUDGET_MS) {
      failures.push(
        `ts-5000-mid 导航 P95 ${large.navigationMs.p95}ms > ${NAVIGATION_BUDGET_MS}ms`,
      );
    }
    if (large && large.inputMs.p95 > INPUT_P95_BUDGET_MS) {
      failures.push(
        `ts-5000-mid 输入 P95 ${large.inputMs.p95}ms > ${INPUT_P95_BUDGET_MS}ms`,
      );
    }

    const result = {
      measuredAt: new Date().toISOString(),
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      budgets: {
        firstVisible5000P95Ms: FIRST_VISIBLE_BUDGET_MS,
        navigationP95Ms: NAVIGATION_BUDGET_MS,
        inputP95Ms: INPUT_P95_BUDGET_MS,
      },
      fixtures,
      passed: failures.length === 0,
      failures,
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "diff-performance.json"),
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
