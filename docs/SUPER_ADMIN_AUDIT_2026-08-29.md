# Super Admin audit — 2026-08-29

## Verified facts

- The production-source archive checksum matched the VPS-generated SHA-256.
- `frontend_super_admin` is now present in the complete-source tree.
- The source can make a Next.js production build: 25 routes were generated,
  including `/super_admin`, `/super_admin/organizations`,
  `/super_admin/users`, `/super_admin/transactions`, and
  `/super_admin/payment_proofs`.
- `docker compose config --no-interpolate` parsed successfully after adding
  the isolated `super-admin` service.
- No `.env`, `.env.local`, `.git`, `node_modules`, `.next`, or opaque ZIP
  artifact was included in this source delivery.

## Build and lint result

`pnpm run build`: **PASS**. The build completed and emitted a standalone
artifact after `next.config.mjs` was configured with `output: 'standalone'`.

`pnpm run lint`: **PASS WITH WARNINGS**. It reports existing React Hook
dependency warnings, unoptimized `<img>` warnings, and one missing `alt`
attribute in `src/app/settings/page.js`. The `next lint` command is also
deprecated by Next.js. None of these were converted into hidden suppressions.

## Findings requiring a separate, API-backed repair

| ID | Severity | Evidence | Consequence |
|---|---|---|---|
| SA-01 | High | All five Super Admin pages read `localStorage.getItem('token')` and send a bearer header. | It is not yet compatible with the primary application's httpOnly-cookie/CSRF session model. |
| SA-02 | High | Super Admin source has literal `https://api.ebadgeid.com` and `https://sss.ebadgeid.com` endpoints. | A rebuild for another environment cannot be configured solely by environment values. |
| SA-03 | High | Backend route scan did not locate matching route definitions for the overview, payment proofs, transaction, or Super Admin registration endpoints expected by the recovered pages. | These screens must be verified against the deployed backend/API contract before changing or enabling actions. |
| SA-04 | Medium | `super_admin/users/page.js` fetches all users then filters in the browser. | This is inefficient and is not a robust authorization boundary. |
| SA-05 | Medium | Upload handlers submit direct multipart requests to the storage endpoint without the same authorization pattern as the API calls. | Must be migrated to authenticated tenant-scoped upload routes. |
| SA-06 | Medium | Layout uses a fixed sidebar width and the pages have varying nested padding. | Responsive visual parity with the primary administrator UI has not yet been browser-verified. |

## What was deliberately not claimed

No live Super Admin login, organization creation, user creation, transaction
export, payment-proof action, or production Nginx switch was run from this
source delivery. Therefore no end-to-end claim is made for those actions.

## Required next safe step

Deploy this source as an isolated release, point it only to a staging API,
and first verify route availability plus authorization with a dedicated Super
Admin test account. Replace the legacy token mechanism and literal endpoints
only together with backend endpoints and contract tests. Do not point the
new service at `onboarding.ebadgeid.com` until that release passes its health,
login, authorization, and browser-flow checks.

## Completion status for source incorporation

- SUPER ADMIN SOURCE INCLUDED IN COMPLETE PROJECT: **YES**
- INCLUDED IN FINAL ZIP: **Pending ZIP generation**
- SUPER ADMIN BUILD VERIFIED: **YES**
- SUPER ADMIN E2E VERIFIED: **NO**
- REMAINING BLOCKERS: **SA-01 through SA-06 above; staging API route and
  authorization verification are required before production activation.**
