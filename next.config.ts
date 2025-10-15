import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    '/api/full/[id]': ['./src/private/images/**/*'],
  },
  // Only lint the app code; exclude bot workspace
  eslint: {
    dirs: ['src'],
  },
  // Ensure Next.js doesn't try to bundle or type-check the twitter-bot workspace
  transpilePackages: [],
}

export default nextConfig
