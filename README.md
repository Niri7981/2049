# Yosh

> Give your agent a card, not your wallet.

**Yosh lets AI agents make real payments without giving them access to your private keys.**

Yosh is a native macOS app and an economic authority layer between agents and payment infrastructure. Agents request purchases; users set permissions and budgets; a local backend authorizes and signs supported x402 payments.

## The problem

Agents increasingly need to buy API access, data, and services to complete their work. Unrestricted wallet access gives them too much authority. Manually approving every individual payment makes useful automation difficult.

Yosh separates the ability to request a purchase from the authority to spend. A user can authorize a specific Agent to use a specific API within explicit limits, while retaining control of the wallet.

## How Yosh works

1. **Discover.** The Agent finds an x402 API and inspects its unpaid challenge with `discover_x402_resource`.
2. **Register.** It calls `register_x402_resource` with Yosh's validated discovery record. The API appears in the app for review; registration grants no spending permission.
3. **Authorize.** The user creates a **Spend Grant** for that Agent and Resource, setting a total amount, per-transaction limit, and expiration. Sample inputs provide quotes for dynamic resources.
4. **Request.** The Agent calls `request_purchase` with the Resource, permitted inputs, purpose, and stable request ID.
5. **Check.** Yosh validates the fresh quote, checks permissions and budget, atomically reserves the amount, and rechecks authorization before signing.
6. **Pay.** The official x402 SDK handles the supported payment flow, using Yosh's local signer and the merchant's settlement infrastructure.
7. **Deliver.** The Agent receives the result; stored content is also available through `get_purchase_delivery`.
8. **Record.** Yosh records payment and delivery separately: payment confirmation alone does not prove delivery.

JSON POST discovery requires separate native user confirmation of the exact outbound request before it is sent. An Agent cannot supply that approval itself.

## Core capabilities

- **Scoped Spend Grants:** revocable spending authority for a specific Agent and Resource.
- **Daily Authority:** shared daily limits across Agents and Resources, covering paid and reserved amounts, with a pause control.
- **Resource Registry:** persistent API definitions with validated fixed or dynamic GET/JSON POST inputs.
- **Local custody:** Solana wallet secrets in macOS Keychain; signing inside the backend.
- **Durable tracking:** idempotent purchases, separate payment/delivery records, and recovery of the original purchase.
- **Native visibility:** API review, permission management, and purchase outcomes.

## Architecture

The native app provides user-controlled permissions and transaction visibility. The bundled backend keeps wallet custody, policy, and signing independent of the Agent. App and MCP requests share the same business logic.

| Component | Responsibility |
| --- | --- |
| Native macOS App | User review, permissions, budgets, and transaction visibility. |
| Bundled local backend | Authenticated channels, purchase orchestration, and supervised runtime, including Node. |
| MCP integration | A restricted stdio bridge for discovery, registration, quotes, purchase requests, and delivery retrieval. |
| Resource Registry | API identity, request constraints, samples, and delivery declarations. |
| Economic Authority / Spend Grants | Bind an Agent's permission to a Resource and its economic scope. |
| Daily Authority | Enforce shared daily limits and pause across active Grants. |
| Solana wallet and signing boundary | Verify and use the expected Keychain wallet inside the backend; isolate Mainnet and test wallets. |
| Official x402 SDK | Supported x402 V2 protocol and `exact` payment construction. |
| SQLite ledger | Atomic reservations, idempotency, payment/delivery state, and durable recovery progress. |

Policies and records persist locally across restarts. The installed bundle runs without the source checkout, a separately installed Node runtime, or a developer `.env.local`.

## Getting started

### Download / Installation

**Public DMG distribution has not yet been verified.** A download link will be added here after release packaging, signing, notarization, and installation are verified.

For now, developers can build a local installation from source.

### Build from source

Requirements: **macOS 15 or later**, **Node.js 24.5 or later**, npm, and Xcode with macOS build tools.

From the repository root:

```sh
npm ci
./scripts/install-macos-app.sh
```

The script installs `~/Applications/Yosh.app` with its backend, Node runtime, and MCP bridge. Launch it from Finder or Spotlight. Before rebuilding, quit Yosh normally and wait for its backend to stop.

