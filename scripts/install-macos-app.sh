#!/bin/bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "This installer requires macOS."
repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
applications_directory="$HOME/Applications"
installed_app="$applications_directory/Yosh.app"
legacy_app="$applications_directory/2049.app"
bundle_identifier="com.twentyfortynine.macos"

# Bootstrap the canonical Node override before loading the shared validator.
if [[ ${YOSH_NODE_PATH+x} && ${APP2049_NODE_PATH+x} && "$YOSH_NODE_PATH" != "$APP2049_NODE_PATH" ]]; then
  fail "Conflicting Yosh configuration for YOSH_NODE_PATH."
fi
node_candidate="${YOSH_NODE_PATH-${APP2049_NODE_PATH-$(command -v node || true)}}"
[[ -n "$node_candidate" && -x "$node_candidate" ]] || fail "Install Node.js >=24.5, or set YOSH_NODE_PATH to its executable."
node_executable="$("$node_candidate" -p 'process.execPath')"
"$node_executable" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 5)) { console.error("Node.js >=24.5 is required."); process.exit(1); }'
service_port="$("$node_executable" -e 'const {resolveYoshConfiguration}=require(process.argv[1]); console.log(resolveYoshConfiguration().port ?? "3049");' "$repository_root/src/modules/app/yosh-configuration.ts")"

# Never interrupt the native runtime's shutdown or replace a running backend build.
if /usr/bin/pgrep -x 2049 >/dev/null || /usr/bin/pgrep -x Yosh >/dev/null; then
  fail "Quit Yosh normally before rebuilding/installing it."
fi
if /usr/sbin/lsof -nP -iTCP:"$service_port" -sTCP:LISTEN >/dev/null; then
  fail "Wait for the local backend to stop safely before rebuilding/installing Yosh."
fi
for candidate_app in "$installed_app" "$legacy_app"; do
  [[ ! -L "$candidate_app" ]] || fail "Refusing to replace a symlink at $candidate_app."
  if [[ -e "$candidate_app" ]]; then
    existing_identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$candidate_app/Contents/Info.plist")"
    [[ "$existing_identifier" == "$bundle_identifier" ]] || fail "Another app already exists at $candidate_app."
  fi
done

# npm must use the same Node that the installed native app will launch.
export PATH="$(dirname "$node_executable"):$PATH"
command -v npm >/dev/null || fail "npm is required to build the backend."
command -v xcodebuild >/dev/null || fail "Xcode command-line build tools are required for rebuilding."
[[ -f "$repository_root/node_modules/next/dist/bin/next" ]] || fail "Run npm ci in $repository_root first."
cd "$repository_root"

printf 'Building backend with %s\n' "$node_executable"
npm run build
# Spotlight excludes .noindex directories, so only the installed copy appears in app searches.
derived_data="$repository_root/build.noindex/macos"
built_app="$derived_data/Build/Products/Release/Yosh.app"
printf 'Building native Yosh.app (Release)\n'
xcodebuild \
  -project "$repository_root/apps/macos/Yosh/Yosh.xcodeproj" \
  -scheme Yosh -configuration Release -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$derived_data" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
[[ -x "$built_app/Contents/MacOS/Yosh" ]] || fail "The native build did not produce $built_app."

# Local path hints contain no credentials or configuration contents. Dependencies stay in the repo.
info_plist="$built_app/Contents/Info.plist"
/usr/bin/plutil -replace YoshRepositoryRoot -string "$repository_root" "$info_plist"
/usr/bin/plutil -replace YoshNodeExecutable -string "$node_executable" "$info_plist"
# Ad-hoc signing suffices for this local build; no Developer ID or notarization is required.
/usr/bin/codesign --force --sign - "$built_app"
/usr/bin/codesign --verify --strict "$built_app"

mkdir -p "$applications_directory"
staging="$(mktemp -d "$applications_directory/.yosh-install.XXXXXX")"
install_complete=0
replacement_moved=0
cleanup() {
  if [[ "$install_complete" == 0 ]]; then
    # A failed final verification/registration restores the previous installed bundle.
    if [[ "$replacement_moved" == 1 && -e "$installed_app" ]]; then
      mv "$installed_app" "$staging/failed.app" || { trap - EXIT; return; }
    fi
    if [[ -e "$staging/previous.app" ]]; then
      mv "$staging/previous.app" "$installed_app" || { trap - EXIT; return; }
    fi
    if [[ -e "$staging/legacy.app" && ! -e "$legacy_app" ]]; then
      mv "$staging/legacy.app" "$legacy_app" || { trap - EXIT; return; }
    fi
  fi
  rm -rf "$staging"
}
trap cleanup EXIT
/usr/bin/ditto "$built_app" "$staging/Yosh.app"
/usr/bin/codesign --verify --strict "$staging/Yosh.app"
if [[ -e "$installed_app" ]]; then
  mv "$installed_app" "$staging/previous.app"
fi
if ! mv "$staging/Yosh.app" "$installed_app"; then
  if [[ -e "$staging/previous.app" ]]; then
    if ! mv "$staging/previous.app" "$installed_app"; then
      trap - EXIT
      fail "Could not restore the previous app; it is preserved at $staging/previous.app."
    fi
  fi
  fail "Could not install $installed_app."
fi
replacement_moved=1
/usr/bin/codesign --verify --strict "$installed_app"
# Retire the previous product name only after the replacement is verified.
# Bundle, Keychain and data identities stay unchanged across this rename.
if [[ -e "$legacy_app" ]]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$legacy_app"
  mv "$legacy_app" "$staging/legacy.app"
fi
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed_app"
/usr/bin/mdimport "$installed_app"
install_complete=1
printf '\nInstalled: %s\nBuild output: %s\n' "$installed_app" "$built_app"
printf 'Double-click Yosh in Finder, or search for Yosh in Spotlight.\n'
printf 'Keep this repository, its node_modules/.next, and %s available.\n' "$node_executable"
