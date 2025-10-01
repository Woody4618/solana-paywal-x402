#!/usr/bin/env node
import { randomBytes } from 'node:crypto'
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const envPath = join(process.cwd(), '.env.local')
const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : []
const get = (k) => {
  const m = lines.find((l) => l.startsWith(k + '='))
  return m ? m.slice(k.length + 1) : ''
}
const set = (k, v) => {
  const idx = lines.findIndex((l) => l.startsWith(k + '='))
  if (idx >= 0) lines[idx] = `${k}=${v}`
  else lines.push(`${k}=${v}`)
}

const hex32 = () => randomBytes(32).toString('hex')

if (!get('JWT_SECRET')) set('JWT_SECRET', hex32())
if (!get('SERVER_PRIVATE_KEY_HEX')) set('SERVER_PRIVATE_KEY_HEX', hex32())
if (!get('RECEIPT_SERVICE_PRIVATE_KEY_HEX')) set('RECEIPT_SERVICE_PRIVATE_KEY_HEX', hex32())
if (!get('SOLANA_RPC_URL')) set('SOLANA_RPC_URL', 'https://api.devnet.solana.com')
if (!get('SOLANA_USDC_MINT')) set('SOLANA_USDC_MINT', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
if (!get('SOLANA_COMMITMENT')) set('SOLANA_COMMITMENT', 'confirmed')
if (!get('SOLANA_RECIPIENT')) set('SOLANA_RECIPIENT', '')

writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n')
console.log('Wrote', envPath)
console.log('Edit SOLANA_RECIPIENT to your devnet address and restart the dev server.')