Local builds use ad hoc signing by default. macOS may request Keychain access confirmation; complete it through the system prompt.

### Connect an Agent

The verified host is **Codex**. Configure MCP through Yosh's Connection control, then start or reconnect a Codex session to load the tools.

Purchases require an available Mainnet wallet, enabled execution, an active Agent connection, Daily Authority, and a matching Spend Grant. Fresh configuration starts with execution disabled. Startup does **not** create a Mainnet wallet; provisioning remains a developer setup requirement.

Have the Agent discover and register a Resource, review it, then create its Grant. See the [runtime guide](docs/architecture/product-startup-runtime.md), [payment configuration](docs/architecture/payment-product-configuration.md), and [MCP registration guide](docs/architecture/resources/agent-mcp-registration.md) for integration details.

## Supported capabilities and limitations

| Area | Current scope |
| --- | --- |
| Protocol and payment | x402 V2, Solana Mainnet, native USDC, supported `exact` flow. Other networks, assets, and schemes are outside the current scope. |
| HTTP resources | Static/parameterized GET and fixed/parameterized JSON POST with constrained inputs and POST consent. GET has live purchase evidence; POST has automated coverage, without a recorded real Mainnet purchase. |
| Delivery | Bounded JSON and declared text, including HTTP 200/201. No arbitrary media or streaming. |
| Agent compatibility | Actual Codex MCP host verified; other hosts await validation. |
| Recovery | Original-payment recovery and bounded delivery retries implemented and tested. Replay requires explicit merchant support; live recovery has not been verified. |

Discovery inspects candidate endpoints, rather than searching the web or operating an API marketplace. Refunds are unsupported. Wallet onboarding and public distribution are not yet a complete consumer installation flow.

## Security model

- **Local keys:** Keychain secrets are used by the backend signer. The frontend and MCP expose neither private-key export nor arbitrary signing.
- **Separate authority:** authenticated Agent access confers no management privileges or permission to approve its own purchases.
- **Backend policy:** missing, expired, revoked, or out-of-scope Grants, pause, insufficient budget, and invalid quotes block new payments. Amounts use integer asset units.
- **Stable purchase identity:** atomic reservations and execution claims guard against duplicate execution. Unknown outcomes retain reservations and original evidence; delivery recovery reuses original payment credentials without creating another payment.
- **Untrusted APIs:** validated requests enforce HTTPS, network-target, redirect, timeout, and response-size restrictions.

Local custody does not eliminate host compromise or merchant risk. Yosh records uncertain outcomes and cannot guarantee third-party delivery or recovery.

## Demo and links

On **October 8, 2026**, an actual desktop Codex MCP session bought BTC, ETH, and SOL price data from Agent402 for **0.001 native USDC on Solana Mainnet**. The project record documents `PAID`, a `CONFIRMED` receipt, `COMPLETE` delivery, and the same transaction in the original-payment record.

Read the [purchase and delivery evidence](docs/demo/first-mainnet-purchase-20261008.md) and its recorded [Solana Explorer transaction](https://explorer.solana.com/tx/5CA2dyAxJq7Q7XPxRHMD475NYwDa1AkFrQQLb5VtYqqLsni8jwwz1JAZWfMh8gCPFRKai6Fn2WjEJWJ3sfW6n9gM). This verifies one GET purchase and initial delivery. It is not evidence of a real POST purchase, merchant recovery, or independently audited finalization.

Further reading: [documentation index](docs/README.md), [architecture](docs/architecture/README.md), and [resource lifecycle](docs/architecture/resources/agent-purchase-lifecycle.md).

## Roadmap

The following are future directions, not released capabilities:

- Verify signed, notarized DMG distribution and improve first-time wallet onboarding.
- Validate more Agent hosts and MCP integrations.
- Expand reproducible merchant compatibility tests, including live JSON POST and recovery scenarios.
- Explore economic authority for tokenized real-world assets (**RWA**). Yosh currently supports API purchases, not RWA custody, trading, or settlement.

Collaborators working on Agent integrations, merchant compatibility, and local security boundaries are welcome.
