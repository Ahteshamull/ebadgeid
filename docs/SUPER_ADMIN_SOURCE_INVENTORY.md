# Super Admin source inventory

## Provenance

The complete `frontend_super_admin` source was recovered from the live VPS
source directory `/root/ebadge/uploadable_content/frontend_super_admin` on
2026-08-29. The transfer archive had SHA-256:

`53a6fde471be5310b97f373a1c48ca99685f30d606b3824b9f58d1ecadc51fb3`

The archive checksum was verified again after download before this directory
was incorporated.

## Intentionally excluded from the source delivery

- `.env` and `.env.local` files (deployment secrets)
- `node_modules` (recreated by `npm ci`)
- `.next` (recreated by `npm run build`)
- `.git` metadata
- `public/src_2b059b9d0488dffdacca4b98a7ac03bb.zip` (untracked opaque archive
  found on the VPS; it is not application source and was not executed)

## Rebuild

```bash
cp frontend_super_admin/.env.example frontend_super_admin/.env.local
docker compose build super-admin
docker compose up -d super-admin
```

The Compose service maps its container port 3000 to host port 3003 for an
isolated validation. Production routing for `onboarding.ebadgeid.com` must be
validated separately before switching any Nginx upstream.

## Current audit caveat

The recovered source contains legacy hard-coded external API URLs and uses a
legacy `localStorage` bearer-token pattern in Super Admin pages. The examples
in `.env.example` document the intended public endpoints, but those legacy
calls still require a deliberate migration and end-to-end validation before
claiming cookie/CSRF parity with the primary administrator frontend.
