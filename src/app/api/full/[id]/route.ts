import { NextRequest } from 'next/server'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { verifyJwt } from '@/lib/jwt'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(req.url)
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('access') || ''
  const secret = process.env.JWT_SECRET || ''
  if (!token || !secret) return new Response('Unauthorized', { status: 401 })

  try {
    const { imageId, exp } = verifyJwt<{ imageId: string; iat: number; exp: number }>(token, secret)
    const now = Math.floor(Date.now() / 1000)
    if (exp < now || imageId !== id) return new Response('Unauthorized', { status: 401 })
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  const extPairs = [
    ['mov', 'video/quicktime'],
    ['mp4', 'video/mp4'],
    ['webm', 'video/webm'],
    ['jpeg', 'image/jpeg'],
    ['jpg', 'image/jpeg'],
    ['png', 'image/png'],
  ] as const

  let filePath = ''
  let contentType = ''
  let selectedExt = ''
  for (const [ext, type] of extPairs) {
    const candidates = [
      join(process.cwd(), 'src', 'private', 'images', `${id}_high.${ext}`),
      join(process.cwd(), 'src', 'private', 'images', `${id}_high.${ext.toUpperCase()}`),
    ]
    const found = candidates.find((p) => existsSync(p))
    if (found) {
      filePath = found
      contentType = type
      selectedExt = ext
      break
    }
  }
  if (!filePath) return new Response('Not Found', { status: 404 })

  try {
    const stat = statSync(filePath)
    const nodeStream = createReadStream(filePath)
    const webStream = new ReadableStream<Uint8Array>({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          const bytes = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)
          controller.enqueue(bytes)
        })
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel() {
        nodeStream.destroy()
      },
    })
    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${id}_high.${selectedExt}"`,
        'Cache-Control': 'private, max-age=0, no-store',
      },
    })
  } catch {
    return new Response('Not Found', { status: 404 })
  }
}
