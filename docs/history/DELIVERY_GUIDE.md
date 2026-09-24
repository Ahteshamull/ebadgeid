# eBadgeID — installation and deployment guide

## Components

- `backend (updated)`: primary REST API, port 5000 by default.
- `frontend`: credential administration UI, port 3000.
- `help_backend`: helpdesk REST/WebSocket API, port 8000.
- `helpdesk_frontend`: helpdesk UI, port 3001.
- `contract`: contract collaboration UI, port 3002.

MongoDB is required by both APIs. File storage and email/AI/Shopify features require the external services listed in each `.env.example`; their credentials are intentionally not included.

## Prerequisites

- Node.js 22 LTS or newer.
- pnpm 11 (`corepack enable`, then `corepack prepare pnpm@11 --activate`).
- MongoDB 7 or a compatible managed MongoDB service.
- TLS reverse proxy in production. Cookies marked `Secure` are not sent over plain HTTP.

## Clean installation

1. Extract the ZIP into a new directory.
2. Copy each `.env.example` to `.env.local` for Next.js apps and to `.env` for APIs.
3. Generate independent random secrets; never reuse `JWT_SECRET`, `ENCRYPTION_SECRET`, or `CONTRACT_SECRET`.
4. Set exact frontend origins in both API `ALLOWED_ORIGINS` values. Production startup fails safely if this list is empty.
5. In each component folder run `pnpm install --no-frozen-lockfile` once to align the frontend lockfiles with the patched Next.js versions declared in the manifests. Commit those regenerated locks, then use `pnpm install --frozen-lockfile` in CI thereafter.
6. Run API and frontend tests:

   ```text
   cd "backend (updated)" && pnpm test
   cd help_backend && pnpm test
   cd frontend && pnpm test
   cd helpdesk_frontend && pnpm test
   cd contract && pnpm test
   ```

7. Build the three UIs with `pnpm build` in their respective folders.
8. Start development services with `pnpm start` for APIs and `pnpm dev` for UIs. For production, build first and then use `pnpm start` everywhere.

## Production layout

Use separate hostnames behind one TLS-enabled reverse proxy, for example `app`, `api`, `help`, `hapi`, and `contracts` under the same registered domain. Forward WebSocket upgrades to `help_backend`. Restrict MongoDB to the API network, run APIs as non-root processes, enable log aggregation and backups, and place rate limits at both proxy and application layers.

Never package `.env`, database dumps, uploaded private documents, access tokens, or `node_modules`. Package managers restore dependencies from `package.json` and lockfiles.

## External integrations

Redis, a durable queue broker, CDN, an actual SSO identity provider, and the eight LMS connectors require provisioned services/sandbox credentials. The repository does not claim those external systems were end-to-end tested. Configure and validate them in staging before production enablement.

## Smoke test

1. Open `/health` on the helpdesk API and the primary API health endpoint.
2. Log in and confirm the browser stores only `httpOnly` cookies; no session token should appear in Local Storage.
3. Create and verify a credential, create a helpdesk ticket, complete OTP tracking, and open a contract invitation.
4. Confirm an account from another organization receives 403 for organization-scoped resources.
5. Confirm logout clears the cookie and protected routes return 401.
