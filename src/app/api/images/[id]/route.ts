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
        mint?: string
      }
      type PaymentRequestInit = {
        id: string
        paymentOptions: [PaymentOption, ...PaymentOption[]]
        expiresAt?: string | Date
      }
      const option: PaymentOption = {
        id: 'usdc-solana-devnet',
        amount: BigInt(10000).toString(),
        decimals: 6,
        currency: 'USDC',
        recipient: solanaConfig.recipient,
        network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        receiptService: `${origin}/api/receipt`,
        mint: solanaConfig.mint,
      }
      const paymentRequestInit: PaymentRequestInit = {
        id: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        paymentOptions: [option],
      }
      const paymentRequestBody = await createSignedPaymentRequest(paymentRequestInit, {
        issuer: server.did,
        signer: server.signer,
        algorithm: server.alg,
      })

      const minimal = {
        jti: paymentRequestInit.id,
        imageId: id,
        network: option.network,
        currency: option.currency,
        decimals: option.decimals,
        amount: typeof option.amount === 'string' ? Number(option.amount) : option.amount,
        mint: option.mint ?? solanaConfig.mint,
        recipient: option.recipient,
      }

      return new NextResponse(
        JSON.stringify({
          error: 'Payment Required',
          paymentRequest: minimal,
          paymentOptions: paymentRequestInit.paymentOptions,
          paymentRequestToken: paymentRequestBody.paymentRequestToken,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new NextResponse(JSON.stringify({ error: 'Payment Required', reason: 'server_misconfigured', missing }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = `/api/full/${id}`
  return NextResponse.json({ url })
}
