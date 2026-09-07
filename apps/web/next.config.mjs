/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  distDir: process.env.KAMPI_NEXT_DIST_DIR ?? '.next',
  transpilePackages: ['@kampi/contracts', '@kampi/game-sdk'],
};

export default nextConfig;
