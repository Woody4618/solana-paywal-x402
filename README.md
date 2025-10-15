# solana-paywall

This example shows how to use ACK-Pay with a Next.js app.
It uses x402 to pay for paywalled content on Solana.
It contains three examples:

- Pay to view a full res Image.
- Pay to animate an image using fal.ai api in the backend. (Costs actual money since the API is not free.)
- A twitter bot that pays to animate an image when mentioned on the X timeline.

You can try it out live here: 
https://solana-paywal.vercel.app/images

#### Install Dependencies

```shell
pnpm install
```

#### Commands

## Environment Setup (.env.local)

Use the setup scripts to populate required env vars for ACK and Solana.

### 1) Base setup

```bash
pnpm setup
```

This creates/updates `.env.local` with sensible defaults:

- `JWT_SECRET` (random 32-byte hex)
- `SERVER_PRIVATE_KEY_HEX` (ACK PaymentRequest issuer)
- `RECEIPT_SERVICE_PRIVATE_KEY_HEX` (ACK Receipt issuer)
- `SOLANA_RPC_URL`, `SOLANA_USDC_MINT`, `SOLANA_COMMITMENT`
- leaves `SOLANA_RECIPIENT` empty

### 2) Generate a Solana keypair and fill recipient

```bash
pnpm run gen:solana-keypair
```

This prints a new Solana keypair and updates `.env.local` non-destructively with:

- `SOLANA_RECIPIENT` (public key)
- Also prints JSON/base58 secret for your own backup (not required by the app)

You can also output JSON for tooling:

```bash
node bin/gen-solana-keypair.mjs --json
```

### Run the app

```bash
# from the repo root
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Payment flow (ACK-Pay, no Memo)

- The server returns 402 with a signed ACK PaymentRequest (JWT) and `paymentOptions`.
- The client selects a Solana option, performs a USDC transfer to `SOLANA_RECIPIENT`.
- The client requests a receipt with `{ signature, paymentRequestToken, paymentOptionId }`.
- The server verifies:
  - PaymentRequestToken signature/expiry
  - The specific option (network, recipient, decimals, amount)
  - On-chain tx: credited recipient ATA for the mint, correct delta, no errors
  - Payer DID from fee payer and CAIP-2 network
- The server issues a Receipt VC and a short-lived access token; the client proceeds with the protected action (e.g., animation start).

To run the twitter bot, you need to set up a twitter developer account and get the following env variables:

- `TWITTER_CLIENT_ID`
- `TWITTER_CLIENT_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_TOKEN_SECRET`

Note the twitter api is pretty expensive so maybe you find a cheaper way of calling it by scraping but i always got blocked by cloudflare so i just paid for the api at some point. :(

More infos on the twitter bot in the [twitter-bot](twitter-bot) folder.

Then run the bot with:

```shell
bun src/twitter-replies.ts
```
