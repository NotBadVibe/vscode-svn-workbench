import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/webview-e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:41731',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'webview',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 }
      }
    }
  ],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --config src/webview/vite.config.mts --host 127.0.0.1 --port 41731',
    url: 'http://127.0.0.1:41731',
    reuseExistingServer: false
  }
});
