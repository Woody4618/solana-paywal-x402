import { NextRequest, NextResponse } from 'next/server'

function findMediaUrl(input: unknown): string | undefined {
  if (!input) return undefined
  if (typeof input === 'string') {
    if (input.includes('fal.media') || input.endsWith('.mp4') || input.endsWith('.mov') || input.endsWith('.webm'))
      return input
    return undefined
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      const u = findMediaUrl(item)
      if (u) return u
    }
    return undefined
  }
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>
    if (typeof obj.url === 'string') {
      const u = obj.url
      if (u.includes('fal.media') || u.endsWith('.mp4') || u.endsWith('.mov') || u.endsWith('.webm')) return u
    }
    for (const v of Object.values(obj)) {
      const u = findMediaUrl(v)
      if (u) return u
    }
  }
  return undefined
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!process.env.FAL_KEY) return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 })

    const base = 'https://queue.fal.run/fal-ai/kling-video'
    const statusUrl = `${base}/requests/${id}/status`
    console.debug('animate/result status url', statusUrl)

    // 1) Fetch status to get response_url
    let sResp = await fetch(statusUrl, {
      method: 'GET',
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, Accept: 'application/json' },
    })
    if (sResp.status === 401) {
      sResp = await fetch(statusUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.FAL_KEY}`, Accept: 'application/json' },
      })
    }
    const sText = await sResp.text().catch(() => '')
    console.debug('animate/result status upstream', sResp.status, sText)
    if (!sResp.ok) {
      return NextResponse.json(
        { error: 'provider_error', code: sResp.status, url: statusUrl, detail: sText },
        { status: 502 },
      )
    }
    const sJson = (sText ? JSON.parse(sText) : {}) as { status?: string; response_url?: string }
    if (sJson.status !== 'COMPLETED' || !sJson.response_url) {
      return NextResponse.json({ error: 'not_ready' }, { status: 404 })
    }

    // 2) Try response_url first
    const respUrl = sJson.response_url
    console.debug('animate/result response url', respUrl)
    let rResp = await fetch(respUrl, {
      method: 'GET',
      headers: { Authorization: `Key ${process.env.FAL_KEY}`, Accept: 'application/json' },
    })
    if (rResp.status === 401) {
      rResp = await fetch(respUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${process.env.FAL_KEY}`, Accept: 'application/json' },
      })
    }
    let rText = await rResp.text().catch(() => '')
    console.debug('animate/result response upstream', rResp.status, rText)

    if (!rResp.ok && rResp.status >= 400 && rResp.status < 500) {
      const subpathUrl = `https://queue.fal.run/fal-ai/kling-video/v2.1/master/image-to-video/requests/${id}`
      console.debug('animate/result fallback url', subpathUrl)
      rResp = await fetch(subpathUrl, {
        method: 'GET',
        headers: { Authorization: `Key ${process.env.FAL_KEY}`, Accept: 'application/json' },
      })
      if (rResp.status === 401) {
        rResp = await fetch(subpathUrl, {
          method: 'GET',
          headers: { Authorization: `Bearer ${process.env.FAL_KEY}`, Accept: 'application/json' },
        })
      }
      rText = await rResp.text().catch(() => '')
      console.debug('animate/result fallback upstream', rResp.status, rText)
      if (!rResp.ok) {
        return NextResponse.json(
          { error: 'provider_error', code: rResp.status, url: subpathUrl, detail: rText },
          { status: 502 },
        )
      }
    } else if (!rResp.ok) {
      return NextResponse.json(
        { error: 'provider_error', code: rResp.status, url: respUrl, detail: rText },
        { status: 502 },
      )
    }

    const json = (rText ? JSON.parse(rText) : {}) as unknown
    const candidate =
      (json as any)?.response?.video?.url ||
      (json as any)?.video?.url ||
      findMediaUrl((json as any)?.response) ||
      findMediaUrl(json)

    if (!candidate || candidate.includes('queue.fal.run')) {
      return NextResponse.json({ error: 'not_ready', detail: 'media_url_missing' }, { status: 404 })
    }
    return NextResponse.json({ url: candidate })
  } catch (e) {
    console.error('animate/result error', e)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
