import { NextRequest, NextResponse } from 'next/server'
import { verifyJwt } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const jwtSecret = process.env.JWT_SECRET || ''
    if (!token || !jwtSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Access token payload contains { imageId, iat, exp } (using imageId for compatibility)
    const { imageId: musicId } = verifyJwt<{ imageId: string }>(token, jwtSecret)

    const body = (await req.json().catch(() => ({}))) as {
      jobId?: string
      prompt?: string
      genre?: string
      duration?: number
    }
    console.debug('music/start body', body)

    if (!body.jobId || body.jobId !== musicId) {
      return NextResponse.json({ error: 'forbidden', reason: 'job_mismatch' }, { status: 403 })
    }
    if (!body.prompt?.trim()) {
      return NextResponse.json({ error: 'bad_request', reason: 'missing_prompt' }, { status: 400 })
    }

    // Simple mock - directly return the generated music URL
    console.log(`[MOCK] Generated music for: "${body.prompt}" (${body.duration}s, ${body.genre || 'auto'})`)
    
    // Simulate 2-second generation delay then return result directly
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    return NextResponse.json({ 
      url: '/sample-music.mp3',
      title: `Generated: ${body.prompt.slice(0, 30)}...`,
      duration: body.duration || 60,
      format: 'mp3'
    })
  } catch (e) {
    console.error('music/start error', e)
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}