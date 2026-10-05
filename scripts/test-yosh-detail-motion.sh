#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture_directory="$(mktemp -d "${TMPDIR:-/tmp}/yosh-detail-motion.XXXXXX")"
trap 'rm -rf "$fixture_directory"' EXIT
cd "$repository_root"

motion_sources=(
  apps/macos/2049/2049App/Views/Card/BackSection.swift
  apps/macos/2049/2049App/Views/Card/YoshTabMotion.swift
  apps/macos/2049/2049App/Views/Card/YoshDetailNavigation.swift
  apps/macos/2049/2049App/Views/Card/YoshDetailStack.swift
  apps/macos/2049/2049App/Views/Card/YoshDetailPage.swift
)
xcrun swiftc -parse-as-library -swift-version 6 "${motion_sources[@]}" \
  apps/macos/2049/tests/DetailNavigationMotionTest.swift -o "$fixture_directory/DetailNavigationMotionTest"
"$fixture_directory/DetailNavigationMotionTest"

app_sources=()
while IFS= read -r source; do
  app_sources+=("$source")
done < <(rg --files apps/macos/2049/2049App -g '*.swift' -g '!TwentyFortyNineApp.swift')
for fixture in DetailScrollStabilityTest AuthorityDetailViewTest PurchaseDetailViewTest ActivityLedgerViewTest MembersRosterViewTest; do
  xcrun swiftc -parse-as-library -swift-version 6 "${app_sources[@]}" \
    "apps/macos/2049/tests/$fixture.swift" -o "$fixture_directory/$fixture"
  "$fixture_directory/$fixture"
done
