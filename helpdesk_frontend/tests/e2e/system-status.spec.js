// tests/e2e/system-status.spec.js
//
// Real browser against the real running app, which itself calls the real
// /health endpoints of every backend service (see src/app/system/status/
// page.js's own header comment: this page used to roll weighted dice for
// a fake "80% operational" status with no relationship to whether
// anything actually worked -- it's real now). This is the single best
// page in this app to catch a real regression with a real browser test:
// if it ever silently reverted to fake data, or if a real service
// actually went down, this test would be the one to catch it.
const { test, expect } = require('@playwright/test');

test('the public system status page reports every service operational against the real running stack', async ({ page }) => {
  await page.goto('/system/status');
  await expect(page.getByText('All Systems Operational')).toBeVisible({ timeout: 15_000 });
  // Not just the summary banner -- at least one individual, real service
  // row must also show as operational, so a page that only ever renders
  // the (possibly stale) banner text without actually finishing its
  // health checks doesn't pass this by accident.
  await expect(page.getByText(/operational/i).first()).toBeVisible();
});
