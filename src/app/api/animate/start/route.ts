import { NextRequest, NextResponse } from 'next/server'
import { verifyJwt } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const jwtSecret = process.env.JWT_SECRET || ''
    if (!token || !jwtSecret) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    // Access token payload contains { imageId, iat, exp }
    const { imageId } = verifyJwt<{ imageId: string }>(token, jwtSecret)

    const body = (await req.json().catch(() => ({}))) as {
      jobId?: string
      image_url?: string
      prompt?: string
      duration?: '5' | '10'
      aspect_ratio?: '16:9' | '9:16' | '1:1'
    }
    console.debug('animate/start body', body)

    if (!body.jobId || body.jobId !== imageId) {
      return NextResponse.json({ error: 'forbidden', reason: 'job_mismatch' }, { status: 403 })
    }
    if (!body.image_url) {
      return NextResponse.json({ error: 'bad_request', reason: 'missing_image_url' }, { status: 400 })
    }

    if (!process.env.FAL_KEY) {
      return NextResponse.json({ error: 'server_misconfigured', missing: ['FAL_KEY'] }, { status: 500 })
    }

    const url = 'https://queue.fal.run/fal-ai/kling-video/v2.1/master/image-to-video'
    console.debug('animate/start submit url', url)

    let submitResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${process.env.FAL_KEY}`,
      },
      body: JSON.stringify({
        image_url: body.image_url,
        prompt: body.prompt ?? '',
        duration: body.duration ?? '5',
      }),
    })
    if (submitResp.status === 401) {
      // Retry with Bearer if provider expects it
      submitResp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.FAL_KEY}`,
        },
        body: JSON.stringify({
          image_url: body.image_url,
          prompt: body.prompt ?? '',
          duration: body.duration ?? '5',
        }),
      })
    }
    const raw = await submitResp.text().catch(() => '')
    console.debug('animate/start upstream', submitResp.status, raw)
    if (!submitResp.ok) {
      return NextResponse.json({ error: 'provider_error', code: submitResp.status, url, detail: raw }, { status: 502 })
    }
    const submitJson = (raw ? JSON.parse(raw) : {}) as { request_id?: string }
    const requestId = submitJson.request_id
    if (!requestId)
      return NextResponse.json({ error: 'provider_error', url, detail: raw || 'missing_request_id' }, { status: 502 })

    return NextResponse.json({ jobId: body.jobId, requestId, state: 'queued' })
  } catch (e) {
    console.error('animate/start error', e)
    const reason = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'server_error', reason }, { status: 500 })
  }
}
