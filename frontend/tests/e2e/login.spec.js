// tests/e2e/login.spec.js
//
// Real browser, real running app, real API -- no mocks. The login page is
// the one page every single user of this product has to pass through, so
// it's the highest-value place to start real E2E coverage for the first
// time (see AUDIT_FIXES.md's N-06 -- this project had unit tests for pure
// logic but zero coverage of an actual page rendering or a real user flow
// through the browser).
const { test, expect } = require('@playwright/test');

const API_BASE_URL = process.env.PLAYWRIGHT_API_BASE_URL || 'http://localhost:5050/api';

test('the login page renders the real form -- username, password, and a working submit button', async ({ page }) => {
  await page.goto('/auth/login');
  await expect(page.getByLabel(/username or email/i)).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});

test('logging in with a real, freshly self-signed-up account lands on an authenticated page', async ({ page, request }) => {
  // Real self-signup call (Free plan provisions immediately -- no payment
  // flow needed for this test), not a seeded fixture user -- so this test
  // never depends on database state left over from a previous run, and
  // never collides with another run of the same test.
  const unique = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const username = `e2e_login_${unique}`;
  const password = 'E2eLoginTest123!';

  const signupRes = await request.post(`${API_BASE_URL}/organizations/self-signup`, {
    data: {
      organization: { name: `E2E Login Co ${unique}`, city: 'City', state: 'State', country: 'PY', email: `${username}@example.test`, phone: '0000000' },
      plan_name: 'Free',
      admin: { username, password, first_name: 'E2E', last_name: 'Login', email: `${username}@example.test` },
    },
  });
  expect(signupRes.ok()).toBeTruthy();

  await page.goto('/auth/login');
  await page.getByLabel(/username or email/i).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // A successful login navigates away from /auth/login -- exactly what a
  // real user experiences, not an assumption about the destination path.
  await page.waitForURL((url) => !url.pathname.includes('/auth/login'), { timeout: 10_000 });
  await expect(page).not.toHaveURL(/\/auth\/login/);
});
