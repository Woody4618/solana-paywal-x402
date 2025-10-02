import { NextRequest, NextResponse } from 'next/server'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!process.env.FAL_KEY) return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })

    // Use base model id for status (no subpath)
    const base = 'https://queue.fal.run/fal-ai/kling-video'
    const url = `${base}/requests/${id}/status?logs=1`
    console.debug('animate/status url', url)

    let resp = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, Accept: 'application/json' },
    })

    if (resp.status === 401) {
      resp = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.FAL_KEY}`, Accept: 'application/json' },
      })
    }

    if (resp.status === 202 || resp.status === 404) {
      console.debug('animate/status upstream', resp.status)
      return NextResponse.json({ status: 'IN_PROGRESS' })
    }

    const text = await resp.text().catch(() => '')
    console.debug('animate/status upstream', resp.status, text)
    if (!resp.ok) {
      return NextResponse.json(
        { error: 'provider_error', code: resp.status, url, detail: text || 'bad_gateway' },
        { status: 502 },
      )
    }

    try {
      const json = JSON.parse(text)
      return NextResponse.json(json)
    } catch {
      return NextResponse.json({ raw: text }, { status: 200 })
    }
  } catch (e) {
    console.error('animate/status error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
