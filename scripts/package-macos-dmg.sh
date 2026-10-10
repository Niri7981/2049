#!/bin/bash
set -euo pipefail

fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage:
  scripts/package-macos-dmg.sh [--app Yosh.app] [--output-dir DIR] [--beta] [--identity NAME]
  scripts/package-macos-dmg.sh --verify DMG [--require-notarized]

Package the existing production Yosh.app, or verify a DMG and refresh its SHA-256 sidecar.
--beta labels the image and filename as Beta; it does not add Developer ID signing or notarization.
EOF
}

repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
app="$repository_root/build.noindex/macos/Build/Products/Release/Yosh.app"
output_dir="$repository_root/build.noindex/distribution"
identity=""
verify_dmg=""
require_notarized=0
beta=0
active_mount=""
stage=""
temporary_dmg=""

while (($#)); do
  case "$1" in
    --app) (($# >= 2)) || fail "--app requires a path"; app="$2"; shift 2 ;;
    --output-dir) (($# >= 2)) || fail "--output-dir requires a path"; output_dir="$2"; shift 2 ;;
    --identity) (($# >= 2)) || fail "--identity requires a Developer ID identity"; identity="$2"; shift 2 ;;
    --verify) (($# >= 2)) || fail "--verify requires a DMG path"; verify_dmg="$2"; shift 2 ;;
    --require-notarized) require_notarized=1; shift ;;
    --beta) beta=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "unknown argument: $1" ;;
  esac
done

bundle_id="com.twentyfortynine.macos"
plist_value() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist"; }
read_signing_details() { /usr/bin/codesign -dv --verbose=2 "$1" 2>&1; }
cleanup() {
  if [[ -n "$active_mount" ]]; then /usr/bin/hdiutil detach -quiet "$active_mount" >/dev/null 2>&1 || true; fi
  if [[ -n "$active_mount" && -d "$active_mount" ]]; then /bin/rmdir "$active_mount" 2>/dev/null || true; fi
  [[ -z "$stage" || ! -e "$stage" ]] || /bin/rm -rf "$stage"
  [[ -z "$temporary_dmg" || ! -e "$temporary_dmg" ]] || /bin/rm -f "$temporary_dmg"
}
trap cleanup EXIT

assert_clean_bundle() {
  local candidate="$1" bundle_identifier min_version node binary_arch app_arches node_arches
  [[ -d "$candidate" && ! -L "$candidate" ]] || fail "Yosh.app is missing or is a symlink: $candidate"
  bundle_identifier="$(plist_value "$candidate" CFBundleIdentifier)"
  [[ "$bundle_identifier" == "$bundle_id" ]] || fail "Unexpected bundle identifier: $bundle_identifier"
  [[ "$(plist_value "$candidate" CFBundleDisplayName)" == Yosh ]] || fail "Unexpected app display name"
  min_version="$(plist_value "$candidate" LSMinimumSystemVersion)"
  [[ "$min_version" == 15.0 ]] || fail "Expected macOS 15.0 deployment target; found $min_version"

  local runtime="$candidate/Contents/Resources/Runtime"
  [[ -x "$candidate/Contents/MacOS/Yosh" ]] || fail "Native Yosh executable is missing"
  [[ -x "$candidate/Contents/MacOS/YoshBackendNode" ]] || fail "Bundled Node executable is missing"
  [[ -f "$runtime/backend/server.js" && -f "$runtime/backend/package.json" ]] || fail "Next standalone backend is incomplete"
  [[ -d "$runtime/backend/node_modules" && -d "$runtime/backend/.next" ]] || fail "Backend runtime dependencies or Next assets are missing"
  [[ -d "$runtime/backend/.next/static" && -f "$runtime/mcp.cjs" ]] || fail "Static assets or bundled MCP bridge are missing"
  [[ -f "$runtime/licenses/Node-LICENSE" ]] || fail "Bundled Node license is missing"

  for forbidden in .git .data src tests .env .env.local .env.production; do
    [[ ! -e "$candidate/$forbidden" ]] || fail "Development or mutable user data found in app bundle: $forbidden"
  done
  if /usr/bin/find "$candidate" \( -name '.env*' -o -name 'product-configuration.json' \
      -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.db' -o -name '*.db-*' \
      -o -name '*.p12' -o -name '*.pem' -o -name '*.key' -o -name '*.mobileprovision' \) \
      -print -quit | /usr/bin/grep -q .; then
    fail "Secret, development configuration, or runtime database found in app bundle"
  fi

  app_arches="$(/usr/bin/lipo -archs "$candidate/Contents/MacOS/Yosh")"
  node_arches="$(/usr/bin/lipo -archs "$candidate/Contents/MacOS/YoshBackendNode")"
  [[ "$app_arches" == "$node_arches" ]] || fail "Native app and bundled Node architectures differ: $app_arches / $node_arches"
  case "$app_arches" in arm64|x86_64) ;; *) fail "Expected one supported architecture (arm64 or x86_64); found $app_arches" ;; esac
  binary_arch="$app_arches"

  while IFS= read -r -d '' binary; do
    app_arches="$(/usr/bin/lipo -archs "$binary")"
    case " $app_arches " in *" $binary_arch "*) ;; *) fail "Native dependency architecture does not include $binary_arch: $binary" ;; esac
  done < <(/usr/bin/find "$runtime/backend/node_modules" -type f -name '*.node' -print0)
  printf '%s\n' "$binary_arch"
}

verify_dmg() {
  local dmg="$1" must_notarized="$2" name version architecture min_version
  [[ -f "$dmg" && ! -L "$dmg" ]] || fail "DMG is missing or is a symlink: $dmg"
  name="$(basename "$dmg")"
  [[ "$name" =~ ^Yosh-([0-9]+\.[0-9]+\.[0-9]+)(-beta)?-(arm64|x86_64)\.dmg$ ]] || fail "Unexpected versioned DMG filename: $name"
  version="${BASH_REMATCH[1]}"
  architecture="${BASH_REMATCH[3]}"
  /usr/bin/hdiutil verify "$dmg" >/dev/null || fail "DMG image verification failed"

  active_mount="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/yosh-dmg-mount.XXXXXX")"
  /usr/bin/hdiutil attach -readonly -nobrowse -noautoopen -quiet -mountpoint "$active_mount" "$dmg" >/dev/null
  local mounted_app="$active_mount/Yosh.app"
  [[ -d "$mounted_app" && -L "$active_mount/Applications" ]] || fail "DMG must contain Yosh.app and an Applications shortcut"
  [[ "$(/usr/bin/readlink "$active_mount/Applications")" == /Applications ]] || fail "Applications shortcut has an unexpected destination"
  [[ "$(plist_value "$mounted_app" CFBundleShortVersionString)" == "$version" ]] || fail "DMG filename and app version differ"
  [[ "$(/usr/bin/lipo -archs "$mounted_app/Contents/MacOS/Yosh")" == "$architecture" ]] || fail "DMG filename and app architecture differ"
  min_version="$(plist_value "$mounted_app" LSMinimumSystemVersion)"
  assert_clean_bundle "$mounted_app" >/dev/null
  /usr/bin/codesign --verify --deep --strict "$mounted_app" >/dev/null || fail "App signature verification failed"

  if ((must_notarized)); then
    /usr/bin/xcrun stapler validate "$dmg" >/dev/null || fail "DMG notarization ticket is missing or invalid"
    /usr/sbin/spctl --assess --type execute --verbose=2 "$mounted_app" >/dev/null 2>&1 || fail "Gatekeeper rejected the mounted app"
  fi
  /usr/bin/hdiutil detach -quiet "$active_mount" >/dev/null
  /bin/rmdir "$active_mount"
  active_mount=""

  local checksum_name="$name.sha256"
  (cd "$(dirname "$dmg")" && /usr/bin/shasum -a 256 "$name" > "$checksum_name")
  (cd "$(dirname "$dmg")" && /usr/bin/shasum -a 256 --check "$checksum_name" >/dev/null)
  printf 'Verified %s (%s, macOS %s+)\n' "$dmg" "$architecture" "$min_version"
  printf 'SHA-256: %s\n' "$(awk '{print $1}' "$(dirname "$dmg")/$checksum_name")"
}

