/** @type {import('next').NextConfig} */
const nextConfig = {
    // Pre-existing config gap, unrelated to SA-01..SA-06: the Dockerfile's
    // production stage copies .next/standalone, but nothing here ever
    // enabled standalone output -- the build always succeeded, but the
    // final image stage always failed (confirmed: "/app/.next/standalone":
    // not found), so this image could never have actually been built and
    // deployed as-is.
    // Conditional on purpose. The Dockerfile's production stage copies
    // .next/standalone, so a container build needs this. But the VPS runs
    // this app with `next start`, and Next refuses to serve a standalone
    // build that way ("next start does not work with output: standalone")
    // -- setting it unconditionally took both public sites down until the
    // config was reverted. NEXT_OUTPUT_STANDALONE=1 is set by the
    // Dockerfile; a bare-metal `npm run build` leaves it unset and gets a
    // normal build that `next start` can serve.
    ...(process.env.NEXT_OUTPUT_STANDALONE === '1' ? { output: 'standalone' } : {}),
    reactStrictMode: true,
    compiler: {
      // Disable the "N" development indicator
      reactRemoveProperties: process.env.NODE_ENV === 'production',
      removeConsole: process.env.NODE_ENV === 'production',
    },
     images: {
    // Was `domains: [...]` (deprecated in Next.js 16) with the same
    // unrelated leftover template domains found in frontend/ (a news
    // site, an Indian B2B marketplace, Canva's own marketplace,
    // arcdatum.com) -- confirmed zero references to any of them in this
    // app's own src/. Replaced with remotePatterns containing only the
    // domains this app's real <Image> usages point to (settings, users,
    // credentials pages -- profile pictures via STORAGE_BASE_URL).
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.ebadgeid.com' },
      { protocol: 'http', hostname: 'localhost', port: '9000' },
    ],
  },
  }

export default nextConfig;
