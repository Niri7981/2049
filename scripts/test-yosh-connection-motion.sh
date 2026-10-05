#!/bin/bash
set -euo pipefail
repository_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture_directory="$(mktemp -d "${TMPDIR:-/tmp}/yosh-connection-motion.XXXXXX")"
trap 'rm -rf "$fixture_directory"' EXIT
cd "$repository_root"
sources=(
  apps/macos/Yosh/YoshApp/Models/AppOverview.swift
  apps/macos/Yosh/YoshApp/Models/ConnectionPresentation.swift
  apps/macos/Yosh/YoshApp/Models/ConnectionMotionFact.swift
)
for fixture in apps/macos/Yosh/tests/ConnectionMotionFactTest.swift tests/native/ConnectionPresentationTest.swift; do
  xcrun swiftc -parse-as-library -swift-version 6 "${sources[@]}" "$fixture" -o "$fixture_directory/facts"
  "$fixture_directory/facts"
done
sources+=(
  apps/macos/Yosh/YoshApp/Views/Card/BackSection.swift
  apps/macos/Yosh/YoshApp/Views/Card/YoshTabMotion.swift
  apps/macos/Yosh/YoshApp/Views/Card/ConnectionBridge.swift
  apps/macos/Yosh/YoshApp/Views/Card/AgentConnectionDetail.swift
  apps/macos/Yosh/YoshApp/Views/Card/CardPageHeader.swift
  apps/macos/Yosh/YoshApp/Materials/CardMaterial.swift
)
for fixture in ConnectionMotionViewTest ConnectionConfirmationTest; do
  xcrun swiftc -parse-as-library -swift-version 6 "${sources[@]}" "apps/macos/Yosh/tests/$fixture.swift" \
    -o "$fixture_directory/$fixture"
  "$fixture_directory/$fixture"
done
