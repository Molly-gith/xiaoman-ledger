import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser", timeout: 30000, workers: 1,
  use: { baseURL: "http://127.0.0.1:4173/xiaoman-ledger/", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Hong_Kong", channel: process.env.PLAYWRIGHT_CHANNEL || undefined, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "node node_modules/vite/bin/vite.js preview --config vite.github.config.ts --host 127.0.0.1 --port 4173", url: "http://127.0.0.1:4173/xiaoman-ledger/", reuseExistingServer: !process.env.CI },
});
