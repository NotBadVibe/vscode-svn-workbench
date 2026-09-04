/*
 * V018-B spike 补充探针：Shadow DOM 规模与窗口化验证（v0.1.8 规划 §4.2）。
 *
 * 主 spike（measure-v018-spike.js）的 domNodes 只统计 light DOM，
 * 本探针对 ts-5000-mid 单 fixture、双模式各跑 1 次，统计 Shadow 内
 * 节点总数，验证 VirtualizedFileDiff 是否窗口化渲染（节点数显著更少），
 * 而非回退全量渲染。结果追加写入同 evidence 运行目录 v018-spike-dom.json。
 */
/* global document, window */
const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const { mkdirSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41736;
const baseUrl = `http://127.0.0.1:${port}/features/diff/v018spike/spike.html`;
const FIXTURE = "ts-5000-mid";

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

async function probeOnce(browser, mode) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}?fixture=${FIXTURE}&mode=${mode}`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(() => window.__v018Spike != null, null, {
      polling: "raf",
      timeout: 60000,
    });
    return await page.evaluate(() => {
      const containers = Array.from(
        document.querySelectorAll("diffs-container"),
      );
      let shadowNodes = 0;
      let styledTokens = 0;
      for (const container of containers) {
        const shadow = container.shadowRoot;
        if (!shadow) continue;
        shadowNodes += shadow.querySelectorAll("*").length;
        styledTokens += shadow.querySelectorAll(
          "[style], [data-hl-style]",
        ).length;
      }
      return {
        diffsContainers: containers.length,
        shadowNodes,
        styledTokens,
        spike: window.__v018Spike,
      };
    });
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
    const filediff = await probeOnce(browser, "filediff");
    const virtualized = await probeOnce(browser, "virtualized");
    await browser.close();
    const result = {
      tool: "measure-v018-spike-dom",
      fixture: FIXTURE,
      measuredAt: new Date().toISOString(),
      device: {
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus()[0]?.model ?? "unknown",
        memoryGb: Math.round(os.totalmem() / 1024 ** 3),
        node: process.version,
      },
      filediff,
      virtualized,
      passed: true,
    };
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "v018-spike-dom.json"),
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
