#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture_directory="$(mktemp -d "${TMPDIR:-/tmp}/yosh-tab-motion.XXXXXX")"
trap 'rm -rf "$fixture_directory"' EXIT
cd "$repository_root"

motion_sources=(
  apps/macos/Yosh/YoshApp/Views/Card/BackSection.swift
  apps/macos/Yosh/YoshApp/Views/Card/BackNavigation.swift
  apps/macos/Yosh/YoshApp/Views/Card/YoshTabMotion.swift
  apps/macos/Yosh/YoshApp/Views/Card/YoshTabPage.swift
)
for fixture in BackNavigationHitTest TopLevelTabMotionTest; do
  xcrun swiftc -parse-as-library -swift-version 6 "${motion_sources[@]}" \
    "apps/macos/Yosh/tests/$fixture.swift" -o "$fixture_directory/$fixture"
  "$fixture_directory/$fixture"
done

# Exercise the real Members and Settings bodies, including their native scroll views.
app_sources=()
while IFS= read -r source; do
  app_sources+=("$source")
done < <(rg --files apps/macos/Yosh/YoshApp -g '*.swift' -g '!YoshApp.swift')
xcrun swiftc -parse-as-library -swift-version 6 "${app_sources[@]}" \
  apps/macos/Yosh/tests/TabScrollStabilityTest.swift -o "$fixture_directory/TabScrollStabilityTest"
"$fixture_directory/TabScrollStabilityTest"
