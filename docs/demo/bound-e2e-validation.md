# Bound Devnet E2E validation

This runbook prepares a controlled, isolated validation. The evidence command is read-only: it opens both SQLite databases in read-only mode and only calls Solana RPC read methods. It never calls the App purchase API, facilitator verification/settlement, Keychain, or a signer.

## Isolated App state

Start the App with an explicit data directory and settlement database:

```bash
APP2049_ENABLE_DEVNET_PURCHASES=1 \
APP2049_DATA_DIR="$HOME/Library/Application Support/Bound-E2E" \
DAY4_SETTLEMENT_DB="$HOME/Library/Application Support/Bound-E2E/x402-settlements.sqlite" \
npm run app:dev
```

The same `APP2049_DATA_DIR` must be supplied to the MCP process. Configure a dedicated Codex MCP server and set its tool timeout to 210 seconds, which is longer than the bridge's 180-second purchase timeout:

```toml
[mcp_servers.bound-e2e]
command = "/opt/homebrew/bin/node"
args = ["--import", "/absolute/path/to/2049/node_modules/tsx/dist/loader.mjs", "/absolute/path/to/2049/scripts/mcp.ts"]
cwd = "/absolute/path/to/2049"
tool_timeout_sec = 210

[mcp_servers.bound-e2e.env]
APP2049_DATA_DIR = "/Users/you/Library/Application Support/Bound-E2E"
```

Restart the Codex MCP connection after changing the configuration or rotating the SpendGrant connection credential.

## Read-only evidence

Set `DEMO_BUYER_PUBLIC_KEY` to the public address shown by the isolated App. These variables contain public addresses and paths only:

```bash
APP2049_ENABLE_DEVNET_PURCHASES=1 \
APP2049_DATA_DIR="$HOME/Library/Application Support/Bound-E2E" \
DAY4_SETTLEMENT_DB="$HOME/Library/Application Support/Bound-E2E/x402-settlements.sqlite" \
DEMO_BUYER_PUBLIC_KEY="<isolated App wallet public address>" \
DEMO_MERCHANT_PUBLIC_KEY="4aU7aegXejAjF84J9eu2B6boC1Exa3i6cxP3diDULJbs" \
npm run e2e:evidence -- bound-e2e-basic-20260922-01
```

Run the same command before and after replaying the identical basic request. The transaction signature, resource hash, event sequence, total quote count, total settlement count, and balances must remain unchanged. Run it with the premium request ID to prove that `amountPaid` is zero, its transaction and resource are absent, its payload-presence flag is false, its event sequence contains only the denial, and its settlement count is zero.

The command intentionally refuses default database paths. It reports no approval ID, credentials, raw payment payload, private key, or signer data.
