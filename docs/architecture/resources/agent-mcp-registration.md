# Agent-driven MCP resource registration — 2026-10-08

## Scope and contract

The user explicitly authorized replacing proposal-only discovery with Agent creation of previously discovered Resources. This supersedes the earlier v1 registration-approval wording. Registration remains separate from the user's Spend Grant. Payment, wallet, authorization, ledger execution, SDK and recovery implementations are unchanged.

The installed Agent workflow is `discover_x402_resource` → `register_x402_resource` → review in Yosh → user-created Spend Grant. Registration only writes runtime registry data and immutable submission metadata. It never quotes again, signs, submits payment, changes configuration or creates/revokes a Grant.

## Generic integration

Successful authenticated MCP discovery stores the normalized validated challenge proposal, typed dynamic fields, fixed HTTPS request, sample, delivery declarations and documentation sources/uncertainties in an additive SQLite discovery table. The opaque `discoveryId` is bound to the authenticated member, connection and generation, and expires after 30 minutes. Discovery continues to use the existing public HTTPS/DNS-pinned fetch, no redirects, response limits, Mainnet native USDC challenge validation and POST consent gate.

The new MCP tool accepts only `discoveryId`, `resourceId`, `providerId` and `displayName`. Strict schemas reject executable overrides and management fields. The Agent creation route is authenticated through the existing Agent channel, not the management channel. An atomic transaction validates and consumes the saved discovery and calls the existing registry insertion; concurrent/replayed identical submissions return the same active resource. Changed replays, foreign/rotated connection identities, expired/fabricated discoveries, duplicate IDs and duplicate request/input definitions are rejected. Disabled or removed resources cannot be reactivated through this tool.

The registry's existing SQL source storage remains compatible. An immutable side table records Agent provenance; backend projections expose `source: agent`, the submitting member, sample, documentation and uncertainties. Migration marker `015_agent_resource_registration` only adds tables/triggers, preserving every existing registry definition, Grant and financial record. Agent resources use the existing user-resource disable/remove path, accessible only to the user through management.

Native Registered APIs and the Authority resource selector consume the same registry and existing three-second automatic refresh. Agent resources carry an explicit Agent-submitted label. Resource details show fixed/dynamic fields, sample, headers, bounded delivery policy/recovery declaration, documentation and uncertainties. Selecting the resource prepopulates the Grant sample; this does not submit the Grant.

## Metadata and consent limits

Metadata supplied by the Agent is runtime-schema validated, not a backend verification that documentation promises are true. Documentation URLs are review evidence and are never fetched by registration. Required fields, types, bounds, fixed/dynamic conflicts and sample requests are independently validated by the shared Resource contract. Undocumented parameters must be omitted; uncertainties remain visible. Recovery defaults to `none`; non-default recovery requires supplied documentation and existing origin/read-only/replay validation. A challenge alone does not establish recovery support.

The existing unknown POST discovery gate still requires native management confirmation of the exact outbound request. Agent-provided approval hashes are rejected. Registration of a saved successfully validated POST is entirely local and cannot send the POST again; the later POST Grant consent requirements remain unchanged. This change does not introduce a new pending-POST approval queue or bypass existing consent.

## Verification

Current automated and installed-product results will be recorded after validation. Fixtures are not Mainnet payment evidence. Installed acceptance is restricted to unpaid Agent402 discovery, explicit MCP Resource registration, shared/native visibility, absent resource Spend Grant and blocked purchase. No Grant or Mainnet payment is authorized.

### Completed current verification

- Full automated regression: **77 files / 940 tests passed**. TypeScript typecheck, lint, Next production build and macOS Debug build passed. The installer subsequently rebuilt production/backend and macOS Release successfully. Native Spend Grant/POST confirmation regression and the isolated Agent resource metadata/sample decoder passed.
- Tests include backend-bound discovery replay/restart, cross-member/rotated connection/fabricated/expired IDs, strict input rejection, duplicate request prevention, local POST registration after validated management consent, undocumented recovery rejection, MCP tool/schema boundaries, authenticated Agent route error mapping and registry read-model visibility.
- The Mainnet fixture with execution otherwise enabled proves a newly Agent-registered resource without its own Grant receives `DENIED / SPEND_GRANT_REQUIRED` before signer preparation. Fixtures do not use real private keys or send Mainnet payment.
- Old installed App quit normally; loopback listener stopped before installation. Existing `scripts/install-macos-app.sh` updated `/Users/irin/Applications/Yosh.app`. Strict deep code-signature verification and installed/Release recursive file comparison passed. The user completed the existing Keychain/App Lock confirmation and PIN unlock; no security bypass was used.
- Current installed App PID **77413** runs from the installation path; backend PID **77426** runs with cwd inside the installed `Runtime/backend`. Lifecycle log at **2026-10-08 21:43:30 Asia/Shanghai** reports backend ready, listening only on `127.0.0.1:3049`.
- An actual fresh Codex app-server host used the existing installed MCP command and unchanged connection descriptor. It discovered Agent402, invoked `register_x402_resource`, replayed the exact registration idempotently and read the same Authority registry projection. Resource **`agent402-crypto-price`** is `ACTIVE`, `source: agent`, named **Agent402 Crypto Price**. It is persisted in SQLite and appears in the native Registered APIs and Authority resource selector without form entry. Native Resource details and the selector/Grant form were inspected; the sample `{"coins":"BTC,ETH,SOL","currency":"usd"}` is prefilled. The backend reads resources on the existing automatic refresh interval (up to three seconds).
- Live challenge: `GET https://agent402.tools/api/crypto-price`, **1000 atomic native USDC / 0.001 USDC**, Solana Mainnet, mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, recipient `J7aN3PLJnTCF5qpEnvJHJsnCjcGuqC2rYtEM8Gv3xwg`. Fields are required string `coins`, optional string `currency`; generic 300-character input and 262144-byte delivery limits are Yosh bounds, not invented merchant claims. Max-25-coins documentation is preserved with the explicit limit that string validation does not count comma-separated elements. Recovery remains `none`, with unverified delivery/recovery noted.
- Installed SQLite confirms no historical or active Grant for the new Resource. The real MCP purchase request returned **DENIED / SPEND_GRANT_REQUIRED / NOT_STARTED**, with `grant: null`. Its persisted row has no transaction, signature payload or payment evidence. This is a rejection acceptance record, not a paid purchase.
- Existing **14** purchase rows and their delivery/events, **10** Grants/events, wallet scopes, original payments/signatures, monetary controls, member/configuration and three old resources retain their prior fingerprints. Counts now are 15 purchase requests, 10 Grants and 4 resources. Only the new resource/submission/discovery, migration marker, denied request/delivery/events and ordinary monetary budget clock observation are additional or changed. Product and connection configuration file hashes are unchanged; Reserved/Paid remain zero in the current Mainnet UI.
- No production payment, signing, Grant creation/revocation, wallet/settings mutation, commit, push or publication occurred. Existing Codex sessions may retain their old MCP tool list until reconnecting; the new installed capability was verified through a fresh actual host, not a fake MCP harness.

Installed acceptance command (explicit opt-in; creates the named resource and checks one denied request):

```sh
YOSH_ACCEPT_AGENT_RESOURCE_REGISTRATION=1 node --import tsx tests/native/installed-agent-resource-registration.mjs
```

Paid-response delivery and merchant recovery have not been exercised; unknown POST consent behavior was regression-tested with fixtures, not by sending a real third-party POST. The work stops before user-created Grant or payment.
