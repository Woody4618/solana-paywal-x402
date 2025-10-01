import { NextRequest, NextResponse } from 'next/server'
import { Connection, ParsedInstruction, PartiallyDecodedInstruction, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { createHash } from 'node:crypto'
import { solanaConfig } from '@/lib/config'
import { verifyJwt as verifyHmacJwt, signJwt as signHmacJwt } from '@/lib/jwt'
import { createPaymentReceipt, getDidResolver, verifyPaymentRequestToken, signCredential } from 'agentcommercekit'
import { getIdentityFromPrivateKeyHex } from '@/lib/ack'

function extractMemos(tx: any): string[] {
  const memos: string[] = []
  const scan = (ix: ParsedInstruction | PartiallyDecodedInstruction) => {
    if ('program' in ix && ix.program === 'spl-memo') {
      const parsed: unknown = (ix as ParsedInstruction).parsed
      if (typeof parsed === 'string') memos.push(parsed)
      else if ((parsed as any)?.info?.memo) memos.push(String((parsed as any).info.memo))
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
    const solOpt = paymentRequest.paymentOptions.find(
      (o: { network?: string }) => typeof o.network === 'string' && o.network.startsWith('solana:'),
    )
    if (!solOpt) return NextResponse.json({ error: 'no_solana_option' }, { status: 400 })

    // Load and validate tx
    const conn = new Connection(solanaConfig.rpcUrl, solanaConfig.commitment)
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: solanaConfig.commitment,
    } as never)
    if (!tx || tx.meta?.err) return NextResponse.json({ error: 'invalid_tx' }, { status: 400 })

    const expectedMemo = createHash('sha256').update(paymentRequestToken).digest('hex').toLowerCase()
    const memos = extractMemos(tx).map((m) => m.trim().toLowerCase())
    if (!memos.includes(expectedMemo)) return NextResponse.json({ error: 'bad_memo' }, { status: 400 })

    const mint = new PublicKey(solanaConfig.mint).toBase58()
    const recipient = new PublicKey((solOpt as any).recipient as string).toBase58()
    const post = tx.meta?.postTokenBalances ?? []
    const pre = tx.meta?.preTokenBalances ?? []
    const preBal = pre.find((b: any) => b.mint === mint && b.owner === recipient)
    const postBal = post.find((b: any) => b.mint === mint && b.owner === recipient)
    if (!postBal) return NextResponse.json({ error: 'no_credit' }, { status: 400 })
    if (postBal.uiTokenAmount.decimals !== (solOpt as any).decimals)
      return NextResponse.json({ error: 'bad_decimals' }, { status: 400 })
    const preAmount = BigInt(preBal?.uiTokenAmount.amount ?? '0')
    const postAmount = BigInt(postBal.uiTokenAmount.amount)
    const delta = postAmount - preAmount
    if (delta !== BigInt((solOpt as any).amount)) return NextResponse.json({ error: 'bad_amount' }, { status: 400 })

    // Compose payer DID (did:pkh:solana) from fee payer
    const feePayer = (tx.transaction.message as any).accountKeys[0].pubkey?.toBase58?.() || ''
    const payerDid = `did:pkh:solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${feePayer}`

    // Issue ACK-Pay Receipt VC
    const receiptIssuer = await getIdentityFromPrivateKeyHex(process.env.RECEIPT_SERVICE_PRIVATE_KEY_HEX as string)
    const receipt = createPaymentReceipt({
      paymentRequestToken,
      paymentOptionId: (solOpt as any).id,
      issuer: receiptIssuer.did,
      payerDid,
    })
    const jwt = await signCredential(receipt as any, {
      did: receiptIssuer.did,
      signer: receiptIssuer.signer,
      alg: receiptIssuer.alg,
    })

    // Also return a short-lived access token for the middleware (unchanged UX)
    const now = Math.floor(Date.now() / 1000)
    const accessToken = signHmacJwt({ imageId, iat: now, exp: now + 5 * 60 }, process.env.JWT_SECRET as string)

    return NextResponse.json({ receipt: jwt, accessToken })
  } catch (e) {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
