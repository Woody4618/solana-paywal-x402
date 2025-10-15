import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey, TokenBalance } from '@solana/web3.js'
import bs58 from 'bs58'
import { solanaConfig } from '@/lib/config'
import { signJwt as signHmacJwt } from '@/lib/jwt'
import { createPaymentReceipt, getDidResolver, verifyPaymentRequestToken, signCredential } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'

// Memo extraction removed in ACK PoP flow

function toBase58FromAccountKey(key: unknown): string {
  if (typeof key === 'object' && key !== null) {
    const rec = key as { toBase58?: () => string; pubkey?: { toBase58?: () => string } }
    if (typeof rec.toBase58 === 'function') {
      return rec.toBase58()
    }
    if (rec.pubkey && typeof rec.pubkey.toBase58 === 'function') {
      return rec.pubkey.toBase58()
    }
  }
  return ''
}

export async function POST(req: NextRequest) {
  try {
    const { signature, paymentRequestToken, imageId, paymentOptionId } = (await req.json()) as {
      signature: string
      paymentRequestToken: string
      imageId: string
      paymentOptionId?: string
    }
    if (!signature || !paymentRequestToken || !imageId) {
      return NextResponse.json({ error: 'bad_request' }, { status: 400 })
    }
    if (!process.env.RECEIPT_SERVICE_PRIVATE_KEY_HEX || !process.env.SERVER_PRIVATE_KEY_HEX) {
      return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
    }

    // Verify PaymentRequestToken (ACK-Pay)
    const resolver = getDidResolver()
    const { paymentRequest } = await verifyPaymentRequestToken(paymentRequestToken, { resolver })

    type SolanaOption = {
      id: string
      network: string
      recipient: string
      decimals: number
      amount: string | number | bigint
      // Optional extension: some deployments may include the SPL mint directly on the option
      mint?: string
    }
    const isSolanaOption = (o: unknown): o is SolanaOption => {
      if (typeof o !== 'object' || o === null) return false
      const r = o as Record<string, unknown>
      return (
        typeof r.network === 'string' &&
        r.network.startsWith('solana:') &&
        typeof r.id === 'string' &&
        typeof r.recipient === 'string' &&
        typeof r.decimals === 'number' &&
        (typeof r.amount === 'string' || typeof r.amount === 'number' || typeof r.amount === 'bigint')
      )
    }

    let solOpt: SolanaOption | undefined
    if (paymentOptionId) {
      const byId = paymentRequest.paymentOptions.find(
        (o: unknown) => typeof (o as { id?: unknown }).id === 'string' && (o as { id: string }).id === paymentOptionId,
      )
      if (byId && isSolanaOption(byId)) solOpt = byId
    }
    if (!solOpt) solOpt = paymentRequest.paymentOptions.find(isSolanaOption)
    if (!solOpt) return NextResponse.json({ error: 'no_solana_option' }, { status: 400 })

    // Load and validate tx
    const conn = new Connection(solanaConfig.rpcUrl, solanaConfig.commitment)
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: solanaConfig.commitment,
    })
    if (!tx || tx.meta?.err) return NextResponse.json({ error: 'invalid_tx' }, { status: 400 })

    // Optional time-bounded validation: ensure tx occurred before payment request expiry (if present)
    const expiresAt = (() => {
      const pr = paymentRequest as unknown as { expiresAt?: unknown }
      const val = pr?.expiresAt
      if (typeof val === 'number') return val
      if (typeof val === 'string') {
        const ms = Date.parse(val)
        if (!Number.isNaN(ms)) return Math.floor(ms / 1000)
      }
      return undefined
    })()
    if (typeof expiresAt === 'number' && typeof tx.blockTime === 'number') {
      if (tx.blockTime > expiresAt) return NextResponse.json({ error: 'expired_request' }, { status: 400 })
    }

    const mintCandidate = (solOpt as { mint?: unknown }).mint
    const resolvedMint = typeof mintCandidate === 'string' ? mintCandidate : solanaConfig.mint
    if (typeof resolvedMint !== 'string' || !resolvedMint)
      return NextResponse.json({ error: 'missing_mint' }, { status: 400 })
    const mint = new PublicKey(resolvedMint).toBase58()
    const recipient = new PublicKey(solOpt.recipient).toBase58()
    const post: TokenBalance[] = tx.meta?.postTokenBalances ?? []
    const pre: TokenBalance[] = tx.meta?.preTokenBalances ?? []
    const preBal = pre.find((b) => b.mint === mint && b.owner === recipient)
    const postBal = post.find((b) => b.mint === mint && b.owner === recipient)
    if (!postBal) return NextResponse.json({ error: 'no_credit' }, { status: 400 })
    if (postBal.uiTokenAmount.decimals !== solOpt.decimals)
      return NextResponse.json({ error: 'bad_decimals' }, { status: 400 })
    const preAmount = BigInt(preBal?.uiTokenAmount.amount ?? '0')
    const postAmount = BigInt(postBal.uiTokenAmount.amount)
    const delta = postAmount - preAmount
    const expectedAmount = typeof solOpt.amount === 'bigint' ? solOpt.amount : BigInt(solOpt.amount)
    if (delta !== expectedAmount) return NextResponse.json({ error: 'bad_amount' }, { status: 400 })

    // Compose payer DID (did:pkh:solana) from fee payer using CAIP-2 chain reference derived from solOpt.network
    const chainRefFromNetwork = (network: string): string => {
      // network is expected like 'solana:<ref>' where <ref> can be a label or CAIP-2 chain ref
      const suffix = network.split(':')[1] || ''
      // If it already looks like a base58 chain ref, use it as-is
      if (suffix.length > 30) return suffix
      const label = suffix.toLowerCase()
      if (label === 'mainnet' || label === 'mainnet-beta') return '5eykt4UsFv8P8NJdTREpEqAZ4rZDVNHDxxy3j2Gj7hJ'
      if (label === 'devnet') return '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z'
      if (label === 'testnet') return 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
      // Fallback to provided suffix (better than a hardcoded default)
      return suffix || '5eykt4UsFv8P8NJdTREpEqAZ4rZDVNHDxxy3j2Gj7hJ'
    }
    const firstKey = (tx.transaction.message as { accountKeys: unknown[] }).accountKeys[0]
    const feePayer = toBase58FromAccountKey(firstKey)
    const networkCandidate = (solOpt as { network?: unknown }).network
    const chainRef = chainRefFromNetwork(typeof networkCandidate === 'string' ? networkCandidate : '')
    const payerDid = `did:pkh:solana:${chainRef}:${feePayer}` as `did:${string}:${string}`

    // Issue ACK-Pay Receipt VC
    const receiptIssuer = await getIdentityFromPrivateKeyHex(process.env.RECEIPT_SERVICE_PRIVATE_KEY_HEX as string)
    const receipt = createPaymentReceipt({
      paymentRequestToken,
      paymentOptionId: solOpt.id,
      issuer: receiptIssuer.did,
      payerDid,
    })
    const jwt = await signCredential(receipt as unknown as Parameters<typeof signCredential>[0], {
      did: receiptIssuer.did,
      signer: receiptIssuer.signer,
      alg: receiptIssuer.alg,
    })

    // Also return a short-lived access token for the middleware (unchanged UX)
    const now = Math.floor(Date.now() / 1000)
    const accessToken = signHmacJwt({ imageId, iat: now, exp: now + 5 * 60 }, process.env.JWT_SECRET as string)

    return NextResponse.json({ receipt: jwt, accessToken })
  } catch (e) {
    console.log('POST /api/receipt error:', e)
    // Log server-side and surface a hint in non-production
    console.error('POST /api/receipt error:', e)
    const reason = process.env.NODE_ENV === 'production' ? undefined : e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}
