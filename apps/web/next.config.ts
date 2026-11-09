import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, Long: 'long', fs: false, memcpy: false };
    return config;
  },
};
export default config;
