/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    reactStrictMode: true,
    compiler: {
      // Disable the "N" development indicator
      reactRemoveProperties: process.env.NODE_ENV === 'production',
      removeConsole: process.env.NODE_ENV === 'production',
    },
     images: {
    // Same stray-domain list found in `frontend`'s next.config.mjs (news
    // sites, a marketplace, arcdatum.com — none related to eBadge ID, and
    // confirmed via grep that this service doesn't even use next/image's
    // <Image> component anywhere, so this whole block was doing nothing
    // either way). Left as a safe, minimal default instead of removing
    // the block entirely, in case a future page adds <Image>.
    remotePatterns: [
      { protocol: 'https', hostname: 'hapi.ebadgeid.com' },
      { protocol: 'https', hostname: 'ftp.ebadgeid.com' },
    ],
  },
  }

export default nextConfig;
