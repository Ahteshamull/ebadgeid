/** @type {import('next').NextConfig} */
const nextConfig = {
    // Conditional on purpose -- see frontend_super_admin/next.config.mjs
    // for the full reasoning: Docker needs standalone output, but the VPS
    // serves this app with `next start`, which refuses to run a
    // standalone build. Unconditional here took the site down.
    ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' } : {}),
    reactStrictMode: true,
    // The SAML SP endpoints (routes/samlRoutes.js) only exist on the
    // backend, but their URLs are built from PUBLIC_APP_URL -- this
    // frontend's own origin -- because that's what an IdP admin registers
    // (Entity ID / Reply URL) and what has to match exactly on both sides.
    // Nothing proxies /api/* from this origin to the backend otherwise, so
    // the exact URL an IdP is configured to POST back to 404s here instead
    // of ever reaching the real handler -- confirmed for real against a
    // live Microsoft Entra ID app registration (POST to
    // http://localhost:3000/api/auth/saml/<org>/acs returned this app's own
    // 404 page, while the same path against the backend directly returned
    // the real response). This rewrite is the fix: only the SAML surface is
    // proxied, not all of /api/* -- normal app API calls already go
    // straight to the backend via NEXT_PUBLIC_API_BASE_URL and don't need
    // this. SAML_BACKEND_URL is a plain (non-NEXT_PUBLIC_) server-only env
    // var -- never sent to the browser -- but note it still has to be a
    // Docker build ARG, not just a runtime `environment:` entry: Next.js
    // resolves rewrites() once during `next build` into
    // routes-manifest.json, the same as redirects()/headers(), not per
    // request or per container start. A runtime-only value here is
    // silently ignored in favor of whatever was set (or defaulted) at
    // build time -- confirmed for real, not assumed (see the Dockerfile's
    // matching comment on SAML_BACKEND_URL). See docker-compose.yml's app
    // service for the real build-time value (the backend's address on the
    // docker network, not localhost).
    async rewrites() {
      const backend = (process.env.SAML_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');
      return [
        { source: '/api/auth/saml/:path*', destination: `${backend}/api/auth/saml/:path*` },
      ];
    },
    compiler: {
      // Disable the "N" development indicator
      reactRemoveProperties: process.env.NODE_ENV === 'production',
      removeConsole: process.env.NODE_ENV === 'production',
    },
     images: {
    // Was `domains: [...]` (deprecated in Next.js 16) with six unrelated
    // domains — a news site, an Indian B2B marketplace, Canva's own
    // marketplace, arcdatum.com — none of which are used by any <Image>
    // in this codebase (confirmed: zero references to any of them). Worse,
    // the one domain that IS actually needed (api.ebadgeid.com, where
    // template preview images — design.main_template_url — are served
    // from) was never in the list at all, meaning those previews would
    // have failed to load in production under Next.js's default strict
    // image-domain enforcement. Replaced with remotePatterns containing
    // only the domains real <Image> usages in this app actually point to.
    remotePatterns: [
      { protocol: 'https', hostname: 'api.ebadgeid.com' },
      { protocol: 'https', hostname: 'ftp.ebadgeid.com' },
      // Local/docker-compose storage.js (see src/lib/api.js UPLOAD_BASE_URL)
      // — profile pictures (users/page.js) are served from here in any
      // deployment that isn't pointed at ftp.ebadgeid.com explicitly.
      { protocol: 'http', hostname: 'localhost', port: '9000' },
    ],
  },
  }

export default nextConfig;
