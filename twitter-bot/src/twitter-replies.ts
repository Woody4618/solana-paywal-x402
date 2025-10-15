import { TwitterApi, ApiResponseError } from 'twitter-api-v2'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Keypair,
  clusterApiUrl,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import fs from 'node:fs/promises'
import path from 'node:path'

// Env vars (OAuth 1.0a user context)
const { TWITTER_APP_KEY, TWITTER_APP_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET } = process.env as Record<
  string,
  string | undefined
>

if (!TWITTER_APP_KEY || !TWITTER_APP_SECRET || !TWITTER_ACCESS_TOKEN || !TWITTER_ACCESS_SECRET) {
  console.error(
    'Missing OAuth 1.0a user tokens. Set TWITTER_APP_KEY, TWITTER_APP_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_SECRET',
  )
  process.exit(1)
}

// Use user context for all reads
const v2 = new TwitterApi({
  appKey: TWITTER_APP_KEY,
  appSecret: TWITTER_APP_SECRET,
  accessToken: TWITTER_ACCESS_TOKEN,
  accessSecret: TWITTER_ACCESS_SECRET,
}).readOnly.v2

// Create writer for replies
const v2writer = new TwitterApi({
  appKey: TWITTER_APP_KEY!,
  appSecret: TWITTER_APP_SECRET!,
  accessToken: TWITTER_ACCESS_TOKEN!,
  accessSecret: TWITTER_ACCESS_SECRET!,
})
const v1client = v2writer.v1
const v2client = v2writer.v2

const bearerToken = process.env.TWITTER_BEARER_TOKEN
const appClient = bearerToken ? new TwitterApi(bearerToken).readOnly.v2 : v2
const PICK_LATEST_ONLY = String(process.env.TWITTER_PICK_LATEST_ONLY || 'false').toLowerCase() === 'true'

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Base URL of the x402 API (Next.js app)
const ANIMATE_API_BASE = process.env.ANIMATE_API_BASE || 'http://localhost:3000'
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet')

// Track tweets we've already kicked off flows for
const processedTweetIds = new Set<string>()

function loadAgentKeypair(): Keypair {
  const raw = process.env.AGENT_SOLANA_WALLET
  if (!raw) throw new Error('AGENT_SOLANA_WALLET not set')
  let arr: number[] = []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) arr = parsed.map((n) => Number(n))
  } catch {
    arr = raw
      .replace(/\[|\]/g, '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n))
  }
  if (!arr.length) throw new Error('AGENT_SOLANA_WALLET parse failed')
  const secret = new Uint8Array(arr)
  return Keypair.fromSecretKey(secret)
}

// Extract image/video URL robustly from a tweet using includes.media or entities.urls
function extractImageUrl(tweet: any, includes: any): string | undefined {
  try {
    const mediaIncludes = Array.isArray(includes?.media) ? (includes.media as any[]) : []
    // Collect media keys from attachments (object or array form)
    let mediaKeys: string[] = []
    const att = tweet?.attachments as any
    if (att && Array.isArray(att.media_keys)) {
      mediaKeys = att.media_keys as string[]
    } else if (Array.isArray(att)) {
      for (const it of att) {
        if (it && Array.isArray(it.media_keys)) mediaKeys.push(...(it.media_keys as string[]))
      }
    }

    if (mediaKeys.length && mediaIncludes.length) {
      const items = mediaIncludes.filter((m) => mediaKeys.includes(m.media_key))
      const photo = items.find((m) => m.type === 'photo' && typeof m.url === 'string')
      const fromMedia =
        photo?.url ?? items.find((m) => typeof (m as any).preview_image_url === 'string')?.preview_image_url
      if (typeof fromMedia === 'string') return fromMedia
    }

    // Fallback: entities.urls
    const urls = tweet?.entities?.urls as any[] | undefined
    if (Array.isArray(urls) && urls.length) {
      const u = urls.find((x) => typeof x?.expanded_url === 'string') || urls[0]
      const candidate = u?.expanded_url || u?.url
      if (typeof candidate === 'string') return candidate
    }
  } catch {}
  return undefined
}

async function ensureAtaInstructions(
  connection: Connection,
  owner: PublicKey,
  recipient: PublicKey,
  mint: PublicKey,
): Promise<{ ownerAta: PublicKey; recipientAta: PublicKey; ix: TransactionInstruction[] }> {
  const ix: TransactionInstruction[] = []
  const ownerAta = await getAssociatedTokenAddress(mint, owner, false)
  const recipientAta = await getAssociatedTokenAddress(mint, recipient, false)
  try {
    await getAccount(connection as any, ownerAta)
  } catch {
    ix.push(createAssociatedTokenAccountInstruction(owner, ownerAta, owner, mint))
  }
  try {
    await getAccount(connection as any, recipientAta)
  } catch {
    ix.push(createAssociatedTokenAccountInstruction(owner, recipientAta, recipient, mint))
  }
  return { ownerAta, recipientAta, ix }
}

