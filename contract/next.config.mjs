/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 16 blocks dev chunks when the browser host is 127.0.0.1
  // instead of localhost, which leaves the page stuck on its loading text.
  allowedDevOrigins: ['127.0.0.1', '**.trycloudflare.com'],
  output: 'standalone',
  // With NEXT_PUBLIC_API_BASE_URL=/api the browser calls this app's own
  // origin, so a shared tunnel link works on machines that cannot reach
  // the API port directly.
  async rewrites() {
    const backend = (process.env.CONTRACT_BACKEND_URL || 'http://localhost:5000').replace(/\/$/, '');
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      { source: '/uploads/:path*', destination: `${backend}/uploads/:path*` },
    ];
  },
};

export default nextConfig;
