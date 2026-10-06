# P0 step 3: ledger monetary scope and integer money

Implemented scope only: durable monetary accounting and integer amounts. Mainnet execution and authority issuance remain disabled. No merchant integration, recovery redesign, UI redesign or real payment is included.

## Immutable monetary facts

Each purchase references an immutable `monetary_scopes` row identified by a hash of environment, wallet identity, network, asset/mint and decimals. Environments are `simulated`, `live_devnet`, `live_mainnet`, plus the historical quarantine `legacy_test`. The purchase amount, monetary scope and execution mode cannot be changed by SQL updates. SQLite foreign keys enforce scope references.

Managed App scopes identify the fixed backend Keychain item: test `keychain:com.2049.wallet.v1:consumer-wallet-v1`, Mainnet `keychain:com.yosh.wallet.mainnet.v1:consumer-wallet-mainnet-v1`. Mainnet rejects test wallet identities and requires Mainnet network/mint. The existing signer boundary still proves the actual public key against the execution configuration; scope metadata does not authorize signing. Standalone purchase services scope new requests by configured buyer address. Historical standalone rows whose signer identity cannot be proved use `legacy:test-wallet-unverified`; migration never guesses a production wallet or rewrites transaction history.

Daily controls, the anti-clock-rollback budget window, paid, reserved, remaining and SpendGrant commitment calculations all use monetary scope. Agents in the same scope share daily budget. Switching test mode, wallet or asset selects a different scope. Idempotency still uses the original request/member binding; replay with a different monetary scope fails instead of producing another payment.

Unresolved `PAYING`/`PAYMENT_UNKNOWN` records remain reserved across day boundaries. PAID records remain paid even without delivery. Grant commitment includes APPROVED, PAYING, PAYMENT_UNKNOWN and PAID across the grant lifetime. Expiring an unclaimed approval retains the existing release semantics. Mainnet summaries can read separately stored accounting, but Mainnet controls always return paused/no daily authority and grant queries cannot grant Mainnet spending. Reserve, claim/sign and the payment configuration retain their execution blockers. Startup cleanup does not release Mainnet claims.

## Exact monetary values

`atomic-money.ts` parses canonical unsigned decimal strings into bigint. Individual amounts and checked aggregate sums are bounded to `0..9223372036854775807`, purchases/grants require positive values. Negative, fractional, exponent, leading-zero, unsafe JS-number and out-of-range inputs fail closed. SQLite stores authoritative values as canonical TEXT with range/digit checks; it never performs a floating-point or overflowing SQL SUM. Bigint arithmetic is converted to decimal strings before persistence/JSON.

Safe integer numbers remain accepted solely as a compatibility input for historical JSON and existing callers, then immediately normalize to strings. New intents, decisions, grant amounts and monetary API outputs use strings. Resource expected prices and external quotes are validated by the same amount boundary. The existing UI/USDC presentation conversions remain presentation-only; they do not feed authorization or accounting.

## Migration 006_monetary_scope

Migration copies purchases and grants inside a SQLite BEGIN IMMEDIATE transaction, validates atomic values and scope facts, rebuilds money columns as TEXT, adds scope references/indexes/immutability triggers and records an explicit migration version. On error it rolls back 006 and refuses startup with a sanitized migration error. Earlier existing member-identity migrations retain their own historical behavior.

Purchase IDs, request IDs, approval IDs, member ownership, status, confirmed day, transaction IDs, raw purchase/quote/decision JSON, signed payloads, delivery and payment evidence remain intact. Legacy amount reads use CAST AS TEXT, avoiding the SQLite driver's unsafe-number conversion. Historical JSON is not rewritten; its parser produces canonical strings when read. Legacy records marked simulated or live_devnet retain that classification. Missing execution mode stays UNKNOWN/legacy_test and never counts as live or Mainnet evidence. Mainnet-labelled or incompatible Mainnet legacy facts, invalid amounts and contradictory stored amounts require review rather than silent conversion.

