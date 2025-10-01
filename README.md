# solana-paywall

This is a Next.js app containing:

- Tailwind CSS setup for styling
- Useful wallet UI elements setup using [@solana/web3.js](https://www.npmjs.com/package/@solana/web3.js)
- A basic Counter Solana program written in Anchor

## Getting Started

### Installation

#### Download the template

```shell
download pnpm create solana-dapp@latest -t gh:solana-foundation/templates/web3js/solana-paywall
```

#### Install Dependencies

```shell
pnpm install
```

## Apps

### anchor

This is a Solana program written in Rust using the Anchor framework.

#### Commands

You can use any normal anchor commands. Either move to the `anchor` directory and run the `anchor` command or prefix the
command with `pnpm`, eg: `pnpm anchor`.

#### Sync the program id:

Running this command will create a new keypair in the `anchor/target/deploy` directory and save the address to the
Anchor config file and update the `declare_id!` macro in the `./src/lib.rs` file of the program.

You will manually need to update the constant in `anchor/lib/counter-exports.ts` to match the new program id.

```shell
pnpm anchor keys sync
```

#### Build the program:

```shell
pnpm anchor-build
```

#### Start the test validator with the program deployed:

```shell
pnpm anchor-localnet
```

#### Run the tests

```shell
pnpm anchor-test
```

#### Deploy to Devnet

```shell
pnpm anchor deploy --provider.cluster devnet
```

### web

This is a React app that uses the Anchor generated client to interact with the Solana program.

#### Commands

Start the web app

```shell
pnpm dev
```

Build the web app

```shell
pnpm build
```

---

## Environment Setup (.env.local)

Create `examples/solana-paywall/.env.local` with the following variables:

```ini
# HMAC secret for signing/verifying JWTs (paymentRequestToken, accessToken)
JWT_SECRET=your_hex_secret

# Solana config (devnet)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
SOLANA_COMMITMENT=confirmed

# Recipient public key (Solana address) to receive USDC payments
SOLANA_RECIPIENT=your_solana_address

# ACK-Pay identities for the example
SERVER_PRIVATE_KEY_HEX=secp256k1_private_key_hex
RECEIPT_SERVICE_PRIVATE_KEY_HEX=secp256k1_private_key_hex
```

### Quick setup script

Run this to generate `.env.local` with sane defaults (you only need to paste your devnet recipient address afterward):

```bash
pnpm setup
```

The script writes:

- `JWT_SECRET`, `SERVER_PRIVATE_KEY_HEX`, `RECEIPT_SERVICE_PRIVATE_KEY_HEX` (random 32-byte hex)
- `SOLANA_RPC_URL`, `SOLANA_USDC_MINT`, `SOLANA_COMMITMENT`
- Leaves `SOLANA_RECIPIENT` empty for you to fill in with your devnet address

After editing `.env.local`, restart the dev server for changes to take effect.

### Run the example

```bash
# from the repo root
cd examples/solana-paywall
pnpm install
pnpm setup     # generates .env.local (fill in SOLANA_RECIPIENT)
pnpm dev
```

Open `http://localhost:3000` to view the paywall gallery.
