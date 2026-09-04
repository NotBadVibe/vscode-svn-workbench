/*
 * V018-B 虚拟化 spike 对比实测（v0.1.8 规划 §4.2）。
 *
 * 经 vite dev 服务器提供 spike 测量页
 * （src/webview/features/diff/v018spike/spike.html，非生产入口），
 * 同一 fixture 对 FileDiff 与 VirtualizedFileDiff 做只读对比：
 * 首个 plain render / 高亮就绪 / 滚动 / 内存 / DOM 规模。
 *
 * 结果写入 .validation/evidence/v0.1.8/<run>/v018-spike.json（gitignored）。
 * 非门禁脚本：只记录数据供 go/no-go 决策，一律 exit 0（挂载失败如实记录）。
 */
/* global window */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41735;
const baseUrl = `http://127.0.0.1:${port}/features/diff/v018spike/spike.html`;

/** spike 对比矩阵（与现状矩阵同口径，固定不缩小）。 */
const FIXTURES = [
  "ts-1000-mid",
  "ts-5000-mid",
  "ts-10000-mid",
  "ts-5000-mid-longline-crlf-noeol",
];
const MODES = ["filediff", "virtualized"];
const RUNS = 3;

async function waitForServer() {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/features/diff/v018spike/spike.html`,
      );
      if (response.ok) return;
    } catch {
      // 继续等待 vite dev 就绪。
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Vite dev did not start.");
}

async function measureOnce(browser, fixture, mode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}?fixture=${fixture}&mode=${mode}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => window.__v018Spike != null, null, {
      polling: "raf",
      timeout: 60000,
    });
    return await page.evaluate(() => window.__v018Spike);
  } finally {
    await context.close();
  }
}

async function main() {
  const server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "--config",
      "src/webview/vite.config.mts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: root, stdio: "ignore" },
  );
  try {
    await waitForServer();
    const browser = await chromium.launch({
      args: ["--js-flags=--expose-gc"],
    });
    const samples = [];
    for (const fixture of FIXTURES) {
      for (const mode of MODES) {
        for (let run = 0; run < RUNS; run += 1) {
          const sample = await measureOnce(browser, fixture, mode).catch(
            (error) => ({
              fixture,
              mode,
              error: error.message ?? String(error),
            }),
          );
          samples.push({ ...sample, run });
        }
      }
    }
    await browser.close();

    const result = {
      tool: "measure-v018-spike",
      buildMode: "vite-dev（相对对比有效，绝对值不与生产构建直接比较）",
      runs: RUNS,
      measuredAt: new Date().toISOString(),
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      samples,
      passed: true,
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "v018-spike.json"),
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
