/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL || 'https://btc-station-backend-production.up.railway.app';

const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/py-api/:path*',
        destination: `${BACKEND_URL}/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
