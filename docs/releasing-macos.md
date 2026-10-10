# macOS Beta distribution

The native app, bundled backend, and MCP bridge belong to this repository. The public website is maintained separately in `/Users/irin/Desktop/2049-web`; do not copy website source into this repository.

## v0.1.0 Beta scope

- **Platform:** Apple Silicon (arm64), macOS 15.0 or later. The underlying installer supports host-specific arm64 and x86_64 builds; this Beta distributes arm64 only.
- **Trust status:** ad hoc signed, no Developer ID, no Apple notarization. A valid local code signature verifies bundle integrity but does not establish Gatekeeper trust. Users may need to approve Yosh individually in System Settings → Privacy & Security. Do not disable Gatekeeper, remove quarantine, or change macOS security policy to make the Beta open.
- **Runtime:** the bundle includes Yosh, official Node 24.21.0, the Next standalone backend and traced dependencies, static/public assets, the compiled MCP bridge, and the Node license. Runtime does not require a source checkout, external Node, Homebrew, or developer environment variables.
- **Identity:** bundle ID `com.twentyfortynine.macos` is unchanged. Wallet Keychain identities (`com.2049.wallet.v1` / `consumer-wallet-v1` and `com.yosh.wallet.mainnet.v1` / `consumer-wallet-mainnet-v1`), App Lock, and backend-management identities are unchanged. Ad hoc rebuilds can change the designated requirement and prompt for renewed Keychain access; do not rotate or bypass existing credentials.
- **User data:** wallet material, credentials, private product configuration, and the SQLite ledger are outside the bundle. Existing installations retain their current Application Support directory, including the legacy `2049` path where present. Packaging does not copy, migrate, or reset those records. Reading the initial overview does not create a wallet; fresh production configuration keeps Mainnet execution disabled.

The compact English/Chinese installation guide and public release body are in [v0.1.0 Beta release notes](releases/v0.1.0-beta.md). The guide follows [Apple's per-app opening instructions](https://support.apple.com/en-us/102445). It does not promise that every managed Mac permits an override.

## Build and inspect a candidate

Use the existing production installer after Yosh has quit normally and its backend has stopped:

```sh
npm ci
npm test
npm run typecheck
npm run lint
YOSH_CODESIGN_IDENTITY=- ./scripts/install-macos-app.sh
./scripts/package-macos-dmg.sh --beta
./scripts/package-macos-dmg.sh --verify build.noindex/distribution/Yosh-0.1.0-beta-arm64.dmg
```

The installer performs the backend production build and native Release build. Build tools are development-time requirements only. The packager reuses the resulting production app without changing it, creates a compressed UDZO DMG containing only `Yosh.app` and the `/Applications` shortcut, then mounts it read-only to inspect it. Checks cover version, bundle ID, minimum OS, app/Node architecture, native dependencies, backend/MCP files, code-signature integrity, and excluded development configuration, secret-file and database patterns. The SHA-256 sidecar identifies the exact artifact.

Outputs are ignored under `build.noindex/distribution/`. With `--beta`, the image volume and filename carry the Beta label. `--verify` accepts existing stable and Beta names and refreshes the checksum sidecar; independently compare a published checksum before using that command on a download. The original Developer ID image-signing option and `--require-notarized` verification remain available for a later notarized release, but are not required or claimed for this Beta.

Repeatability means rebuilding the same committed source, lockfile, Node version, and workflow. Disk-image metadata and native build outputs mean byte-identical rebuilds are not promised. A local artifact built from uncommitted changes must not be described as corresponding to an older GitHub tag: commit the reviewed release source before publishing or rebuild from the approved commit.

## Manual GitHub workflow

`.github/workflows/release-macos.yml` runs only on manual dispatch from `main`. It requires no Apple signing secrets, checks for an arm64 runner, tests and builds the production bundle, and uploads the Beta DMG, checksum, and bilingual release notes as workflow artifacts. `version` must match the app's `MARKETING_VERSION` and release-notes filename.

`publish_release` defaults to `false`. Leave it false until the owner explicitly approves public publication. An approved run with it set to true creates the **prerelease** tag `v0.1.0-beta`, titled **Yosh v0.1.0 Beta — Apple Silicon (Unnotarized)**. It uses the workflow's exact source commit and refuses to overwrite an existing Release. After publication, it downloads the real assets, checks the SHA-256, obtains the DMG URL from GitHub, and verifies the bytes again through an unauthenticated direct download. A failure in this final check must be resolved before website integration.

The workflow has been prepared locally, not dispatched. No source commit, push, public Release, or website deployment is authorized by preparing these files.

## Acceptance and website handoff

Record candidate checks and their limits in [the local verification record](releases/v0.1.0-beta-verification.md). A local rebuilt app running outside the repository is useful evidence, but is not a clean-machine installation or an internet-quarantined first launch. Test the following without executing payments:

- Install from the DMG into Applications on a clean Apple Silicon Mac; approve the first launch through Privacy & Security; confirm the bundled backend reaches READY.
- Confirm startup alone creates no wallet, then configure and use the actual Codex MCP connection for read-only status.
- Upgrade an existing installation and confirm the original wallet identity and financial records remain intact; complete any Keychain prompt in the system UI.
- Confirm the app runs without developer configuration, a source repository, or externally installed Node.

Only after the public download succeeds and its checksum matches, use the **actual asset URL returned by GitHub** in the separate website's existing download action. Preserve its layout, styling and English/Chinese content. Label the action **Download for macOS · Apple Silicon · Beta** / **下载 macOS 版 · Apple Silicon · Beta**, and reuse the compact bilingual install guide. Do not insert a predicted URL, local artifact path, or placeholder download link. Publishing the Release does not authorize website deployment.
