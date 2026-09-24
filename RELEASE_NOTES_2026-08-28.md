# eBadgeID — Release notes 2026-08-28

## Included source changes

- Login now resolves an institutional/corporate email to the account's canonical username before authenticating. The login form can therefore honor its documented **username or email** behavior without weakening the existing string validation or role checks.
- Existing username login remains unchanged.

## Production incident evidence

During the production recovery on 2026-08-29 UTC, the public CSRF endpoint was restored through the API reverse proxy and verified as HTTP 200. The observed request sequence after that change was:

1. `GET /api/auth/csrf` — 200
2. `POST /api/auth/login` — 200
3. `GET /api/auth/me` — 403 in a browser profile containing an old session cookie

The same account successfully entered in a fresh private browser window. This proves that the remaining browser symptom was stale session state, not an authentication or CSRF failure in the fresh session.

## Deployment note

This archive intentionally excludes production `.env` files, credentials, database data, uploads, and Docker volumes. Create/validate those only on the VPS. Before promoting this source change, run the production preflight and test the login with both the username and institutional email paths.

## 2026-08-29 — login/session compatibility candidate

- Login resolves the submitted identifier as the existing `username` first and, when it is an email address, resolves the matching `Users.email` profile to its canonical authentication username. The password verification and role/organization resolution continue to use the canonical `AuthCredentials` record.
- Successful production login expires only legacy parent-domain `ebadge_token` cookies before setting the fresh session cookie. This prevents an older `.ebadgeid.com` cookie from being selected before the new host-scoped token after a deployment. CSRF protection remains enabled and the authenticated CSRF token is rotated exactly as before.
- Added regression coverage for institutional-email login and for the legacy cookie cleanup / fresh-cookie sequence. The candidate still requires VPS preflight, build, lint and test execution before promotion.
