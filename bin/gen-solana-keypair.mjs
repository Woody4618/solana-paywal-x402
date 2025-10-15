#!/usr/bin/env node
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function printHelp() {
  console.log(
    `Generate a new Solana keypair and print convenient formats\n\nUsage:\n  node bin/gen-solana-keypair.mjs [--json]\n\nOptions:\n  --json   Output machine-readable JSON only\n`,
  )
}

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) {
  printHelp()
  process.exit(0)
}

const keypair = Keypair.generate()
const publicKey = keypair.publicKey.toBase58()
const secretKeyBytes = Array.from(keypair.secretKey)
const secretKeyBase58 = bs58.encode(keypair.secretKey)

// Generate required hex keys
const toHex = (buf) => Buffer.from(buf).toString('hex')
const serverPrivateKeyHex = toHex(randomBytes(32))
const receiptServicePrivateKeyHex = toHex(randomBytes(32))
const jwtSecret = toHex(randomBytes(32))
const serverPrivateKeyBytes = Array.from(Buffer.from(serverPrivateKeyHex, 'hex'))
const receiptServicePrivateKeyBytes = Array.from(Buffer.from(receiptServicePrivateKeyHex, 'hex'))

if (args.has('--json')) {
  const out = {
    publicKey,
    secretKeyBytes,
    secretKeyBase58,
    env: {
      SOLANA_RECIPIENT: publicKey,
      JWT_SECRET: jwtSecret,
      SERVER_PRIVATE_KEY_HEX: serverPrivateKeyHex,
      SERVER_PRIVATE_KEY_BYTES_JSON: JSON.stringify(serverPrivateKeyBytes),
      RECEIPT_SERVICE_PRIVATE_KEY_HEX: receiptServicePrivateKeyHex,
      RECEIPT_SERVICE_PRIVATE_KEY_BYTES_JSON: JSON.stringify(receiptServicePrivateKeyBytes),
    },
  }
  console.log(JSON.stringify(out, null, 2))
  process.exit(0)
}

console.log('\nNew Solana keypair generated:\n')
console.log(`Public Key (base58):\n  ${publicKey}\n`)
console.log('Secret Key (JSON bytes array):')
console.log(`  ${JSON.stringify(secretKeyBytes)}\n`)
console.log('Secret Key (base58):')
console.log(`  ${secretKeyBase58}\n`)
console.log('Suggested .env entries:')
console.log(`  SOLANA_RECIPIENT=${publicKey}`)
console.log(`  JWT_SECRET=${jwtSecret}`)
console.log(`  SERVER_PRIVATE_KEY_HEX=${serverPrivateKeyHex}`)
console.log(`  SERVER_PRIVATE_KEY_BYTES_JSON=${JSON.stringify(serverPrivateKeyBytes)}`)
console.log(`  RECEIPT_SERVICE_PRIVATE_KEY_HEX=${receiptServicePrivateKeyHex}`)
console.log(`  RECEIPT_SERVICE_PRIVATE_KEY_BYTES_JSON=${JSON.stringify(receiptServicePrivateKeyBytes)}\n`)
console.log('Tip: Keep your secret key safe. Do not commit it to source control.')

// Write/update .env.local with suggested values (non-destructive)
try {
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
  if (!get('SOLANA_RECIPIENT')) set('SOLANA_RECIPIENT', publicKey)
  if (!get('SOLANA_RECIPIENT_PRIVATE')) set('SOLANA_RECIPIENT_PRIVATE', JSON.stringify(secretKeyBytes))
  if (!get('JWT_SECRET')) set('JWT_SECRET', jwtSecret)
  if (!get('SERVER_PRIVATE_KEY_HEX')) set('SERVER_PRIVATE_KEY_HEX', serverPrivateKeyHex)
  if (!get('SERVER_PRIVATE_KEY_BYTES_JSON')) set('SERVER_PRIVATE_KEY_BYTES_JSON', JSON.stringify(serverPrivateKeyBytes))
  if (!get('RECEIPT_SERVICE_PRIVATE_KEY_HEX')) set('RECEIPT_SERVICE_PRIVATE_KEY_HEX', receiptServicePrivateKeyHex)
  if (!get('RECEIPT_SERVICE_PRIVATE_KEY_BYTES_JSON'))
    set('RECEIPT_SERVICE_PRIVATE_KEY_BYTES_JSON', JSON.stringify(receiptServicePrivateKeyBytes))
  writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n')
  console.log(`\nUpdated ${envPath} with missing values.`)
} catch (e) {
  console.warn('Could not update .env.local automatically:', e && e.message ? e.message : String(e))
}
