#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture_directory="$(mktemp -d "${TMPDIR:-/tmp}/yosh-tab-motion.XXXXXX")"
trap 'rm -rf "$fixture_directory"' EXIT
cd "$repository_root"

motion_sources=(
  apps/macos/2049/2049App/Views/Card/BackSection.swift
  apps/macos/2049/2049App/Views/Card/BackNavigation.swift
  apps/macos/2049/2049App/Views/Card/YoshTabMotion.swift
  apps/macos/2049/2049App/Views/Card/YoshTabPage.swift
)
for fixture in BackNavigationHitTest TopLevelTabMotionTest; do
  xcrun swiftc -parse-as-library -swift-version 6 "${motion_sources[@]}" \
    "apps/macos/2049/tests/$fixture.swift" -o "$fixture_directory/$fixture"
  "$fixture_directory/$fixture"
done

# Exercise the real Members and Settings bodies, including their native scroll views.
app_sources=()
while IFS= read -r source; do
  app_sources+=("$source")
done < <(rg --files apps/macos/2049/2049App -g '*.swift' -g '!TwentyFortyNineApp.swift')
xcrun swiftc -parse-as-library -swift-version 6 "${app_sources[@]}" \
  apps/macos/2049/tests/TabScrollStabilityTest.swift -o "$fixture_directory/TabScrollStabilityTest"
"$fixture_directory/TabScrollStabilityTest"
