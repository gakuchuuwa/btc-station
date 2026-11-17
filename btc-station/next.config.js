/** @type {import('next').NextConfig} */
const BACKEND_URL = process.env.BACKEND_URL || (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:8000' : 'https://api.quant-lab.org');

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
