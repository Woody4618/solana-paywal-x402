import { NextRequest, NextResponse } from 'next/server'
import { solanaConfig } from '@/lib/config'
import { createSignedPaymentRequest } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'

export async function POST(request: NextRequest) {
  try {
    const { prompt, genre, duration } = (await request.json().catch(() => ({}))) as {
      prompt?: string
      genre?: string
      duration?: number
    }

    // Validate input
    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    if (!duration || ![30, 60, 120].includes(duration)) {
      return NextResponse.json({ error: 'Invalid duration' }, { status: 400 })
    }

    // Check server configuration
    const missing: string[] = []
    if (!solanaConfig.mint) missing.push('SOLANA_USDC_MINT')
    if (!solanaConfig.recipient) missing.push('SOLANA_RECIPIENT')
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET')

    const jobId = crypto.randomUUID()
    const jwtSecret = process.env.JWT_SECRET || ''

    if (missing.length > 0) {
      const paymentRequest = {
        musicId: jobId,
        network: 'solana',
        currency: 'USDC',
        decimals: 6,
        amount: 0,
        mint: '',
        recipient: '',
      }
      return NextResponse.json(
        { error: 'Payment Required', reason: 'server_misconfigured', missing, jobId, paymentRequest },
        { status: 402 },
      )
    }

    // Calculate price based on duration (cheaper prices)
    const priceMap: Record<number, number> = {
      30: 10000, // 0.01 USDC
      60: 20000, // 0.02 USDC
      120: 30000, // 0.03 USDC
    }
    const amount = priceMap[duration] || 200000

    const origin = new URL(request.url).origin
    const server = await getIdentityFromPrivateKeyHex(process.env.SERVER_PRIVATE_KEY_HEX as string)

    type PaymentOption = {
      id: string
      amount: string
      decimals: number
      currency: string
      recipient: string
      network: string
      receiptService: string
    }
    type PaymentRequestInit = {
      id: string
      paymentOptions: [PaymentOption, ...PaymentOption[]]
      expiresAt?: string | Date
    }

    // Derive CAIP-2 chainRef from RPC
    const rpc = (process.env.SOLANA_RPC_URL || '').toLowerCase()
    const chainRef = rpc.includes('devnet')
      ? '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
      : rpc.includes('testnet')
        ? 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
        : '5eykt4UsFv8P8NJdTREpEqAZ4rZDVNHDxxy3j2Gj7hJ'

    const option: PaymentOption = {
      id: `usdc-solana-devnet-music-${duration}`,
      amount: BigInt(amount).toString(),
      decimals: 6,
      currency: 'USDC',
      recipient: solanaConfig.recipient,
      network: `solana:${chainRef}`,
      receiptService: `${origin}/api/receipt`,
    }
    const paymentRequestInit: PaymentRequestInit = {
      id: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      paymentOptions: [option],
    }

    const signed = await createSignedPaymentRequest(paymentRequestInit, {
      issuer: server.did,
      signer: server.signer,
      algorithm: server.alg,
    })

    // Minimal client payload for UI (non-authoritative; token is source of truth)
    const paymentRequest = {
      musicId: jobId,
      network: option.network,
      currency: option.currency,
      decimals: option.decimals,
      amount,
      mint: solanaConfig.mint,
      recipient: solanaConfig.recipient,
    }

    return NextResponse.json(
      {
        jobId,
        paymentRequest,
        paymentOptions: paymentRequestInit.paymentOptions,
        paymentRequestToken: signed.paymentRequestToken,
      },
      { status: 402 },
    )
  } catch (e: unknown) {
    console.error('music/request error', e)
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}
