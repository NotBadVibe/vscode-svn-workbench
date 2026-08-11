import { defineConfig, devices } from "@playwright/test";

// 仓库根目录：webServer 命令默认以本配置文件目录为 cwd，需显式指回根目录。
// 本配置约定从仓库根目录执行（见上方运行方式注释），故直接用 process.cwd()。
const repoRoot = process.cwd();

/*
 * Spike 独立 Playwright 项目（不并入 tests/webview-e2e 的既有项目）。
 * 运行方式（仓库根目录）：
 *   npx playwright test --config tests/spike/playwright.spike.config.ts
 * webServer 会先构建 spike 页面（tests/spike/dist），再启动 CSP 静态服务器。
 */
export default defineConfig({
  // 相对本配置文件所在目录解析
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:41831",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "spike",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js build --config tests/spike/vite.spike.config.mts && node tests/spike/serve-csp.mjs",
    cwd: repoRoot,
    url: "http://127.0.0.1:41831",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