async function downloadToTempFile(url: string, extFallback = '.mp4'): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  const ab = await res.arrayBuffer()
  const buf = Buffer.from(ab)
  const ext = url.split('?')[0].split('#')[0].toLowerCase().endsWith('.mp4') ? '.mp4' : extFallback
  const tmp = path.join(process.cwd(), `.tmp_upload_${Date.now()}${ext}`)
  await fs.writeFile(tmp, buf)
  return tmp
}

async function uploadVideoAndReply(doneUrl: string, replyToTweetId: string): Promise<void> {
  try {
    console.log('[x402] downloading video for upload')
    const filePath = await downloadToTempFile(doneUrl, '.mp4')
    console.log('[x402] uploading video to X')
    const data = await fs.readFile(filePath)
    const mediaId = await v1client.uploadMedia(data, { type: 'video/mp4' })
    console.log('[x402] media uploaded, id=', mediaId)
    await v2client.tweet({
      text: 'Your video is ready and i payed for it using x402 on solana.',
      media: { media_ids: [mediaId] },
      reply: { in_reply_to_tweet_id: replyToTweetId },
    })
    console.log('[x402] replied with video media')
    try {
      await fs.unlink(filePath)
    } catch {}
  } catch (e: unknown) {
    console.error('[x402] video upload failed, falling back to link', e instanceof Error ? e.message : String(e))
    await v2client.tweet({
      text: `Your video is ready and i payed for it using x402 on solana. ${doneUrl}`,
      reply: { in_reply_to_tweet_id: replyToTweetId },
    })
  }
}

