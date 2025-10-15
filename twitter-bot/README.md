# x402 Twitter Bot

Listens for mentions to the bot account, extracts an image/media URL, pays for an x402 animation on Solana, polls for completion, and replies to the mention with the resulting video.

## Requirements

- Node.js 18+
- Twitter API access with user context (OAuth 1.0a) and permission to post media
- A Solana keypair for the payer (Devnet by default)
- The x402 Next.js app/API running locally or deployed (`ANIMATE_API_BASE`)

## Environment variables

Set these in a `.env` file in this directory or in your process environment.

- `TWITTER_APP_KEY` (required): Twitter app key (consumer key)
- `TWITTER_APP_SECRET` (required): Twitter app secret (consumer secret)
- `TWITTER_ACCESS_TOKEN` (required): User access token (OAuth 1.0a)
- `TWITTER_ACCESS_SECRET` (required): User access token secret (OAuth 1.0a)
- `TWITTER_BEARER_TOKEN` (optional): App bearer token for read-only requests; if omitted, user tokens are used for reads
- `AGENT_SOLANA_WALLET` (required): The payer wallet secret key as JSON array or comma-separated bytes
  - Example JSON: `[12,34,56,...]`
- `ANIMATE_API_BASE` (recommended): Base URL of the x402 API (defaults to `http://localhost:3000`)
- `SOLANA_RPC_URL` (optional): Solana RPC endpoint (defaults to Devnet via `clusterApiUrl('devnet')`)
- `TWITTER_USERNAME` Twitter username of the bot account

### Sample .env

```bash
TWITTER_APP_KEY=your_app_key
TWITTER_APP_SECRET=your_app_secret
TWITTER_ACCESS_TOKEN=your_user_access_token
TWITTER_ACCESS_SECRET=your_user_access_secret
TWITTER_BEARER_TOKEN=your_bearer_token

# Payer secret key (JSON array or CSV of bytes)
AGENT_SOLANA_WALLET=[1,2,3,4,5, ...]

# x402 API base (Next.js app)
ANIMATE_API_BASE=http://localhost:3000

# Optional: override Solana RPC (defaults to devnet)
# SOLANA_RPC_URL=https://api.devnet.solana.com
```

## Install and run (local)

```bash
cd twitter-bot
npm install
```

This runs:

```bash
bun src/twitter-replies.ts
```

Notes:

- Ensure your x402 app/API is running and reachable at `ANIMATE_API_BASE`.
- The bot polls mentions continuously and maintains an in-memory set of processed tweet IDs for the current process.

## Deployment notes

This bot is a long-running process (infinite polling loop) and writes temporary files when uploading media. Prefer a worker or container platform:

- Render (Background Worker), Railway, Fly.io, Heroku, DO App Platform, or a VM
- Start command: `npm start`

Vercel serverless functions are time-limited and stateless, so this exact long-running bot is not a good fit. To adapt for Vercel Cron, you would refactor to a one-shot handler, use external storage (KV/Redis/Postgres) for `sinceId`/state, and avoid persistent loops/disk writes.

## Troubleshooting

- Missing OAuth variables: the process will exit with an error message.
- `AGENT_SOLANA_WALLET parse failed`: ensure the secret key is a valid JSON array or CSV of bytes.
- Got HTTP status other than 402 from `/api/animate/request`: verify `ANIMATE_API_BASE` and that the API is correctly configured for x402.
- Media upload to X fails: the bot will fall back to replying with a link to the result.
