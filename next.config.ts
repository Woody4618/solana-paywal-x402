import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /* config options here */
  outputFileTracingIncludes: {
    '/api/full/[id]': ['./src/private/images/**/*'],
  },
  env: {
    NEXT_PUBLIC_SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  },
}

export default nextConfig