// Full x402 flow: request → pay → receipt → start → poll → result → reply
async function runAnimateFlow(imageUrl: string, sourceTweetId: string): Promise<void> {
  const payer = loadAgentKeypair()
  const connection = new Connection(SOLANA_RPC_URL, { commitment: 'confirmed' })

  console.log(`[x402] request start for tweet=${sourceTweetId}`)
  const reqResp = await fetch(`${ANIMATE_API_BASE}/api/animate/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, prompt: 'Twitter mention', duration: '5' }),
  })
  const reqText = await reqResp.text().catch(() => '')
  const reqJson = reqText ? JSON.parse(reqText) : {}
  if (reqResp.status !== 402) {
    console.warn(`[x402] expected 402, got ${reqResp.status}`, reqJson)
    return
  }
  const { jobId, paymentRequestToken, paymentRequest } = reqJson as {
    jobId: string
    paymentRequestToken?: string
    paymentRequest: {
      amount: number | string | bigint
      decimals: number
      mint: string
      recipient: string
    }
  }
  if (!paymentRequest) {
    console.warn('[x402] missing paymentRequest')
    return
  }
  console.log(`[x402] payment required — jobId=${jobId}`)

  // Pick payment option id if provided (prefer Solana option)
  const paymentOptions = Array.isArray((reqJson as any).paymentOptions)
    ? ((reqJson as any).paymentOptions as any[])
    : []
  let paymentOptionId: string | undefined
  if (paymentOptions.length) {
    const sol = paymentOptions.find((o) => typeof o?.network === 'string' && o.network.startsWith('solana:'))
    paymentOptionId = (sol?.id as string | undefined) ?? (paymentOptions[0]?.id as string | undefined)
  }

  // Build and send payment
  const mint = new PublicKey(paymentRequest.mint)
  const recipient = new PublicKey(paymentRequest.recipient)
  const owner = payer.publicKey
  const { ownerAta, recipientAta, ix } = await ensureAtaInstructions(connection, owner, recipient, mint)

  const amount = typeof paymentRequest.amount === 'bigint' ? paymentRequest.amount : BigInt(paymentRequest.amount)
  ix.push(createTransferInstruction(ownerAta, recipientAta, owner, amount))

  const { blockhash } = await connection.getLatestBlockhash('finalized')
  const messageV0 = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: ix,
  }).compileToV0Message()
  const tx = new VersionedTransaction(messageV0)
  tx.sign([payer])
  const signature = await connection.sendTransaction(tx, { maxRetries: 5 })
  console.log(`[x402] payment signature=${signature}`)
  try {
    const { blockhash: bh, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized')
    await connection.confirmTransaction({ signature, blockhash: bh, lastValidBlockHeight }, 'confirmed')
  } catch {}

  // Issue receipt/access token
  const recResp = await fetch(`${ANIMATE_API_BASE}/api/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, paymentRequestToken, imageId: jobId, paymentOptionId }),
  })
  const recText = await recResp.text().catch(() => '')
  const recJson = recText ? JSON.parse(recText) : {}
  if (!recResp.ok) {
    console.warn(`[x402] receipt failed ${recResp.status}`, recJson)
    return
  }
  const accessToken = recJson.accessToken as string
  console.log('[x402] access token acquired')

  // Start job
  const startResp = await fetch(`${ANIMATE_API_BASE}/api/animate/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jobId, image_url: imageUrl, prompt: 'Twitter mention', duration: '5' }),
  })
  const startJson = startResp.ok ? await startResp.json().catch(() => ({})) : {}
  if (!startResp.ok) {
    console.warn('[x402] start failed', startJson)
    return
  }
  const requestId = startJson.requestId as string
  console.log(`[x402] started — requestId=${requestId}`)

  // Inform user on X that generation has started
  try {
    await v2client.tweet({
      text: 'Coming right up, will post the video once its done generating.',
      reply: { in_reply_to_tweet_id: sourceTweetId },
    })
  } catch (e) {
    console.warn('[x402] failed to tweet start notice', e instanceof Error ? e.message : String(e))
  }

  // Poll status until completed (max ~10 minutes)
  const pollStart = Date.now()
  let doneUrl: string | undefined
  for (;;) {
    if (Date.now() - pollStart > 10 * 60 * 1000) {
      console.warn('[x402] polling timed out')
      break
    }
    await sleep(3000)
    const s = await fetch(`${ANIMATE_API_BASE}/api/animate/status/${requestId}`)
    const sj = await s.json().catch(() => ({}))
    const st = (sj?.status as string) || ''
    console.log(`[x402] status ${st}`)
    if (st === 'COMPLETED') {
      const r = await fetch(`${ANIMATE_API_BASE}/api/animate/result/${requestId}`)
      const rj = await r.json().catch(() => ({}))
      if (rj?.url && typeof rj.url === 'string') {
        doneUrl = rj.url
        break
      }
    }
  }

  if (!doneUrl) {
    console.warn('[x402] no result url')
    return
  }
  console.log(`[x402] completed — url=${doneUrl}`)

  // Reply to tweet with video media if possible; otherwise link
  await uploadVideoAndReply(doneUrl, sourceTweetId)
}

// Start the x402 payment flow for a given image URL by calling our API, end-to-end
async function initiateAnimateFlow(imageUrl: string, sourceTweetId: string) {
  if (processedTweetIds.has(sourceTweetId)) return
  processedTweetIds.add(sourceTweetId)
  try {
    await runAnimateFlow(imageUrl, sourceTweetId)
  } catch (e: unknown) {
    console.error('[x402] flow error', e instanceof Error ? e.message : String(e))
  }
}

async function main() {
  const me = await v2.me()
  const username = me.data.username
  const userId = me.data.id
  console.log(`[auth] OK as @${username} (${userId}) [user-oauth]`)

  // Fetch first page of mentions with media expansions and log the first mention's image URL (if any)
  const res = await appClient.userMentionTimeline(userId, {
    max_results: 5,
    'tweet.fields': [
      'attachments',
      'author_id',
      'in_reply_to_user_id',
      'referenced_tweets',
      'created_at',
      'conversation_id',
      'entities',
    ],
    expansions: ['attachments.media_keys', 'author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
    'media.fields': ['url', 'preview_image_url', 'type', 'width', 'height', 'alt_text'],
  })

  // Normalize paginator shape to { data, includes, meta }
  const container =
    (res as any).data && !Array.isArray((res as any).data)
      ? (res as any).data
      : {
          data: (res as any).data?.data ?? (Array.isArray((res as any).data) ? (res as any).data : []),
          includes: (res as any).includes,
          meta: (res as any).meta,
        }

  const tweets = Array.isArray(container.data) ? (container.data as any[]) : []
  const includesTop = container.includes || {}
  const metaTop = container.meta || {}
  console.log(tweets)
  if (!tweets.length) {
    console.log('[first-mention] no mentions found')
  } else {
    const firstMention = tweets[0] as any
    const imageUrl = extractImageUrl(firstMention, includesTop)
    console.log(`[first-mention] id=${firstMention.id}`)
    if (imageUrl) {
      console.log(`[first-mention] media: ${imageUrl}`)
      await initiateAnimateFlow(imageUrl, String(firstMention.id))
    } else {
      console.log('[first-mention] no media found')
    }
  }

  let newestId: string | undefined
  if (metaTop?.newest_id && !newestId) newestId = metaTop.newest_id as string
  let sinceId: string | undefined = newestId

  // Poll every 2 minutes
  for (;;) {
    try {
      console.log(`[poll] mentions sinceId=${sinceId ?? 'none'} @${new Date().toISOString()}`)
      const res = await appClient.userMentionTimeline(userId, {
        since_id: sinceId,
        max_results: 5,
        'tweet.fields': [
          'attachments',
          'author_id',
          'in_reply_to_user_id',
          'referenced_tweets',
          'created_at',
          'conversation_id',
          'entities',
        ],
        expansions: ['attachments.media_keys', 'author_id', 'in_reply_to_user_id', 'referenced_tweets.id'],
        'media.fields': ['url', 'preview_image_url', 'type', 'width', 'height', 'alt_text'],
        'user.fields': ['username', 'name'],
      })
      const rl = (res as any).rateLimit
      // Normalize response shape again
      const pContainer =
        (res as any).data && !Array.isArray((res as any).data)
          ? (res as any).data
          : {
              data: (res as any).data?.data ?? (Array.isArray((res as any).data) ? (res as any).data : []),
              includes: (res as any).includes,
              meta: (res as any).meta,
            }
      const pMeta = pContainer.meta || {}
      if (pMeta?.newest_id) sinceId = pMeta.newest_id as string
      const pTweets = Array.isArray(pContainer.data) ? (pContainer.data as any[]) : []
      if (!pTweets.length) {
        console.log('[mentions] none')
      } else {
        console.log(`[mentions] ${pTweets.length} new`)
        const includes = pContainer.includes || {}
        if (PICK_LATEST_ONLY) {
          // Process only the newest mention with media
          const firstWithMedia = pTweets.find((t) => extractImageUrl(t, includes))
          if (firstWithMedia) {
            const mediaUrl = extractImageUrl(firstWithMedia, includes) as string
            console.log(`[mention-media(latest-only)] ${mediaUrl}`)
            await initiateAnimateFlow(mediaUrl, String(firstWithMedia.id))
          }
        } else {
          for (const t of pTweets) {
            const author = res.includes?.users?.find((u) => u.id === t.author_id)
            const isReplyToUs = (t as any).in_reply_to_user_id === userId
            const referenced = (t as any).referenced_tweets?.map((r: any) => r.type).join(',') || ''
            console.log(
              `[mention] @${author?.username ?? t.author_id} → @${username} | ${t.id} | ${t.created_at} | replyToUs=${isReplyToUs} | ref=${referenced}`,
            )
            console.log(t.text)
            console.log('---')
            const mediaUrl = extractImageUrl(t, includes)
            if (mediaUrl) {
              console.log(`[mention-media] ${mediaUrl}`)
              await initiateAnimateFlow(mediaUrl, String(t.id))
            }
          }
        }
      }
      if (rl) {
        const remaining = typeof rl.remaining === 'number' ? rl.remaining : 0
        const resetIso = typeof rl.reset === 'number' ? new Date(rl.reset * 1000).toISOString() : 'unknown'
        console.log(`[mentions] rate-limit remaining=${remaining} reset=${resetIso}`)
      }
    } catch (e: unknown) {
      const err = e as unknown as any
      if (err && typeof err === 'object' && 'code' in err && err.code === 429) {
        const rlRaw = (err as ApiResponseError).rateLimit as
          | { limit?: number; remaining?: number; reset?: number }
          | undefined
        const rl = rlRaw ?? {}
        const resetMs = rl && typeof (rl as any).reset === 'number' ? (rl as any).reset * 1000 : Date.now() + 60_000
        const limit = typeof rl.limit === 'number' ? rl.limit : 0
        const remaining = typeof rl.remaining === 'number' ? rl.remaining : 0
        const resetIso = new Date(resetMs).toISOString()
        const waitMs = Math.max(resetMs - Date.now(), 60_000)
        console.warn(
          `[rate-limit] 429. limit=${limit} remaining=${remaining} reset=${resetIso} — sleeping ${Math.ceil(waitMs / 1000)}s`,
        )
        await sleep(waitMs)
        continue
      }
      console.error('poll error', err && err.message ? err.message : String(err))
    }
    await sleep(120000)
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
