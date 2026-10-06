# Execution Details and persisted environment selection

Scope: the native Authority Execution row, its existing detail-navigation destination, and authenticated environment switching. No payment-kernel changes or Mainnet payment.

## Product flow

Authority → Execution uses `YoshDetailNavigation` / `YoshDetailStack`, existing narrow viewport and plain native Buttons. Three compact rows show Simulated, Live · Devnet and Live · Mainnet. The checkmark follows `service.execution` from the authenticated overview; no optimistic selection is stored. Cluster, CAIP-2 network, mint, asset label and decimals come from the backend. Returning uses the refreshed overview and the exact selected mode label.

Native `ServiceEndpoint.setExecution` sends only `{mode}` to authenticated `PUT /api/app/execution`. GET returns a safe PaymentEnvironment projection; the same projection is embedded in overview. Existing request and response HMAC, exact-body verification, origin restrictions, nonce replay protection and bounded transport remain in effect. Agent/MCP credentials cannot change this setting.

## Backend state and safety

`execution-selection.json` persists only version and mode, atomically replaced with permissions 0600. Invalid persisted selection fails closed. Startup restores selection without changing `.env.local`.

The App runtime selects a validated pinned PaymentEnvironment profile. Cross-network generic overrides are not reused; explicit network-specific RPC settings remain supported. Mainnet receives no Demo identity or signer configuration. Only the active configuration keys are changed in the exclusively owned backend process; payment services and the signer consume that same configuration. The original operator enablement flag is retained for Mainnet only; selecting Mainnet cannot grant it.

Switching is refused while tracked purchases, quotes, wallet initialization, recovery, pending original payment/delivery or any reserved amount remains. Existing records, request identity, monetary scope and recovery evidence are unchanged. No authority or connection mutation is performed. Mainnet reads its own existing daily controls and SpendGrant, never the test scope.

Mainnet selection can be displayed before payment configuration is complete. Overview uses configured public identity only; absent configuration returns an empty/unavailable wallet address rather than a test wallet or a newly created wallet. Request-time Mainnet buyer identity comes from validated backend registration; the existing execution kernel still loads and verifies the separate Mainnet signer only after its gates. No signer or secret is returned by execution/overview.

Production enablement, Mainnet daily authority, Mainnet SpendGrant, paused state, registered resource facts, preflight/genesis, wallet isolation, signing/submission guards and original-payment recovery remain authoritative. Selecting an environment does not resume, create authority/grants, fund wallets, or submit a transaction. The factual Mainnet status is separate from the selected-mode label and does not claim that preflight or signing has succeeded.

## Files for this step

- Backend: `src/modules/app/execution-selection.ts`, `src/modules/app/app-runtime.ts`, `src/app/api/app/execution/route.ts`.
- Native models: `AppOverview.swift`, `ExecutionEnvironment.swift`, `AuthorityOverviewPresentation.swift`.
- Native transport: `ManagementTransport.swift`, `OverviewClient.swift`.
- Native views: `BackControls.swift`, `BackOverview.swift`, `ExecutionDetail.swift`; Xcode source registrations.
- Tests: `tests/unit/execution-selection.test.ts`, `apps/macos/Yosh/tests/ExecutionDetailViewTest.swift`, existing native model expectations and detail/connection test source lists.
- Documentation: this report and `plan.md`.

## Verification

- Full backend regression: 55 files, 687 tests passed; includes existing Mainnet MCP fixtures and all production rejection gates, recovery and replay tests.
- Eight new backend tests: authenticated selection, no wallet/authority side effects, persisted restart, unchanged test controls, Agent/unsigned/extra-field/replay rejection, active-work and recovery switch refusal, corrupt-file failure and owner release, test grant isolation and existing-flag preservation.
- Typecheck and lint passed.
- Native Debug build passed. Native detail, tab, connection, grant, roster and model/transport fixtures passed. The first aggregate detail run's final roster compile was interrupted by a source edit; its isolated final rerun passed. Final Execution fixture passed after selection/accessibility refinement.
- Production backend build and native Release build passed through `scripts/install-macos-app.sh`. The installed `/Users/irin/Applications/Yosh.app` matches the Release bundle byte-for-byte; strict code-sign verification passed.
- Previous App/backend exited normally at 16:48:34 (backend PID 64606, status 143). Updated installed App PID 68462 runs from the expected installation path. After the user unlocked App Lock, backend PID 68530 became ready at 16:50:21, listening only on 127.0.0.1:3049.
- At the user's request, Computer Use stopped before actual App selection/navigation acceptance. Real-window environment clicks and restart acceptance were not performed; native fixture callbacks and backend persistence/restart tests are the current evidence. No real purchase was made and production configuration was not enabled.
- Nonblocking existing build notices: Next MCP dynamic file tracing, Xcode CoreDevice/Simulator version mismatch and absent AppIntents metadata. Backend and macOS Release builds still succeeded.

Remaining real-money acceptance blockers are unchanged: explicit operator flag, valid independently provisioned Mainnet identity/signer and resource registration/facilitator, user-created scoped daily authority and SpendGrant, successful production preflight, and authorized actual Codex-host acceptance. This step neither provides nor exercises those approvals.
