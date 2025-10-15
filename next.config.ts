import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    '/api/full/[id]': ['./src/private/images/**/*'],
  },
}

export default nextConfig
