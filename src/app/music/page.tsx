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
// No SPL Memo required in ACK PoP flow

type PaymentRequest = {
  musicId: string
  network: string
  currency: string
  decimals: number
  amount: number
  mint: string
  recipient: string
}

type MusicState =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'requires_payment'; jobId: string; paymentRequestToken?: string; paymentRequest: PaymentRequest }
  | { status: 'paying' }
  | { status: 'authorized'; accessToken: string; jobId: string }
  | { status: 'generating'; jobId: string; accessToken: string }
  | { status: 'completed'; url: string; title: string }
  | { status: 'error'; message: string }

export default function MusicPage() {
  const { connected, publicKey, connect, sendTransaction } = useWallet()
  const { connection } = useConnection()
  const [prompt, setPrompt] = useState('')
  const [genre, setGenre] = useState('')
  const [duration, setDuration] = useState<'30' | '60' | '120'>('60')
  const [state, setState] = useState<MusicState>({ status: 'idle' })

  const walletAddress = useMemo(() => publicKey?.toBase58() ?? '', [publicKey])

  // no memo hashing needed

  async function requestMusic() {
    if (!prompt.trim()) {
      setState({ status: 'error', message: 'Please enter a music description' })
      return
    }

    setState({ status: 'requesting' })

    try {
      const res = await fetch('/api/music/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          genre: genre || undefined,
          duration: parseInt(duration),
        }),
      })

      const data = await res.json()

      if (res.status === 402) {
        setState({
          status: 'requires_payment',
          jobId: data.jobId,
          paymentRequestToken: data.paymentRequestToken,
          paymentRequest: data.paymentRequest,
        })
      } else if (!res.ok) {
        setState({ status: 'error', message: data.error || `Request failed: ${res.status}` })
      } else {
        setState({ status: 'error', message: 'Unexpected response' })
      }
    } catch (e: unknown) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function payForMusic() {
    const st = state
    if (st.status !== 'requires_payment') return

    setState({ status: 'paying' })
    const { paymentRequest, paymentRequestToken } = st

    try {
      if (!connected) {
        await connect()
      }
      if (!publicKey || !sendTransaction) {
        setState({ status: 'error', message: 'Wallet not connected' })
        return
      }

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
          message: `Not enough USDC. Fund your wallet at https://faucet.circle.com/ (wallet: ${walletAddress || 'unknown'})`,
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

      instructions.push(createTransferInstruction(ownerAta, recipientAta, owner, paymentRequest.amount))

      const { blockhash } = await connection.getLatestBlockhash()
      const messageV0 = new TransactionMessage({
        payerKey: owner,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message()
      const tx = new VersionedTransaction(messageV0)
      const signature = await sendTransaction(tx, connection, { maxRetries: 5 })

      // Confirm transaction
      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
      } catch {
        // best-effort; proceed to server validation
      }

      // Submit receipt using shared ACK receipt endpoint
      const rec = await fetch('/api/receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, paymentRequestToken, imageId: st.jobId }),
      })
      if (!rec.ok) {
        const j = await rec.json().catch(() => ({}))
        setState({ status: 'error', message: `Receipt failed: ${j.error ?? rec.status}` })
        return
      }
      const { accessToken } = (await rec.json()) as { accessToken: string }

      setState({ status: 'authorized', accessToken, jobId: st.jobId })
    } catch (e: unknown) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  async function startGeneration() {
    const st = state
    if (st.status !== 'authorized') return

    setState({ status: 'generating', jobId: st.jobId, accessToken: st.accessToken })

    try {
      const startRes = await fetch('/api/music/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${st.accessToken}`,
        },
        body: JSON.stringify({
          jobId: st.jobId,
          prompt: prompt.trim(),
          genre: genre || undefined,
          duration: parseInt(duration),
        }),
      })

      const startData = await startRes.json()
      if (!startRes.ok) {
        setState({ status: 'error', message: startData.error || 'Generation failed' })
        return
      }

      // Direct result from simplified API
      setState({
        status: 'completed',
        url: startData.url,
        title: startData.title,
      })
    } catch (e: unknown) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  function resetForm() {
    setState({ status: 'idle' })
    setPrompt('')
    setGenre('')
  }

  const canRequest = state.status === 'idle' && prompt.trim().length > 0

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-2">AI Music Generation</h1>
      <p className="text-gray-600 mb-6">Generate custom music with AI using text descriptions</p>

      {/* Input Form */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium mb-2">Music Description *</label>
          <textarea
            className="w-full p-3 border rounded-lg resize-none"
            placeholder="e.g., Upbeat electronic music for working, with piano and synth sounds"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={state.status !== 'idle'}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Duration</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value as '30' | '60' | '120')}
              className="w-full p-2 border rounded"
              disabled={state.status !== 'idle'}
            >
              <option value="30">30 seconds - 0.01 USDC</option>
              <option value="60">1 minute - 0.02 USDC</option>
              <option value="120">2 minutes - 0.03 USDC</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Genre (optional)</label>
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full p-2 border rounded"
              disabled={state.status !== 'idle'}
            >
              <option value="">Auto-detect</option>
              <option value="electronic">Electronic</option>
              <option value="jazz">Jazz</option>
              <option value="pop">Pop</option>
              <option value="classical">Classical</option>
              <option value="ambient">Ambient</option>
              <option value="rock">Rock</option>
              <option value="folk">Folk</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-4">
        {state.status === 'idle' && (
          <Button onClick={requestMusic} disabled={!canRequest} className="w-full">
            Generate Music
          </Button>
        )}

        {state.status === 'requesting' && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p>Processing request...</p>
          </div>
        )}

        {state.status === 'requires_payment' && (
          <div className="border rounded-lg p-4 bg-yellow-50">
            <h3 className="font-medium mb-2">Payment Required</h3>
            <p className="text-sm text-gray-600 mb-4">
              Cost: {state.paymentRequest.amount / 100000} USDC for {duration} seconds of music
            </p>
            {connected ? (
              <Button onClick={payForMusic} className="w-full">
                Pay with Solana
              </Button>
            ) : (
              <WalletButton />
            )}
          </div>
        )}

        {state.status === 'paying' && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p>Processing payment...</p>
          </div>
        )}

        {state.status === 'authorized' && (
          <Button onClick={startGeneration} className="w-full">
            Generate Music
          </Button>
        )}

        {state.status === 'generating' && (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p>Generating your music...</p>
            <p className="text-sm text-gray-600 mt-2">This may take a few seconds</p>
          </div>
        )}

        {state.status === 'completed' && (
          <div className="border rounded-lg p-4 bg-green-50">
            <h3 className="font-medium mb-2">Music Generated Successfully!</h3>
            <p className="text-sm text-gray-600 mb-4">Title: {state.title}</p>
            <audio controls className="w-full mb-4">
              <source src={state.url} type="audio/mpeg" />
              Your browser does not support the audio element.
            </audio>
            <div className="space-x-2">
              <Button onClick={() => window.open(state.url, '_blank')}>Open Audio</Button>
              <a href={state.url} download>
                <Button variant="outline">Download</Button>
              </a>
              <Button variant="outline" onClick={resetForm}>
                Generate Another
              </Button>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="border rounded-lg p-4 bg-red-50">
            <h3 className="font-medium text-red-800 mb-2">Error</h3>
            <p className="text-sm text-red-600 mb-4">{state.message}</p>
            <Button variant="outline" onClick={resetForm}>
              Try Again
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
