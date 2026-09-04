/*
 * V018-B 普通 Diff 浏览器侧现状实测（v0.1.8 规划 §4.2）。
 *
 * 在生产构建（vite preview）中经 ?module=diff&diffFixture=<id> 挂载当前
 * FileDiff 只读视图，逐 fixture 多轮测量：
 * - 首个可见内容（goto → diffs-container 出现文本）
 * - 高亮就绪（Shadow DOM 出现带样式 token 节点后的耗时）
 * - 滚动（.diff-view-frame 内滚动容器置顶→置底耗时 + 是否可滚）
 * - 内存（gc 后 usedJSHeapSize 常驻值，趋势观察）
 * - DOM 规模（节点数，规模代理指标）
 *
 * 结果写入 .validation/evidence/v0.1.8/<run>/v018-browser.json（gitignored）。
 * 非门禁脚本：候选预算只做信息对照，一律 exit 0（失败只记录不阻断），
 * 性能失败不得缩小 fixture/放宽断言——本脚本固定矩阵与轮次。
 */
/* global document, requestAnimationFrame, getComputedStyle */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41734;
const baseUrl = `http://127.0.0.1:${port}`;

/** V018-B 现状矩阵：1000/5000/10000 行 + 长行变体（固定，不缩小）。 */
const FIXTURES = [
  "ts-1000-mid",
  "ts-5000-mid",
  "ts-10000-mid",
  "ts-5000-mid-longline-crlf-noeol",
];
const RUNS = 5;

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
  const rounded = samples.map((value) => Math.round(value * 100) / 100);
  return {
    runs: rounded.length,
    p50: Math.round(percentile(rounded, 0.5) * 100) / 100,
    p95: Math.round(percentile(rounded, 0.95) * 100) / 100,
    min: rounded.length > 0 ? Math.min(...rounded) : 0,
    max: rounded.length > 0 ? Math.max(...rounded) : 0,
  };
}

async function measureOnce(browser, fixtureId) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
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
      { polling: "raf", timeout: 30000 },
    );
    const firstVisibleMs = performance.now() - started;

    const highlightStarted = performance.now();
    let highlightReadyMs = null;
    try {
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
        { polling: "raf", timeout: 15000 },
      );
      highlightReadyMs = performance.now() - highlightStarted;
    } catch {
      highlightReadyMs = null;
    }

    const scrollProbe = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const frame = document.querySelector(".diff-view-frame");
          if (!frame) {
            resolve({ scrollable: false, reason: "no-frame" });
            return;
          }
          // 找到真正可纵向滚动的祖先/自身（Diff 内容区）。
          let node = frame;
          let scroller = null;
          let current = frame;
          while (current && current !== document.body) {
            const style = getComputedStyle(current);
            const overflowY = style.overflowY;
            if (
              (overflowY === "auto" || overflowY === "scroll") &&
              current.scrollHeight > current.clientHeight + 4
            ) {
              scroller = current;
              break;
            }
            current = current.parentElement;
          }
          if (!scroller) {
            // 回退：Shadow 内的滚动容器。
            const container = frame.querySelector("diffs-container");
            const root = container?.shadowRoot;
            const inner = root?.querySelector("[data-scroll-container]");
            void node;
            if (inner && inner.scrollHeight > inner.clientHeight + 4) {
              const startedInner = performance.now();
              inner.scrollTop = inner.scrollHeight;
              requestAnimationFrame(() =>
                requestAnimationFrame(() =>
                  resolve({
                    scrollable: true,
                    shadow: true,
                    scrollMs: performance.now() - startedInner,
                    scrollHeight: inner.scrollHeight,
                  }),
                ),
              );
              return;
            }
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
                scrollHeight: scroller.scrollHeight,
                reachedBottom:
                  scroller.scrollTop + scroller.clientHeight >=
                  scroller.scrollHeight - 4,
              }),
            ),
          );
        }),
    );

    const stats = await page.evaluate(() => {
      if (typeof globalThis.gc === "function") globalThis.gc();
      return {
        domNodes: document.querySelectorAll("*").length,
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    });

    return { firstVisibleMs, highlightReadyMs, scrollProbe, stats };
  } finally {
    await context.close();
  }
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
    const browser = await chromium.launch({
      args: ["--js-flags=--expose-gc"],
    });
    const fixtures = [];
    for (const fixtureId of FIXTURES) {
      const firstVisible = [];
      const highlight = [];
      const scroll = [];
      let lastProbe = null;
      let heapBytes = null;
      let domNodes = null;
      for (let run = 0; run < RUNS; run += 1) {
        const sample = await measureOnce(browser, fixtureId);
        firstVisible.push(sample.firstVisibleMs);
        if (sample.highlightReadyMs !== null) {
          highlight.push(sample.highlightReadyMs);
        }
        if (sample.scrollProbe.scrollable) {
          scroll.push(sample.scrollProbe.scrollMs);
        }
        lastProbe = sample.scrollProbe;
        heapBytes = sample.stats.heapBytes;
        domNodes = sample.stats.domNodes;
      }
      fixtures.push({
        fixture: fixtureId,
        firstVisibleMs: summarize(firstVisible),
        highlightReadyMs: highlight.length > 0 ? summarize(highlight) : null,
        scrollMs: scroll.length > 0 ? summarize(scroll) : null,
        scrollProbe: lastProbe,
        heapBytesAfterGc: heapBytes,
        domNodes,
      });
    }
    await browser.close();

    const result = {
      tool: "measure-v018-browser",
      renderer: "FileDiff现状（只读，生产构建 preview）",
      runs: RUNS,
      measuredAt: new Date().toISOString(),
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      budgets: {
        note: "候选预算（规划 §3）仅信息对照；V018-B 为实测 spike，不设阻断门禁。",
        diff5000FirstVisibleP95Ms: 800,
      },
      fixtures,
      passed: true,
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "v018-browser.json"),
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
