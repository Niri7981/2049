#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/yosh-launch-test.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
cd "$repository_root"

swiftc -swift-version 6 -parse-as-library \
  apps/macos/Yosh/YoshApp/Services/BackendChildProcess.swift \
  apps/macos/Yosh/YoshApp/Services/BackendLaunchConfiguration.swift \
  apps/macos/Yosh/YoshApp/Services/ManagementTransport.swift \
  apps/macos/Yosh/YoshApp/Services/NativeServiceRuntime.swift \
  tests/native/BackendLaunchConfigurationTest.swift \
  -o "$temporary/backend-launch-test"
"$temporary/backend-launch-test"