A legacy grant with purchases in exactly one scope keeps that scope and consumption. Unused or mixed-mode grants remain in legacy_test. A mixed legacy grant's diagnostic commitment still counts all linked test purchases with the same wallet/network/asset/decimals, preserving its consumed amount; it cannot authorize either live test mode or Mainnet. Grant IDs, versions, limits, status, events and original connection/member bindings remain preserved.

The old shared daily setting and its budget clock are copied once into explicit legacy_test, simulated and Devnet test scopes. This preserves the prior test configuration without authorizing Mainnet. Later edits and spending affect only the selected scope. Ambiguous active legacy reservations or same-window paid amounts block new spending in a different scope with `LEGACY_MONETARY_SCOPE_UNRESOLVED`; original evidence is retained for review. This conservative guard remains for history with missing environment/signer provenance, not because the schema lacks monetary scope.

## Current verification

- Full regression: 88 files, 846 tests passed; typecheck and lint passed.
- Focused monetary tests cover environment/wallet/asset isolation, shared budget, scope replay rejection, Mainnet blocked execution, unknown reservations, migration/restart, mixed grant history, unsafe amounts, 64-bit bounds, checked aggregate overflow, exact >2^53 amounts and JSON/API strings.
- A restricted consistent backup of the installed ledger migrated and reopened successfully. All 14 purchases and 8 grants retained their original historical facts, payloads and evidence (hash comparison, no sensitive contents logged).
- Backend production build and native macOS Release build passed. The final installed `/Users/irin/Applications/Yosh.app` matches the built bundle and passed codesign verification. After normal quit/reinstall/reopen and system Keychain confirmation, its backend reported ready, bound only to 127.0.0.1:3049, and rejected unauthenticated health access with HTTP 401. Installed database integrity/foreign-key checks passed; all 14 purchases and 8 grants remain intact. No payment was used for verification. Frontend static bundles contained no tested signer/private-key identifiers. Existing build-tool tracing/device-support warnings remain non-blocking.

## Files changed in step 3

Backend and contract files:

- `src/modules/authority/atomic-money.ts` (new)
- `src/modules/authority/authority-policy.ts`
- `src/modules/authority/spend-intent.ts`
- `src/modules/authority/spend-grant.ts`
- `src/modules/purchases/monetary-scope.ts` (new)
- `src/modules/purchases/monetary-migration.ts` (new)
- `src/modules/purchases/purchase-ledger.ts`
- `src/modules/purchases/paid-resource-quote.ts`
- `src/modules/purchases/purchase-market-snapshot.ts`
- `src/modules/purchases/request-market-purchase.ts`
- `src/modules/purchases/request-paid-resource-purchase.ts`
- `src/modules/app/app-runtime.ts`
- `src/app/api/app/settings/route.ts`
- `src/modules/agent/task-runtime.ts`
- `src/modules/e2e/evidence.ts`
- `src/modules/resources/resource-schema.ts`
- `src/modules/resources/resource-discovery.ts`
- `src/modules/resources/market-offers.ts`

Tests and fixtures:

- `tests/helpers/test-mode-authority.ts` (new)
- `tests/unit/monetary-ledger.test.ts` (new)
- `tests/unit/app-management.test.ts`
- `tests/unit/approved-offer-payment.test.ts`
- `tests/unit/approved-payment.test.ts`
- `tests/unit/approved-resource-payment.test.ts`
- `tests/unit/card-member-migration.test.ts`
- `tests/unit/management-error-contract.test.ts`
- `tests/unit/e2e-evidence.test.ts`
- `tests/unit/paid-resource-purchase.test.ts`
- `tests/unit/policy-ledger.test.ts`
- `tests/unit/purchase-request.test.ts`
- `tests/unit/purchase-mode-isolation.test.ts`
- `tests/unit/resource-discovery.test.ts`
- `tests/unit/resource-schema.test.ts`
- `tests/unit/spend-grant.test.ts`
- `tests/unit/static-resource-registry.test.ts`

Documents: `plan.md`, `docs/architecture/mainnet-readiness/ledger-monetary-scope.md` (new). Existing uncommitted step-2 wallet/authority changes are retained separately and are not new step-3 work.
