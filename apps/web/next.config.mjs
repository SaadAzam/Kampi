/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  distDir: process.env.KAMPI_NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@kampi/contracts', '@kampi/game-sdk'],
  async headers() {
    return [
      {
        source: '/art/lobby/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

export default nextConfig;
