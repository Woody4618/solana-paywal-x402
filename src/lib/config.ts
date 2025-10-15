export const solanaConfig = {
  rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
  mint: process.env.SOLANA_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  recipient: process.env.SOLANA_RECIPIENT ?? '',
  commitment: (process.env.SOLANA_COMMITMENT as 'confirmed' | 'finalized') ?? 'confirmed',
}

export const jwtSecret = process.env.JWT_SECRET ?? ''
