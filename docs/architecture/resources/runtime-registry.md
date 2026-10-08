# Persistent registered APIs

Implemented 2026-10-07. Scope: the current Mainnet native-USDC registered-resource product path. No payment, automatic Spend Grant, Payments change, or Mainnet execution change is part of registration.

## Product data and migration

`RuntimeResourceRegistry` shares the existing PurchaseLedger SQLite connection. Migration `011_runtime_resources` creates the resource registry and its migration records in `app-ledger.sqlite`; no ledger is deleted or rebuilt. Installation configuration (`YOSH_MAINNET_RESOURCES`) is imported once. After import it is not the live source of resource data.

The built-in catalog contains `you-web-search` / You.com Web Search, GET `https://api.you.com/v1/search`, Solana Mainnet `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, native USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, precision 6, base and maximum `5000` atomic units (0.005 USDC), and recovery `none`. Existing installation registrations retain their original IDs and policies as read-only imported entries. An existing ID is never repointed by a newer catalog.

User additions are durable entries with source `user`, state `ACTIVE`, exact approved request and asset policy, immutable definition, and timestamps. IDs remain reserved after removal. Disable and remove set `DISABLED` / `REMOVED`; they never delete historical purchases, Grant records, or the resource identity. Active resources are bounded to 256; disabled/removed historical identities are retained. Runtime registration currently supports public HTTPS requests and Mainnet native USDC. Native Add API offers `none` and explicitly declared idempotent recovery; the API also validates the existing structured recovery capabilities. No request body or authorization/cookie header can be added through runtime registration.

The payment configuration adapter supplies active registry definitions to the existing kernel. The payment kernel is unchanged. Live `402` challenges continue to determine recipient, fee payer, selected requirements and transaction facts. Runtime input prohibits fixed recipient/amount and arbitrary transaction fields, and requires an integer maximum price. Prices remain decimal integer strings, validated against the existing monetary bound.

## Management and authorization

All APIs reuse exact-body HMAC management authentication, replay rejection, loopback/origin validation and signed responses:

| API | Purpose |
| --- | --- |
| GET `/api/app/resources` | List entries, including retained inactive records |
| POST `/api/app/resources` | User-approved registration, 201 |
| GET `/api/app/resources/:resourceId` | Inspect stable identity and definition |
| PUT `/api/app/resources/:resourceId` | Set `DISABLED` or `REMOVED` |
| POST `/api/app/resources/discover` | Optional non-paying GET/HEAD challenge discovery |

Agent capabilities and MCP expose no registration mutation. An Agent bearer token fails management authentication even when its connection is valid. Creating a resource never creates a Spend Grant or changes connection credentials, budgets, pause, or execution permission. Unregistered/inactive resources cannot receive a new Mainnet Grant. The existing ledger signing guard additionally checks current registry availability, so a resource disabled while an asynchronous purchase is preparing cannot begin a new signature/submission after acknowledgement. Submitted original-payment recovery still uses retained immutable payment evidence.

Settings has a Registered APIs row, list, Add API form, inspection, disable and confirmed removal. Native management writes notify the Authority surface immediately; Authority also refreshes every three seconds to pick up authenticated runtime additions made outside the UI. The existing Mainnet Registered API selector consumes the same active registry projection.

## Non-paying discovery

Discovery accepts only an exact public HTTPS endpoint and GET/HEAD. It resolves the hostname, rejects private/special-use addresses, pins the connection to a resolved public address while preserving TLS hostname validation, rejects redirects, limits headers to 16 KiB, and applies a ten-second DNS/socket deadline. No cookie, authorization, payment-signature header, signer or transaction submission is used. It validates the official SDK-decoded x402 challenge against the supported Mainnet rail and projects a transient metadata snapshot. Neither recipient nor fee payer is copied into the persisted resource policy. Discovery does not promise recovery support.

Discovery deliberately uses a direct pinned TLS connection. Networks requiring a proxy can make optional discovery unavailable; registration remains available with an explicitly reviewed policy. It fails closed rather than allowing an unvalidated proxy/DNS target.

## Verification

- Full backend suite: 62 files / 744 tests passed. One slow real-Codex startup test timed out on the first concurrent build run; its isolated retry and the final complete suite both passed.
- Runtime add/selection, SQLite reopen and AppRuntime restart, one-time import, built-in compatibility, Agent denial, malformed policy rejection, history/Grant retention, asynchronous Grant invalidation and signing invalidation tests passed.
- Non-paying discovery tests cover projection, malformed/oversized challenges, method restrictions and non-public address rejection.
- Native CLI model/transport tests passed, including runtime DTOs and management mutations without payment fields.
- Typecheck, lint, backend build and native Debug/Release builds passed. Native build logs include existing Xcode device/simulator plugin warnings; macOS builds succeeded.
- `scripts/install-macos-app.sh` updated `/Users/irin/Applications/Yosh.app` once. Bundle signature verification passed. Pre-update purchase count: 14; original-payment evidence count: 0. Both record fingerprints were identical after installation.
- Installed App PID 18790: `/Users/irin/Applications/Yosh.app/Contents/MacOS/Yosh`; its authenticated backend PID 18882 is owned by that App, ready on loopback 3049, using `/Users/irin/Library/Application Support/2049`.
- After the single install, authenticated POST registered `runtime-verification-20261007` / `Runtime Test API · no purchase`, GET `https://example.com/yosh-runtime-verification`, Mainnet/native USDC, precision 6, base/max `5000`, recovery `none`. The same installed backend immediately returned both `you-web-search` and this new ID in `overview.service.registeredResources` (the selector data source). No second build/install occurred; installed binary hash remained identical.
- The test registration was independently reread after closing and reopening a read-only SQLite connection, with the identical persisted ID/source/state/timestamp. Full AppRuntime restart persistence is covered by the automated restart test; no additional installed-App restart was performed after the runtime demonstration.
- Live authenticated You.com discovery succeeded: GET, Mainnet/native USDC, `5000`, `paymentSent: false`. Its recipient/fee-payer metadata was not persisted as registration facts.
- Live balance: 0.01 USDC, wallet available at `D8F9JNGbXirgU5FYCijw3SJMLy9ZcxnMpNsxvajTRXRC`; Mainnet selected, execution disabled, Payments paused, Daily Authority/remaining 0.01 USDC, no Spend Grant, paid/reserved zero. All 14 installation-wide historical purchase records and zero original-payment records retained identical fingerprints after registration.
- A live unauthenticated Agent-style registration POST was rejected with 401 `UNAUTHORIZED`. No `must-not-register` entry was added.
- Existing real desktop MCP read-only `get_spending_status` still reports `Transport closed`; the connection is configured but disabled/disconnected after safe exit. Installed authenticated management API verification succeeded. Real desktop MCP reconnection/handshake remains unverified, and was not silently enabled.

No Computer Use was used. No commit/push was performed.

## Existing execution limitation

Registration success is not payment readiness. The existing immutable payment-binding check reconstructs a fixed-payee declaration with a 300-second timeout limit; some live You.com challenges advertise 600 seconds. This can reject execution even though read-only discovery and Grant challenge validation accept 600 seconds. It is left unchanged because this task explicitly excludes payment-kernel changes. The new signing-race tests use supported 300-second mocked challenges; they do not claim a real Mainnet purchase passed.
