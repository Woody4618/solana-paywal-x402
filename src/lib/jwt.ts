import { createHmac } from 'node:crypto'

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const h = b64url(JSON.stringify(header))
  const p = b64url(JSON.stringify(payload))
  const data = `${h}.${p}`
  const sig = b64url(createHmac('sha256', secret).update(data).digest())
  return `${data}.${sig}`
}

export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): T {
  const [h, p, s] = token.split('.')
  if (!h || !p || !s) throw new Error('bad_jwt')
  const data = `${h}.${p}`
  const sig = b64url(createHmac('sha256', secret).update(data).digest())
  if (sig !== s) throw new Error('bad_sig')
  return JSON.parse(Buffer.from(p, 'base64').toString('utf8')) as T
}
