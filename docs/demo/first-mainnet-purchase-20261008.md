# First real Solana Mainnet x402 purchase — 2026-10-08

## Actual purchase acceptance

The user authorized exactly one purchase of BTC, ETH and SOL USD price data from the registered `agent402-crypto-price` resource, using the existing Spend Grant, for at most **0.001 USDC**. The user required stopping on any blocker or uncertain payment and prohibited a second purchase. This document records the completed purchase; it is not authorization for another transaction.

| Field | Actual evidence |
| --- | --- |
| Merchant / provider | Agent402 / `agent402.tools` |
| Request | `GET https://agent402.tools/api/crypto-price?coins=BTC%2CETH%2CSOL&currency=usd` |
| Purchase ID | `crypto-price-20261008-01a11c2e-ea3c-7862-80ae-72527467be99` |
| Network | Solana Mainnet, `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` |
| Asset | Native USDC, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, 6 decimals |
| Amount | `1000` atomic units / **0.001 USDC** |
| Recipient | `J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg` |
| Transaction signature | `5CA2dyAxJq7Q7XPxRHMD475NYwDa1AkFrQQLb5VtYqqLsni8jwwz1JAZWfMh8gCPFRKai6Fn2WjEJWJ3sfW6n9gM` |
| Execution / payment | `live_mainnet` / `PAID` |
| Receipt / delivery | `CONFIRMED` / `COMPLETE` |
| Original payment record | `CONFIRMED`, same transaction signature |
| Delivery retry count | `0` |
| Paid / delivered at | 2026-10-08 23:46:02.956 / 23:46:02.978 Asia/Shanghai |

Public transaction links: [Solana Explorer](https://explorer.solana.com/tx/5CA2dyAxJq7Q7XPxRHMD475NYwDa1AkFrQQLb5VtYqqLsni8jwwz1JAZWfMh8gCPFRKai6Fn2WjEJWJ3sfW6n9gM), [Solscan](https://solscan.io/tx/5CA2dyAxJq7Q7XPxRHMD475NYwDa1AkFrQQLb5VtYqqLsni8jwwz1JAZWfMh8gCPFRKai6Fn2WjEJWJ3sfW6n9gM).

The actual desktop Codex Yosh MCP status returned no blockers or unresolved payments and an active resource-bound Spend Grant. Its unpaid quote returned `1000` atomic USDC, `preflight.ready: true`, and `paymentSent: false`. Exactly one `request_purchase` returned `PAID`, `receiptStatus: CONFIRMED`, `deliveryStatus: COMPLETE`, and `reused: false`, together with all three requested coin records. There was no retry or second purchase in this conversation.

The read-only SQLite audit selected only the matching purchase's public transaction/status/amount fields, delivery status and retry count, original-payment status/signature, and event timestamps. It did not instantiate AppRuntime or PurchaseLedger, apply migrations, access Keychain, or call purchase/recovery services. The durable events show approval, submission, signature observation, payment confirmation and delivery completion. Stored data exists. Runtime databases, wallet state, credentials, signed payment payloads and raw logs are not included in this repository evidence.

The persisted payment proof has `source: buyer_rpc`, `confirmationStatus: confirmed`, and `settlementConfirmed: false`. The separate persisted receipt state is `CONFIRMED`; these are distinct facts and are recorded without changing either field. This audit did not independently establish finalization. A read-only `getSignatureStatuses` request to the public Mainnet RPC failed with `fetch failed`; neither explorer page nor a new RPC response was used as independent confirmation. The earlier wallet browser pages were inaccessible to the user.

## Delivered result

The merchant's JSON returned `currency: usd`, `count: 3`, and the following prices. All three merchant update timestamps were `2026-10-08T15:45:28.000Z` (23:45:28 Asia/Shanghai).

| Coin | Price (USD) | 24-hour change |
| --- | ---: | ---: |
| BTC / bitcoin | 81127 | -2.6138% |
| ETH / ethereum | 2447.84 | -4.572% |
| SOL / solana | 108.92 | -6.5613% |

This proves this one GET purchase and its initial delivery. Merchant recovery remains registered as `none`; no paid recovery, lost-response recovery, real POST purchase or additional purchase was exercised.

## Post-freeze preservation checks

Baseline: `e7ef99e8029509355f105edd8013606a05934aaf`. Completed changes comprise generic Agent-bound discovery/registration, additive registry metadata, stable MCP connection identity across Spend Grant creation/replacement/revocation, existing native projections/sample input, and their regression tests. The payment, Authority and purchase/recovery core directories have no diff from that frozen baseline. Grant checks, budgets and the single official x402 pipeline remain in place.

Current checks during commit preparation: **77 test files / 941 tests passed**, `npm run typecheck`, `npm run lint`, `npm run build`, isolated Swift Agent resource decoder/sample compatibility test, and syntax check of the installed registration acceptance script. Installed App strict deep signature verification and recursive comparison with the existing Release app passed. No new native full build, installation, restart, Grant creation, resource registration, payment or recovery was performed in this preservation task. The opt-in installed registration script was inspected and syntax-checked, not executed, because its historical no-Grant precondition no longer holds.

Earlier native Debug/Release and installed registration/host evidence remains dated separately in [Agent MCP registration](../architecture/resources/agent-mcp-registration.md). It is not presented as a fresh run. Git commits contain source, tests and bounded documentation only; local runtime state stays outside Git. Final signed commit IDs and local/remote synchronization are reported after push.
