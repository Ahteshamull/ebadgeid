// playwright.config.js
//
// Real end-to-end browser tests -- separate from tests/*.test.mjs (pure
// function unit tests, already established, still the right tool for
// logic that doesn't need a browser). This is for what those can't cover:
// does the actual page render, and does a real user flow through the
// real running app (backed by the real API, not mocked) actually work.
//
// baseURL defaults to the docker-compose app service's host port
// (docker-compose.yml maps app -> 3000:3000) -- override PLAYWRIGHT_BASE_URL
// to point at a different environment (e.g. a CI-started dev server).
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
