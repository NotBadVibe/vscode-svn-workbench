const { chromium } = require("playwright");
const { spawn } = require("node:child_process");
const {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { gzipSync } = require("node:zlib");
const path = require("node:path");
const { resolveEvidenceDirectory } = require("./evidence-context");

const root = path.resolve(__dirname, "..");
const port = 41732;
const baseUrl = `http://127.0.0.1:${port}`;

async function waitForServer() {
  // v0.0.9 发布修复：CI 慢 runner 上 vite preview 冷启动可能超过 8s（build
  // 3s+ 已占用大部窗口），把就绪窗口放宽到 60s。本函数只等 server 就绪，
  // 不参与交互/列表测量，放宽不影响任何预算数据。
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // 未安装的浏览器不影响静态包体预算采集。
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

function gzipBytes(filePath) {
  return gzipSync(readFileSync(filePath)).byteLength;
}

function findInitialAssets() {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "dist/webview/.vite/manifest.json"), "utf8"),
  );
  const entry = Object.values(manifest).find((item) => item.isEntry);
  if (!entry) throw new Error("Webview entry missing from manifest.");
  const assetFiles = readdirSync(path.join(root, "dist/webview/assets"));
  return {
    js: gzipBytes(path.join(root, "dist/webview", entry.file)),
    css: (entry.css || []).reduce(
      (sum, item) => sum + gzipBytes(path.join(root, "dist/webview", item)),
      0,
    ),
    lazyChunks: assetFiles.filter((item) =>
      /(?:Module|Task)-.*\.js$/.test(item),
    ).length,
    repositoryTaskChunks: assetFiles.filter((item) =>
      /(?:Update|Recovery|Browse|Properties|Advanced|PatchShelf|ReleaseNotes)Task-.*\.js$/.test(
        item,
      ),
    ).length,
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
    const samples = [];
    for (let index = 0; index < 20; index += 1) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      const started = performance.now();
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "工作副本修改" }).waitFor();
      samples.push(performance.now() - started);
      await context.close();
    }
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
    });
    await page.goto(`${baseUrl}/?dataset=large`);
    const list = page.getByRole("list", { name: "SVN 变更文件" });
    const scrollStarted = performance.now();
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    // PathCell 已改为“文件名 + 父目录”两行：等待最后一项的文件名按钮挂载
    // （同时校验父目录行），不再等待已不在 UI 上的整路径文本。
    await page
      .locator(".path-cell__name", { hasText: "file-4999.ts" })
      .waitFor();
    await page
      .locator(".path-cell__parent", {
        hasText: "src/generated/deep/path",
      })
      .first()
      .waitFor();
    const largeListScrollMs = performance.now() - scrollStarted;
    const mountedRows = await list.getByRole("listitem").count();
    await browser.close();
    const assets = findInitialAssets();
    const budgets = {
      shellJsGzipBytes: 160 * 1024,
      shellCssGzipBytes: 50 * 1024,
      interactiveP95Ms: 700,
      largeListMountedRows: 100,
      largeListScrollMs: 500,
      minimumLazyChunks: 17,
      minimumRepositoryTaskChunks: 7,
    };
    const result = {
      measuredAt: new Date().toISOString(),
      runs: samples.length,
      interactiveMs: {
        p50: Math.round(percentile(samples, 0.5)),
        p95: Math.round(percentile(samples, 0.95)),
        samples: samples.map(Math.round),
      },
      bundleGzipBytes: assets,
      largeList: {
        files: 5000,
        mountedRows,
        scrollToEndMs: Math.round(largeListScrollMs),
      },
      budgets,
    };
    const failures = [];
    if (assets.js > budgets.shellJsGzipBytes)
      failures.push(`shell JS ${assets.js} > ${budgets.shellJsGzipBytes}`);
    if (assets.css > budgets.shellCssGzipBytes)
      failures.push(`shell CSS ${assets.css} > ${budgets.shellCssGzipBytes}`);
    if (assets.lazyChunks < budgets.minimumLazyChunks)
      failures.push(
        `lazy chunks ${assets.lazyChunks} < ${budgets.minimumLazyChunks}`,
      );
    if (assets.repositoryTaskChunks < budgets.minimumRepositoryTaskChunks)
      failures.push(
        `repository task chunks ${assets.repositoryTaskChunks} < ${budgets.minimumRepositoryTaskChunks}`,
      );
    if (result.interactiveMs.p95 > budgets.interactiveP95Ms)
      failures.push(
        `interactive P95 ${result.interactiveMs.p95}ms > ${budgets.interactiveP95Ms}ms`,
      );
    if (mountedRows > budgets.largeListMountedRows)
      failures.push(
        `mounted rows ${mountedRows} > ${budgets.largeListMountedRows}`,
      );
    if (result.largeList.scrollToEndMs > budgets.largeListScrollMs)
      failures.push(
        `large-list scroll ${result.largeList.scrollToEndMs}ms > ${budgets.largeListScrollMs}ms`,
      );
    result.passed = failures.length === 0;
    result.failures = failures;
    const artifactDirectory = resolveEvidenceDirectory(root);
    mkdirSync(artifactDirectory, { recursive: true });
    writeFileSync(
      path.join(artifactDirectory, "performance.json"),
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
