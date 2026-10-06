# Guarded Mainnet product entry

2026-10-06. Scope: connect the existing guarded executor to the real App management API and registered-member MCP purchase flow. No real Mainnet purchase, wallet creation, funding, paid merchant call, UI redesign, commit or publication is part of this step.

## Product flow

The shipped `scripts/mcp.ts` bridge still exposes only `requestId`, `resourceId` and `reason` for `request_purchase`. Its official MCP SDK schema and the HTTP schema reject extra payment facts. The bridge sends the member's scoped connection capability to the existing `/api/agent/purchases` handler. That handler authenticates the member before parsing or executing a purchase.

`AppRuntime.requestPurchase` now accepts the explicitly selected Mainnet environment. `requestPaidResourcePurchase` delegates its Mainnet requests to `requestRegisteredResourcePurchase`, which obtains the registered resource's fresh challenge and uses the existing `createX402SpendIntent → ledger.reserve → executeApprovedPayment` chain. Claim, SDK policy, Keychain signer, preflight, unsigned transaction validation, simulation, sign, persisted original-payment identity, submission and reconciliation remain the existing guarded pipeline. No new signing or settlement implementation exists.

Registration supplies the HTTPS request, provider, network, mint, decimals and recipient. PaymentEnvironment supplies the production environment and its pinned asset/network identity. The validated merchant challenge supplies the actual price under that registration. Agents cannot select payment terms, wallet sources or signer capabilities.

The read-only quote tool lists backend registrations in the selected environment; the status tool reports the actual backend execution flag. Payment responses use safe summaries and delivered resource data, never the saved payment credential, private keys or signing APIs. Failure wording preserves uncertainty rather than falsely claiming that no payment happened.

## Native App plumbing

The existing signed management routes continue to own daily limit and pause changes. Their scope is the backend's selected environment. The existing grant routes accept one additional optional `resourceId`: mandatory for Mainnet, resolved exclusively against backend registrations. Missing/unknown IDs reject before credential rotation. Mainnet grants have the exact API/provider/recipient/native USDC/network scope; test grants keep their existing behavior.

The App decodes `live_mainnet`, the explicit execution-enabled state and the safe registration list. Its existing SpendGrant editor adds a native API Picker and scope facts, and submits the chosen ID through the same management transport. Daily Authority already supports Mainnet units. Mainnet history now decodes and displays its actual mode; a disabled production execution flag appears as Disabled. No navigation or visual redesign was added.

Startup loads an already provisioned, distinct Mainnet Keychain wallet and verifies the configured public identity. It cannot create a Mainnet wallet and does not write a Demo buyer setting. Switching into/out of Mainnet or changing the selected Mainnet PaymentEnvironment requires restarting Yosh; an existing test session is never reinterpreted as production. Existing simulated/Devnet mode behavior stays compatible.

Wallet balance remains a best-effort read in the selected environment, separate from local authority; amounts are displayed using integers, and RPC bodies are bounded. Balance data is never authorization or payment proof.

## Safety and recovery

- `YOSH_ENABLE_MAINNET_EXECUTION` stays absent/off by default; specifying `live_mainnet` is insufficient.
- Authentication requires a current capability for an active registered CardMember. Credential rotation/revocation and restart still invalidate old connections.
- Mainnet daily authority, unpaused state and a current exact Mainnet SpendGrant remain required. Devnet/simulated controls and grants cannot authorize Mainnet.
- Existing monetary scope, atomic reserve/claim, execution binding, independently verified signer, mainnet genesis/mint/ATA/sponsor preflight, transaction validation and simulation remain mandatory at their original boundaries.
- The native test purchase entry rejects Mainnet before test defaults, recovery startup or wallet initialization. The legacy demo worker and test-resource services retain their restrictions. No production debug endpoint or signing fixture was added.
- A stable member/request ID owns one purchase. Concurrent quote completion checks the persisted winner; changed request intent rejects. Replay returns/reconciles the original record and never signs a replacement payment.
- Recovery uses the saved immutable request endpoint, even after resource registration changes. Disabling Mainnet, pausing, revoking a grant or restarting does not erase unknown payment evidence or release its reservation. Confirmed original payments can recover delivery without new authorization or signatures.

## Files changed in this step

Backend/product entry:

- `src/modules/app/app-runtime.ts`
- `src/modules/app/authority-overview.ts`
- `src/modules/app/wallet-balance.ts`
- `src/modules/mcp/server.ts`
- `src/modules/purchases/request-paid-resource-purchase.ts`
- `src/modules/purchases/request-registered-resource-purchase.ts`
- `src/modules/payment/read-payment-json.ts`
- `src/app/api/agent/purchases/route.ts`
- `src/app/api/agent/route.ts`
- `src/app/api/app/grant/route.ts`
- `src/app/api/app/members/[memberId]/grant/route.ts`

Native projections and existing grant transport/editor:

