// tests/e2e/collaborate.spec.js
//
// Real browser against the real running app + real API. This app has no
// login of its own -- access to a contract only ever comes through a
// fragment-token invitation link (see tests/contract-session.test.mjs's
// existing unit coverage of that exchange), so direct/blind access is
// deliberately refused rather than silently allowed. These two tests
// cover the two things that must always be true for every visitor before
// any invitation-token logic even runs: the root page's deliberate
// "not allowed" refusal, and a real, non-crashing error when a contract
// code doesn't resolve to anything real.
const { test, expect } = require('@playwright/test');

test('the root path deliberately refuses direct access -- contracts are only ever reached through a real invitation link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /not allowed/i })).toBeVisible();
  await expect(page.getByText(/403/)).toBeVisible();
});

test('a contract code that does not exist shows a real error instead of crashing the page', async ({ page }) => {
  await page.goto('/collaborate/EBID-DOES-NOT-EXIST-AT-ALL');
  // Scoped past Next.js's own internal route-announcer (also role="alert",
  // but empty/decorative) to the real error Alert this page renders.
  await expect(page.locator('[data-slot="alert"]')).toBeVisible({ timeout: 15_000 });
});
