# You.com Web Search production registration

Scope: register the first external production API and repair read-only resource discovery. No real purchase, transaction, Spend Grant, unpause or Mainnet execution enablement is authorized by this change.

## Registration

The installation uses its existing `YOSH_MAINNET_RESOURCES` configuration in the private `.env.local`, preserved across App restarts. No credentials or payment requirements are in repository configuration.

| Field | Value |
| --- | --- |
| Resource ID | `you-web-search` |
| Provider | `you.com` |
| Display name | You.com Web Search |
| Allowed URL | `https://api.you.com/v1/search` |
| HTTP method | GET |
| Network | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Asset | Native USDC, `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals |
| Base / maximum | `5000` / `5000` atomic units (0.005 USDC) |
| Recipient | Derived from live challenge |
| Delivery recovery | None; no replay capability is assumed |

The official [You.com x402 documentation](https://you.com/docs/administration/machine-payments/x402) documents GET Search, multiple network options, 600-second challenges and changing recipients/fee payers. An unsigned GET from this Mac returned HTTP 402 with matching Solana USDC terms and `amount: "5000"`. No payment header was sent and no payment retry followed. The live recipient and fee payer were not copied into configuration.

## Shared architecture and boundaries

`loadRegisteredResources` validates the existing declarative registration independently of wallets, facilitator configuration and execution permission. The App overview's Registered API selector and authenticated Agent status/quote reads use the same registration projection. Metadata includes the display name, method, asset, and backend-formatted price boundaries.

A `recipientSource: "live_challenge"` registration requires an explicit positive maximum amount and prohibits a configured recipient or fixed transaction amount. Existing fixed-recipient registrations remain supported. The challenge adapter decodes through the locked official x402 SDK, selects exactly one matching `exact` network/asset option, validates its address, fee payer, amount, method, endpoint and bounded timeout, and persists that selected option with the original resource/extension metadata. Duplicate matching options, other asset/network, redirects, malformed terms and over-cap prices fail closed. No provider-specific payment-kernel branch was added.

Only the user's authenticated Create Spend Grant action fetches a fresh challenge and binds the resulting payee into the existing Grant scope. It can run while Payments are paused and Mainnet execution is disabled. Challenge failure cannot rotate credentials or create a Grant; a connection change during discovery aborts creation. The configured registration and execution scope are rechecked after the asynchronous read. A future changed recipient fails the existing Grant/payee comparison and requires new user authorization. Signature/submission, atomic reservation and original-payment recovery retain the existing shared pipeline.

The query failure previously flowed from missing production configuration or a rejected/upstream challenge into a generic HTTP 503, then MCP translated every non-OK response to `APP_UNAVAILABLE`. Mainnet quote discovery now returns the registration list even when individual live quotes are unavailable, using `RESOURCE_QUOTE_UNAVAILABLE` without raw upstream details. The stdio bridge distinguishes authenticated backend read failure (`AGENT_READ_FAILED`) and revoked authentication (`AGENT_UNAUTHORIZED`) from unreachable transport. Authentication checks and captured-session credential rules are unchanged.

## Verification

- Failure reproduced before implementation: new recipient policy rejected; quote failure returned HTTP 503 instead of readable registration.
- Full backend regression: 60 files / 724 tests passed. Final targeted additions and affected suites: 6 files / 77 tests passed, including immutable production binding and Grant recipient changes, asynchronous revocation, shared list reads, disabled/paused reads, and shipped stdio authentication/error handling.
- Typecheck, lint and macOS Debug build passed. Native Spend Grant fixture passed before the user's instruction to stop Computer Use; no subsequent Computer Use is performed.
- Native command-line model/transport tests also passed, including nullable live-challenge recipient and exact Registered API metadata decoding. Automated fixture Grants/signatures are isolated mock tests, not real wallet actions.
- 2026-10-07 installation: old backend PID 13359 exited through authenticated graceful shutdown (status 143). `scripts/install-macos-app.sh` passed Next production and macOS Release builds and installed `/Users/irin/Applications/Yosh.app`; strict signature verification and recursive bundle comparison passed. App PID 16631 runs from that installed path. Purchase rows before/after installation are unchanged at 14.
- Post-unlock: backend PID 16690 is ready and listening on `127.0.0.1:3049`. The installed App’s HMAC-authenticated overview response (including response-proof verification) returns You.com Web Search, GET, the registered HTTPS URL, Mainnet native USDC, `baseAmount: "5000"`, `maximumAmount: "5000"`, and `recipient: null`. It reports `productionExecutionEnabled: false`, `paused: true`, Grant null, Paid/Reserved zero and the unchanged Mainnet wallet identity.
- Actual desktop Codex MCP verification is pending reconnect: the previous host session reports `Transport closed`, and the restarted backend intentionally invalidated the old Agent credential. This is distinct from the repaired production registration/quote-read failure; no post-restart host success is claimed yet. No Computer Use was performed after the user prohibited it.

Payments must remain paused, Mainnet execution disabled, and the real user's Spend Grant absent after installation. The user can then select Authority → Spend Grant → Registered API → You.com Web Search and manually enter total 0.01 USDC, per transaction 0.005 USDC, and expiration. This stage does not implement Agent-provided search-query parameters or authorize an actual Web Search purchase.