if [[ -n "$verify_dmg" ]]; then
  verify_dmg "$verify_dmg" "$require_notarized"
  exit 0
fi
((require_notarized == 0)) || fail "--require-notarized is only valid with --verify"
[[ "$(uname -s)" == Darwin ]] || fail "DMG packaging requires macOS"
[[ -d "$app" ]] || fail "Build the Release app first: $app"

version="$(plist_value "$app" CFBundleShortVersionString)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Expected a stable semantic app version; found $version"
architecture="$(assert_clean_bundle "$app")"
/usr/bin/codesign --verify --deep --strict "$app" >/dev/null || fail "Production app signature verification failed"

if [[ -n "$identity" ]]; then
  signing_details="$(read_signing_details "$app")"
  [[ "$signing_details" == *"Authority=Developer ID Application:"* && "$signing_details" == *"TeamIdentifier="* ]] \
    || fail "The app must already have a Developer ID signature before signing the DMG"
fi

/bin/mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
stage="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/yosh-dmg-stage.XXXXXX")"
release_label=""
volume_label="Yosh $version $architecture"
if ((beta)); then
  release_label="-beta"
  volume_label="Yosh $version Beta $architecture"
fi
temporary_dmg="$output_dir/.Yosh-$version$release_label-$architecture.$$.dmg"
/usr/bin/ditto "$app" "$stage/Yosh.app"
/bin/ln -s /Applications "$stage/Applications"
/usr/bin/hdiutil create -ov -srcfolder "$stage" -volname "$volume_label" \
  -fs HFS+ -format UDZO -imagekey zlib-level=9 "$temporary_dmg" >/dev/null

dmg="$output_dir/Yosh-$version$release_label-$architecture.dmg"
if [[ -n "$identity" ]]; then /usr/bin/codesign --force --timestamp --sign "$identity" "$temporary_dmg" >/dev/null; fi
/usr/bin/hdiutil verify "$temporary_dmg" >/dev/null || fail "Newly created DMG failed image verification"
/bin/mv -f "$temporary_dmg" "$dmg"
verify_dmg "$dmg" 0