- `apps/macos/Yosh/YoshApp/Models/AppOverview.swift`
- `apps/macos/Yosh/YoshApp/Models/AuthorityOverviewPresentation.swift`
- `apps/macos/Yosh/YoshApp/Models/ActivityLedgerPresentation.swift`
- `apps/macos/Yosh/YoshApp/Models/PurchasePresentation.swift`
- `apps/macos/Yosh/YoshApp/Models/PurchaseDetailPresentation.swift`
- `apps/macos/Yosh/YoshApp/Services/ManagementTransport.swift`
- `apps/macos/Yosh/YoshApp/Services/OverviewClient.swift`
- `apps/macos/Yosh/YoshApp/Views/Card/BackOverview.swift`
- `apps/macos/Yosh/YoshApp/Views/Card/SpendGrantDetail.swift`

Verification/documentation:

- `tests/unit/mainnet-product-entry.test.ts` (new)
- `tests/unit/mainnet-execution.test.ts`
- `tests/unit/app-management.test.ts`
- `tests/unit/agent-status-route.test.ts`
- `tests/unit/mcp-connection.test.ts`
- `tests/unit/paid-resource-purchase.test.ts`
- `tests/unit/payment-environment.test.ts`
- `tests/integration/mcp-purchase-intent-lifecycle.test.ts`
- `apps/macos/Yosh/tests/main.swift`
- `apps/macos/Yosh/tests/SpendGrantViewTest.swift`
- `vitest.config.ts` (resolve the same `@` paths as production; existing route mocks retain real exports)
- `plan.md`
- `docs/architecture/mainnet-readiness/conditional-mainnet-execution.md` (link to the subsequent entry step)
- `docs/architecture/mainnet-readiness/mainnet-product-entry.md` (this report)

Prior readiness changes already present in the working tree are preserved and are not claimed as new work in this step.

## Verification

Current automated checks: 54 backend test files / 679 tests pass, including 14 product-entry cases. Typecheck and lint pass. Native model/management projections, SpendGrant view, tab/navigation/scroll, detail/Authority/purchase/activity/member and connection fact/motion/confirmation regression scripts pass. An initial concurrent compiler run caused a Vitest worker startup timeout; the isolated rerun passed without unhandled errors. Backend `npm run build` and native macOS Release build both pass through `scripts/install-macos-app.sh`. Existing nonblocking MCP dynamic file-tracing warnings and Xcode CoreDevice/simulator version warnings remain; macOS build reports `BUILD SUCCEEDED`.

Old installed App PID 58635 requested graceful shutdown of backend PID 58739; current OS lifecycle logs record its exit at 13:53:01. The installer updated `/Users/irin/Applications/Yosh.app`; a full bundle comparison with this Release output is identical, and strict codesign verification passes.

Reopened App PID 62091 runs from `/Users/irin/Applications/Yosh.app/Contents/MacOS/Yosh`. Its child backend PID 62115 listens only on `127.0.0.1:3049`; current lifecycle logs record Backend ready at 13:59:15. The native UI shows Not Connected and Test environment / Solana Devnet. The Mainnet production flag is absent from the unchanged local configuration. The existing red window button hides the App; backend PID/listener remain alive afterward. No payment authority was issued through the installed App.

Unauthenticated management health returns HTTP 401. `.next/static` contains none of the checked signer functions, Mainnet Keychain identifiers or Mainnet resource/wallet configuration names. `git diff --check` passes. After Release, the product-entry suite passes again (14 cases), including rejection of injected amount/network fields by the shipped stdio MCP SDK tool schema. Product-entry tests use ephemeral fixture keys, mocked Keychain/payment preparation and mocked RPC/merchant calls, plus the real AppRuntime, management authentication, ledger, executor, HTTP handlers, official MCP negotiation and shipped stdio bridge. The codex provider fixture verifies actual ping/session registration and stale credential rejection. Existing Mainnet signing/official SDK tests separately exercise the guarded SDK/signing path.

The currently available desktop Codex MCP connection returned `APP_UNAVAILABLE`; the installed product remains disconnected. A stdio fixture is transport evidence, not a claim of a live desktop Mainnet purchase. No existing Codex configuration or live connection credential was replaced for testing.

## Blockers before real-money acceptance

1. Specific human authorization naming the API/recipient, purpose and spending cap.
2. Explicit, separately provisioned Mainnet Keychain wallet and audited public identity; production registration/facilitator/RPC configuration without Demo settings, adequate funds/token accounts and sponsorship.
3. Explicit Mainnet daily authority, exact member/API grant, resume and production flag; reconnect the actual Codex host after grant/credential changes.
4. Actual-host end-to-end acceptance and confirmation of the real provider/facilitator's supported Mainnet settlement and original-payment/delivery recovery behavior. Fixtures do not establish online availability.

Stop at this entry step. Real Mainnet payment remains unperformed and unauthorized.
