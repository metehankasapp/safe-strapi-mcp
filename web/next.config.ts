import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: process.env.CLOUDFLARE_STATIC_EXPORT === '1' ? 'export' : 'standalone',
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
};

export default nextConfig;
