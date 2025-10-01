import { NextRequest, NextResponse } from 'next/server'
import { createSignedPaymentRequest } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'
import { solanaConfig } from '@/lib/config'
import { verifyJwt as verifyHmacJwt } from '@/lib/jwt'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Authorization: Bearer <accessToken>
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const jwtSecret = process.env.JWT_SECRET || ''
  if (token && jwtSecret) {
    try {
      const { imageId, exp } = verifyHmacJwt<{ imageId: string; iat: number; exp: number }>(token, jwtSecret)
      const now = Math.floor(Date.now() / 1000)
      if (exp >= now && imageId === id) {
        const url = `/api/full/${id}`
        return NextResponse.json({ url })
      }
    } catch {}
  }

  const authorized = false
  if (!authorized) {
    const missing: string[] = []
    if (!process.env.SERVER_PRIVATE_KEY_HEX) missing.push('SERVER_PRIVATE_KEY_HEX')
    if (!process.env.RECEIPT_SERVICE_PRIVATE_KEY_HEX) missing.push('RECEIPT_SERVICE_PRIVATE_KEY_HEX')
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET')
    if (!solanaConfig.recipient) missing.push('SOLANA_RECIPIENT')

    const origin = new URL(req.url).origin

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
        paymentOptions: PaymentOption[]
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

      // Keep client payload shape but with a real ACK-Pay token
      const minimal = {
        jti: paymentRequestInit.id,
        imageId: id,
        network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        currency: 'USDC',
        decimals: 6,
        amount: 50000,
        mint: solanaConfig.mint,
        recipient: solanaConfig.recipient,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 10 * 60,
      }

      return new NextResponse(
        JSON.stringify({
          error: 'Payment Required',
          paymentRequest: minimal,
          paymentRequestToken: paymentRequestBody.paymentRequestToken,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Missing keys -> 402 with setup hint
    const now = Math.floor(Date.now() / 1000)
    const paymentRequest = {
      jti: crypto.randomUUID(),
      imageId: id,
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
      JSON.stringify({ error: 'Payment Required', reason: 'server_misconfigured', missing, paymentRequest }),
      { status: 402, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const url = `/api/full/${id}`
  return NextResponse.json({ url })
}
