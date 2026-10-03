#!/bin/bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
temporary="$(mktemp -d "${TMPDIR:-/tmp}/2049-launch-test.XXXXXX")"
trap 'rm -rf "$temporary"' EXIT
cd "$repository_root"

swiftc -swift-version 6 -parse-as-library \
  apps/macos/2049/2049App/Services/BackendChildProcess.swift \
  apps/macos/2049/2049App/Services/BackendLaunchConfiguration.swift \
  apps/macos/2049/2049App/Services/ManagementTransport.swift \
  apps/macos/2049/2049App/Services/NativeServiceRuntime.swift \
  tests/native/BackendLaunchConfigurationTest.swift \
  -o "$temporary/backend-launch-test"
"$temporary/backend-launch-test"
