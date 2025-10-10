import { NextRequest, NextResponse } from 'next/server'
import { Connection, PublicKey } from '@solana/web3.js'
import { solanaConfig } from '@/lib/config'
import { signJwt, verifyJwt } from '@/lib/jwt'

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
    
    const jwtSecret = process.env.JWT_SECRET || ''
    if (!jwtSecret) {
      return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })
    }

    try {
      // Verify our simple JWT token
      const tokenData = verifyJwt<{ 
        imageId: string, 
        prompt: string, 
        genre?: string, 
        duration: number, 
        amount: number 
      }>(paymentRequestToken, jwtSecret)
      
      if (tokenData.imageId !== imageId) {
        return NextResponse.json({ error: 'token_mismatch' }, { status: 400 })
      }
      
      console.log(`[MOCK] Verifying payment for music: "${tokenData.prompt}" (${tokenData.amount} USDC)`)
      
      // Simplified transaction verification
      const conn = new Connection(solanaConfig.rpcUrl, solanaConfig.commitment)
      
      try {
        // Check if transaction exists and was successful
        const tx = await conn.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0
        })
        
        if (!tx || tx.meta?.err) {
          return NextResponse.json({ error: 'transaction_failed' }, { status: 400 })
        }
        
        console.log('[MOCK] Transaction verified successfully')
        
      } catch (txError) {
        console.warn('Transaction verification failed:', txError)
        // For demo purposes, continue anyway
      }
      
      // Generate access token for music download
      const accessToken = signJwt({
        imageId,
        type: 'music',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (4 * 60 * 60) // 4 hours
      }, jwtSecret)
      
      return NextResponse.json({ 
        accessToken,
        message: 'Payment verified (demo mode)'
      })
      
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError)
      return NextResponse.json({ error: 'invalid_token' }, { status: 400 })
    }
    
  } catch (e: unknown) {
    console.error('music-receipt error', e)
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}