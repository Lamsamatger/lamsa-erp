/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lamsa-fashion.com' },
      { protocol: 'https', hostname: '**' },
    ],
  },
}

export default nextConfig

