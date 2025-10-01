import ImagesPage from './images/page'

export default function Home() {
  return (
    <div>
      <div style={{ padding: 24 }}>
        <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 8 }}>Solana x402 Paywall</h1>
        <p style={{ color: '#374151', marginBottom: 16 }}>
          Accessing the full‑resolution image requires a small devnet USDC payment via Solana Devnet.
        </p>
      </div>
      <ImagesPage />
    </div>
  )
}
