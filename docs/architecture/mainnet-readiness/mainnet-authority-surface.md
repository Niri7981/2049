# Mainnet Authority Surface

Scope: factual Authority amounts, asset semantics, Daily Authority detail/wallet, scoped Grant and blocking reasons. Payment, signing, x402, Activity, transaction details, explorer links and recovery surfaces are unchanged. No real Mainnet payment was performed.

## Backend truth

The authenticated overview and selected-member response now include `authority`, built from the existing `managedSummary(now, mode)` and `spendGrantSummary(now, mode, memberId)` services. Available, Reserved, Paid and the daily limit are integer strings from the selected monetary scope. Their display strings are formatted using bigint in the backend; the native view does not calculate authoritative totals. Mainnet uses the environment's USDC symbol; test environments use the same metadata with the Test prefix.

The daily state distinguishes required, paused, active and exhausted available authority. Per-member blocking reasons distinguish production disablement, missing/paused/exhausted daily authority, missing/exhausted registered Grant, unavailable/unverified wallet, API registration and unverified/zero USDC balance. This read-only presentation is not a quote-specific payment approval and does not replace preflight or any execution gate. It does not claim that a nonzero wallet balance covers an unknown future quote.

Grant facts retain the current-scope record, including active/revoked/expired status and expiry. The registered API URL is resolved by the backend. Network, asset, provider, recipient, operation and scheme determine whether an active Grant can be shown as usable scoped delegation. Unregistered current-scope records can remain visible for inspection/revocation but are not shown as usable. A test/simulated Grant never becomes Mainnet authority.

## Dedicated Mainnet wallet

Overview reads only the validated configured Mainnet public address and the last read-only wallet verification state; absent configuration never falls back to the test wallet. Opening Authority does not create a wallet. The existing authenticated balance endpoint now reads the dedicated existing signer through `loadEnvironmentWalletSigner`, verifies separate-store identity and then uses the existing balance service. It cannot create or replace a Mainnet item. Missing or mismatched signer returns a factual `Mainnet wallet unavailable` response without querying RPC or using a test wallet. Only public address, network, amount and identity metadata reach the native transport; no secret or signer is returned.

Balance responses include CAIP-2 network, mint and decimals. The detail checks all three and the exact display unit before showing a balance; it never relabels a test balance as Mainnet USDC. Mainnet RPC still verifies genesis, token program, owner, mint and decimals in the existing bounded balance reader. Balance is separate from spending authority and remains best-effort network data.

## Native UI

The original Authority layout, selector, Authority Line and bottom navigation remain. Available is the primary serif figure; Reserved/Paid are small supporting values in the existing daily-limit line. The existing status area presents the first backend blocker; Daily Authority detail lists the factual daily state and all applicable reasons. No cards, banners or wallet redesign were added.

The dedicated public wallet address, Solana Mainnet network and verified balance/empty state appear inside the existing Daily Authority detail flow. Grant detail uses scoped backend amounts, registered API, unit, commitment and expiry. Native shared/member combination takes readiness from the selected member rather than borrowing the default member's Grant. Missing or mismatched Mainnet projection fails closed to absent amounts/Grant.

## Changed files for this step

- Backend: `src/modules/app/authority-surface.ts`, `src/modules/app/app-runtime.ts`, `src/modules/app/wallet-balance.ts`, `src/app/api/app/balance/route.ts`.
- Native models: `AuthoritySurface.swift`, `AppOverview.swift`, `ExecutionEnvironment.swift`, `AuthorityOverviewPresentation.swift`, `DailyAuthorityPresentation.swift`.
- Native views: `BackOverview.swift`, `AuthoritySettingsDetail.swift`, `DailyAuthorityContent.swift`, `SpendGrantDetail.swift`; Xcode source registration.
- Tests: `tests/unit/authority-surface.test.ts`, existing balance-unit expectation in `app-management.test.ts`, `apps/macos/Yosh/tests/AuthoritySurfaceTest.swift`, detail/connection script source lists.
- Documentation: this report and `plan.md`.

## Validation

- Full backend regression: 56 test files, 694 tests passed. Seven new tests cover scoped exact accounting (including persisted Paid/unknown reservation fixtures), large bigint formatting, daily states, test/member Grant isolation, no creation/unpause on Mainnet selection, missing/mismatched dedicated wallet, verified balance identity and registered Grant active/revoked/expired states. These use temporary databases, fake accounting records, generated unfunded signers and mocked RPC; they are not evidence of an actual on-chain payment.
- Typecheck and lint passed.
- Native Debug build passed. Final native projection, Daily Authority and Grant fixtures passed; existing detail, Activity/Purchase/roster and connection regressions also passed. The initial new native fixture had a throwing-expression compile error and was corrected before final verification.
- Native Mainnet projections verify exact amount mapping, Test/USDC units, mismatched/missing scope rejection, test-Grant refusal, registered API/expiry states, scoped visual progress and balance identity.
- `scripts/install-macos-app.sh` passed the production backend build and native Release build, updating `/Users/irin/Applications/Yosh.app`. The installed bundle matches the Release build byte-for-byte; strict signature verification passed.
- Old backend PID 68530 stopped normally at 17:14:09 (status 143). Updated App PID 73631 runs from `/Users/irin/Applications/Yosh.app/Contents/MacOS/Yosh`; its child backend PID 73654 logged ready at 17:18:33 and listens on 127.0.0.1:3049. An unauthenticated production overview request returned 401.
- Computer Use was not used. Actual-window visual/click acceptance remains manual; startup and installation were verified by process paths, lifecycle logs, bundle comparison and signature checks.
- Existing nonblocking Next MCP file-tracing and Xcode CoreDevice/Simulator/AppIntents notices remain; production backend, Debug and Release builds succeeded.
