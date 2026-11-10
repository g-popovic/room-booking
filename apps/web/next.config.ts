import type { NextConfig } from 'next';

const config: NextConfig = {
  agentRules: false,
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:4000/api/:path*',
      },
    ];
  },
};

export default config;
