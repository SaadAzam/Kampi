/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@kampi/contracts', '@kampi/game-sdk'],
};

export default nextConfig;
