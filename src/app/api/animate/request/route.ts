import { NextRequest, NextResponse } from 'next/server'
import { createSignedPaymentRequest } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'
import { solanaConfig } from '@/lib/config'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      image_url?: string
      prompt?: string
      duration?: '5' | '10'
      aspect_ratio?: '16:9' | '9:16' | '1:1'
    }

    // Validate minimal inputs
    if (!body.image_url) {
      return NextResponse.json({ error: 'bad_request', reason: 'missing_image_url' }, { status: 400 })
    }

    const missing: string[] = []
    if (!process.env.SERVER_PRIVATE_KEY_HEX) missing.push('SERVER_PRIVATE_KEY_HEX')
    if (!process.env.RECEIPT_SERVICE_PRIVATE_KEY_HEX) missing.push('RECEIPT_SERVICE_PRIVATE_KEY_HEX')
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET')
    if (!solanaConfig.recipient) missing.push('SOLANA_RECIPIENT')

    const origin = new URL(req.url).origin

    // Create a new logical job id that we bind into the payment payload
    const jobId = crypto.randomUUID()

    // Build an ACK-Pay Payment Request and sign it if keys are present
    if (missing.length === 0) {
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
      }

      const paymentRequestInit: PaymentRequestInit = {
        id: crypto.randomUUID(),
        paymentOptions: [
          {
            id: 'usdc-solana-devnet',
            amount: BigInt(50000).toString(),
            decimals: 6,
            currency: 'USDC',
            recipient: solanaConfig.recipient,
            network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
            receiptService: `${origin}/api/receipt`,
          },
        ],
      }

      const paymentRequestBody = await createSignedPaymentRequest(paymentRequestInit, {
        issuer: server.did,
        signer: server.signer,
        algorithm: server.alg,
      })

      const now = Math.floor(Date.now() / 1000)
      const paymentRequest = {
        jti: paymentRequestInit.id,
        imageId: jobId, // use existing receipt flow by binding to imageId field
        network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        currency: 'USDC',
        decimals: 6,
        amount: 50000,
        mint: solanaConfig.mint,
        recipient: solanaConfig.recipient,
        iat: now,
        exp: now + 10 * 60,
      }

      return new NextResponse(
        JSON.stringify({
          error: 'Payment Required',
          jobId,
          paymentRequest,
          paymentRequestToken: paymentRequestBody.paymentRequestToken,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Missing keys -> 402 with setup hint, but still issue a jobId so client can retry later
    const now = Math.floor(Date.now() / 1000)
    const paymentRequest = {
      jti: crypto.randomUUID(),
      imageId: jobId,
      network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      currency: 'USDC',
      decimals: 6,
      amount: 50000,
      mint: solanaConfig.mint,
      recipient: solanaConfig.recipient,
      iat: now,
      exp: now + 10 * 60,
    }

    return new NextResponse(
      JSON.stringify({ error: 'Payment Required', reason: 'server_misconfigured', missing, jobId, paymentRequest }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
