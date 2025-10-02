'use client'

import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useWallet } from '@solana/wallet-adapter-react'
import { WalletButton } from '@/components/solana/solana-provider'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { Buffer } from 'buffer'

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

type PaymentRequest = {
  imageId: string
  network: string
  currency: string
  decimals: number
  amount: number
  mint: string
  recipient: string
}

type ReqState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'requires_payment'; jobId: string; paymentRequestToken?: string; paymentRequest: PaymentRequest }
  | { status: 'paying' }
  | { status: 'authorized'; accessToken: string; jobId: string }
  | { status: 'starting'; jobId: string; accessToken: string }
  | { status: 'queued'; requestId: string; jobId: string; accessToken: string }
  | { status: 'running'; requestId: string; jobId: string; accessToken: string }
  | { status: 'completed'; url: string }
  | { status: 'error'; message: string }

export default function AnimatePage() {
  const { connected, publicKey, connect, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const [imageUrl, setImageUrl] = useState('')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState<'5' | '10'>('5')
  const [state, setState] = useState<ReqState>({ status: 'idle' })
  const [progress, setProgress] = useState<number>(0)

  async function sha256Hex(input: string): Promise<string> {
    const enc = new TextEncoder()
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(input))
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  async function requestPayment() {
    setState({ status: 'requesting' })
    try {
      const res = await fetch('/api/animate/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl, prompt, duration }),
      })
      if (res.status !== 402) {
        setState({ status: 'error', message: `Unexpected status ${res.status}` })
        return
      }
      const { jobId, paymentRequestToken, paymentRequest } = (await res.json()) as {
        jobId: string
        paymentRequestToken?: string
        paymentRequest: PaymentRequest
      }
      setState({ status: 'requires_payment', jobId, paymentRequestToken, paymentRequest })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function startJob(accessToken: string, jobId: string) {
    try {
      setState({ status: 'starting', jobId, accessToken })
      const startRes = await fetch('/api/animate/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, image_url: imageUrl, prompt, duration }),
      })
      if (!startRes.ok) {
        const j = await startRes.json().catch(() => ({}))
        setState({ status: 'error', message: `Start failed: ${j.error ?? startRes.status}` })
        return
      }
      const { requestId } = (await startRes.json()) as { requestId: string }
      setState({ status: 'queued', requestId, jobId, accessToken })
      pollStatus(requestId, accessToken)
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function pollStatus(requestId: string, accessToken: string) {
    try {
      // extend polling window ~10 minutes with backoff (2s -> 10s)
      let delay = 2000
      const maxDelay = 10000
      const started = Date.now()
      const timeoutMs = 10 * 60 * 1000
      for (;;) {
        const elapsed = Date.now() - started
        // naive time-based progress estimate up to 90%
        const pct = Math.min(90, Math.floor((elapsed / timeoutMs) * 90))
        setProgress(pct)
        if (elapsed > timeoutMs) break
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(maxDelay, Math.floor(delay * 1.3))
        const s = await fetch(`/api/animate/status/${requestId}`)
        if (!s.ok) continue
        const j = (await s.json()) as { status?: string; queue_position?: number }
        if (j.status === 'IN_PROGRESS' || j.status === 'IN_QUEUE') {
          setState((prev) => (prev.status === 'queued' ? { ...prev, status: 'running' } : prev))
          continue
        }
        if (j.status === 'COMPLETED') {
          const r = await fetch(`/api/animate/result/${requestId}`)
          const jr = (await r.json().catch(() => ({}))) as { url?: string }
          if (jr.url) {
            setProgress(100)
            setState({ status: 'completed', url: jr.url })
            return
          }
        }
      }
      setState({ status: 'error', message: 'Timed out' })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function pay() {
    const st = state
    if (st.status !== 'requires_payment') return
    try {
      if (!connected) {
        await connect()
      }
      if (!publicKey || !sendTransaction) {
        setState({ status: 'error', message: 'Wallet not connected' })
        return
      }

      const { paymentRequest, paymentRequestToken, jobId } = st
      const mint = new PublicKey(paymentRequest.mint)
      const recipient = new PublicKey(paymentRequest.recipient)
      const owner = publicKey
      const ownerAta = await getAssociatedTokenAddress(mint, owner, false)
      const recipientAta = await getAssociatedTokenAddress(mint, recipient, false)

      // Check balance
      let ownerAccount: Awaited<ReturnType<typeof getAccount>> | undefined
      try {
        ownerAccount = await getAccount(connection, ownerAta)
      } catch {
        ownerAccount = undefined
      }
      const amountRequired = BigInt(paymentRequest.amount)
      const ownerAmount = ownerAccount ? BigInt(ownerAccount.amount.toString()) : 0n
      if (ownerAmount < amountRequired) {
        setState({
          status: 'error',
          message: `Not enough USDC. Fund your wallet at https://faucet.circle.com/ (wallet: ${publicKey.toBase58()})`,
        })
        return
      }

      const instructions: TransactionInstruction[] = []

      if (!ownerAccount) {
        instructions.push(createAssociatedTokenAccountInstruction(owner, ownerAta, owner, mint))
      }
      try {
        await getAccount(connection, recipientAta)
      } catch {
        instructions.push(createAssociatedTokenAccountInstruction(owner, recipientAta, recipient, mint))
      }

      const expectedMemo = await sha256Hex(paymentRequestToken || '')
      const memoData = new TextEncoder().encode(expectedMemo)
      instructions.push(
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [{ pubkey: owner, isSigner: true, isWritable: false }],
          data: Buffer.from(memoData),
        }),
      )

      instructions.push(createTransferInstruction(ownerAta, recipientAta, owner, paymentRequest.amount))

      const { blockhash } = await connection.getLatestBlockhash()
      const messageV0 = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message()
      const tx = new VersionedTransaction(messageV0)
      const signature = await sendTransaction(tx, connection, { maxRetries: 5 })

      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
      } catch {}

      const rec = await fetch('/api/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, paymentRequestToken, imageId: jobId }),
      })
      if (!rec.ok) {
        const j = await rec.json().catch(() => ({}))
        setState({ status: 'error', message: `Receipt failed: ${j.error ?? rec.status}` })
        return
      }
      const { accessToken } = (await rec.json()) as { accessToken: string }
      setState({ status: 'authorized', accessToken, jobId })
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1>Animate Image</h1>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <label>
          <div>Image URL</div>
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="https://.../image.jpg"
            style={{ width: '100%', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
        </label>
        <label>
          <div>Prompt (optional)</div>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe motion / style"
            style={{ width: '100%', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}
          />
        </label>
        <label>
          <div>Duration</div>
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value as '5' | '10')}
            style={{ width: '100%', padding: 8, border: '1px solid #e5e7eb', borderRadius: 6 }}
          >
            <option value="5">5s</option>
            <option value="10">10s</option>
          </select>
        </label>

        {state.status === 'idle' && <Button onClick={requestPayment}>Request</Button>}
        {state.status === 'requesting' && <span>Preparing payment...</span>}
        {state.status === 'requires_payment' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: '#b45309' }}>402 Payment Required</span>
            {!connected && <WalletButton />}
            {connected && <Button onClick={pay}>Pay</Button>}
            <Button variant="outline" onClick={() => setState({ status: 'idle' })}>
              Cancel
            </Button>
          </div>
        )}
        {state.status === 'authorized' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button onClick={() => startJob(state.accessToken, state.jobId)}>Start</Button>
          </div>
        )}
        {state.status === 'starting' && <span>Starting...</span>}
        {(state.status === 'queued' || state.status === 'running') && (
          <div style={{ display: 'grid', gap: 8 }}>
            <span>Generating video...</span>
            <div style={{ width: '100%', height: 8, background: '#e5e7eb', borderRadius: 9999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: '#2563eb',
                  transition: 'width 400ms ease',
                }}
              />
            </div>
          </div>
        )}
        {state.status === 'completed' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <a href={state.url} target="_blank" rel="noreferrer">
              <Button>Open video</Button>
            </a>
            <video controls style={{ width: '100%' }} src={state.url} />
          </div>
        )}
        {state.status === 'error' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ color: 'crimson' }}>{state.message}</span>
            <Button variant="outline" onClick={() => setState({ status: 'idle' })}>
              Try again
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}
