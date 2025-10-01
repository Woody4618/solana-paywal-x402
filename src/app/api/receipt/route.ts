import { NextRequest, NextResponse } from 'next/server'
import {
  Connection,
  ParsedInstruction,
  PartiallyDecodedInstruction,
  PublicKey,
  ParsedTransactionWithMeta,
  TokenBalance,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { createHash } from 'node:crypto'
import { solanaConfig } from '@/lib/config'
import { signJwt as signHmacJwt } from '@/lib/jwt'
import { createPaymentReceipt, getDidResolver, verifyPaymentRequestToken, signCredential } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'

function extractMemos(tx: ParsedTransactionWithMeta): string[] {
  const memos: string[] = []
  const scan = (ix: ParsedInstruction | PartiallyDecodedInstruction) => {
    if ('program' in ix && ix.program === 'spl-memo') {
      const parsed: unknown = (ix as ParsedInstruction).parsed
      if (typeof parsed === 'string') {
        memos.push(parsed)
      } else if (typeof parsed === 'object' && parsed !== null && 'info' in parsed) {
        const info = (parsed as { info?: { memo?: unknown } }).info
        const memoVal = info?.memo
        if (typeof memoVal === 'string') memos.push(memoVal)
        else if (memoVal != null) memos.push(String(memoVal))
      }
      return
    }
    if ('programId' in ix) {
      const pid = (ix as PartiallyDecodedInstruction).programId.toBase58()
      const data = (ix as PartiallyDecodedInstruction).data
      if (pid === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' && typeof data === 'string') {
        try {
          const raw = bs58.decode(data)
          memos.push(Buffer.from(raw).toString('utf8'))
        } catch {}
      }
    }
  }
  for (const ix of tx.transaction.message.instructions as Array<ParsedInstruction | PartiallyDecodedInstruction>)
    scan(ix)
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions as Array<ParsedInstruction | PartiallyDecodedInstruction>) scan(ix)
  }
  return memos
}

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
    const { signature, paymentRequestToken, imageId } = (await req.json()) as {
      signature: string
      paymentRequestToken: string
      imageId: string
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

    const solOpt = paymentRequest.paymentOptions.find(isSolanaOption)
    if (!solOpt) return NextResponse.json({ error: 'no_solana_option' }, { status: 400 })

    // Load and validate tx
    const conn = new Connection(solanaConfig.rpcUrl, solanaConfig.commitment)
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: solanaConfig.commitment,
    })
    if (!tx || tx.meta?.err) return NextResponse.json({ error: 'invalid_tx' }, { status: 400 })

    const expectedMemo = createHash('sha256').update(paymentRequestToken).digest('hex').toLowerCase()
    const memos = extractMemos(tx).map((m) => m.trim().toLowerCase())
    if (!memos.includes(expectedMemo)) return NextResponse.json({ error: 'bad_memo' }, { status: 400 })

    const mint = new PublicKey(solanaConfig.mint).toBase58()
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

    // Compose payer DID (did:pkh:solana) from fee payer
    const firstKey = (tx.transaction.message as { accountKeys: unknown[] }).accountKeys[0]
    const feePayer = toBase58FromAccountKey(firstKey)
    const payerDid = `did:pkh:solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${feePayer}` as `did:${string}:${string}`

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
    // Log server-side and surface a hint in non-production
    console.error('POST /api/receipt error:', e)
    const reason = process.env.NODE_ENV === 'production' ? undefined : e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}
