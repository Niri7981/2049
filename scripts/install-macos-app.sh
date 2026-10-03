#!/bin/bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
[[ "$(uname -s)" == Darwin ]] || fail "This installer requires macOS."
repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
applications_directory="$HOME/Applications"
installed_app="$applications_directory/2049.app"
bundle_identifier="com.twentyfortynine.macos"

# Never interrupt the native runtime's shutdown or replace a running backend build.
if /usr/bin/pgrep -x 2049 >/dev/null; then
  fail "Quit 2049 normally before rebuilding/installing it."
fi
[[ ! -L "$installed_app" ]] || fail "Refusing to replace a symlink at $installed_app."
if [[ -e "$installed_app" ]]; then
  existing_identifier="$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$installed_app/Contents/Info.plist")"
  [[ "$existing_identifier" == "$bundle_identifier" ]] || fail "Another app already exists at $installed_app."
fi

node_candidate="${APP2049_NODE_PATH:-$(command -v node || true)}"
[[ -n "$node_candidate" && -x "$node_candidate" ]] || fail "Install Node.js >=24.5, or set APP2049_NODE_PATH to its executable."
node_executable="$("$node_candidate" -p 'process.execPath')"
"$node_executable" -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 24 || (major === 24 && minor < 5)) { console.error("Node.js >=24.5 is required."); process.exit(1); }'
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
built_app="$derived_data/Build/Products/Release/2049.app"
printf 'Building native 2049.app (Release)\n'
xcodebuild \
  -project "$repository_root/apps/macos/2049/2049.xcodeproj" \
  -scheme 2049 -configuration Release -destination "platform=macOS,arch=$(uname -m)" \
  -derivedDataPath "$derived_data" ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO build
[[ -x "$built_app/Contents/MacOS/2049" ]] || fail "The native build did not produce $built_app."

# Local path hints contain no credentials or configuration contents. Dependencies stay in the repo.
info_plist="$built_app/Contents/Info.plist"
/usr/bin/plutil -replace APP2049RepositoryRoot -string "$repository_root" "$info_plist"
/usr/bin/plutil -replace APP2049NodeExecutable -string "$node_executable" "$info_plist"
# Ad-hoc signing suffices for this local build; no Developer ID or notarization is required.
/usr/bin/codesign --force --sign - "$built_app"
/usr/bin/codesign --verify --strict "$built_app"

mkdir -p "$applications_directory"
staging="$(mktemp -d "$applications_directory/.2049-install.XXXXXX")"
trap 'rm -rf "$staging"' EXIT
/usr/bin/ditto "$built_app" "$staging/2049.app"
/usr/bin/codesign --verify --strict "$staging/2049.app"
if [[ -e "$installed_app" ]]; then
  mv "$installed_app" "$staging/previous.app"
fi
if ! mv "$staging/2049.app" "$installed_app"; then
  if [[ -e "$staging/previous.app" ]]; then
    if ! mv "$staging/previous.app" "$installed_app"; then
      trap - EXIT
      fail "Could not restore the previous app; it is preserved at $staging/previous.app."
    fi
  fi
  fail "Could not install $installed_app."
fi
/usr/bin/codesign --verify --strict "$installed_app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$installed_app"
/usr/bin/mdimport "$installed_app"
printf '\nInstalled: %s\nBuild output: %s\n' "$installed_app" "$built_app"
printf 'Double-click 2049 in Finder, or search for 2049 in Spotlight.\n'
printf 'Keep this repository, its node_modules/.next, and %s available.\n' "$node_executable"
