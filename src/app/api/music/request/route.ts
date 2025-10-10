import { NextRequest, NextResponse } from 'next/server'
import { solanaConfig } from '@/lib/config'
import { signJwt } from '@/lib/jwt'

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
        { status: 402 }
      )
    }

    // Calculate price based on duration (cheaper prices)
    const priceMap: Record<number, number> = {
      30: 100000,   // 0.1 USDC
      60: 200000,   // 0.2 USDC
      120: 300000,  // 0.3 USDC
    }
    const amount = priceMap[duration] || 200000

    const paymentRequest = {
      musicId: jobId,
      network: 'solana',
      currency: 'USDC',
      decimals: 6,
      amount,
      mint: solanaConfig.mint,
      recipient: solanaConfig.recipient,
    }

    // Create payment request token (for memo verification)
    // Use imageId for compatibility with existing receipt system
    const paymentRequestToken = signJwt({ imageId: jobId, prompt, genre, duration, amount }, jwtSecret)

    // Store job data (in production, use a database)
    // For now, we'll rely on the JWT token to carry the data

    return NextResponse.json(
      {
        jobId,
        paymentRequest,
        paymentRequestToken,
      },
      { status: 402 }
    )
  } catch (e: unknown) {
    console.error('music/request error', e)
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}