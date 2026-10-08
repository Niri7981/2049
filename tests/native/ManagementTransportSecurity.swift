import Foundation
import Darwin
import Synchronization

@main
struct ManagementTransportSecurity {
    static func main() async throws {
        let launch = BackendLaunchConfiguration(environment: ProcessInfo.processInfo.environment, bundleURL: Bundle.main.bundleURL)
        let port = try launch.configuredValue("PORT")!
        let secret = try launch.configuredValue("MANAGEMENT_TOKEN")!
        let configuration = ServiceConfiguration(baseURL: URL(string: "http://127.0.0.1:\(port)")!, managementToken: secret)
        let mode = CommandLine.arguments.dropFirst().first ?? "fake"
        let bundle = ProcessInfo.processInfo.environment["YOSH_TEST_BUNDLE_URL"].map { URL(fileURLWithPath: $0) } ?? Bundle.main.bundleURL
        let logs = URL(fileURLWithPath: try launch.configuredValue("DATA_DIR")!).appending(path: "logs")
        func makeRuntime(allowsLaunch: Bool = true, environment: [String: String] = ProcessInfo.processInfo.environment,
            bundleURL: URL? = nil, managementTokenOverride: String? = nil,
            managementTokenLoader: (@Sendable () throws -> String)? = nil) -> NativeServiceRuntime {
            NativeServiceRuntime(allowsLaunch: allowsLaunch, environment: environment, bundleURL: bundleURL ?? bundle,
                managementTokenOverride: managementTokenOverride, managementTokenLoader: managementTokenLoader,
                diagnosticsDirectory: logs)
        }
        if mode.hasPrefix("supervisor-") {
            let loads = Mutex(0)
            let runtime = makeRuntime(managementTokenLoader: { loads.withLock { $0 += 1 }; return secret })
            let began = ContinuousClock.now
            let starting = Task { try await runtime.ready() }
            if mode == "supervisor-loop" {
                do { _ = try await starting.value; fatalError("Crashing fixture became ready") }
                catch ServiceRuntimeError.processExited { }
                let deadline = ContinuousClock.now.advanced(by: .seconds(50))
                while ContinuousClock.now < deadline {
                    if await runtime.status().failure == .restartLimitReached { break }
                    try await Task.sleep(for: .milliseconds(200))
                }
                let final = await runtime.status()
                precondition(final.failure == .restartLimitReached)
                do { _ = try await runtime.ready(); fatalError("Polling bypassed restart limit") }
                catch ServiceRuntimeError.restartLimitReached { }
                let stopped = await runtime.shutdown()
                precondition(stopped)
                print("Persistent crash loop bounded; normal polling cannot spawn more children")
                return
            }
            if mode == "supervisor-core-delay" {
                try await Task.sleep(for: .seconds(2))
                let status = await runtime.status()
                precondition(status.phase == .managementAuthenticated && status.pid != nil)
            }
            if mode == "supervisor-config" {
                do { _ = try await starting.value; fatalError("Invalid core configuration was accepted") }
                catch ServiceRuntimeError.configuration { }
                let stopped = await runtime.shutdown()
                precondition(stopped, "authenticated pre-core shutdown must work")
                print("Persistent configuration rejected without a restart loop; pre-core shutdown passed")
                return
            }
            let configuration = try await starting.value
            if mode == "supervisor-delay" || mode == "supervisor-core-delay" {
                precondition(began.duration(to: .now) > .seconds(10), "fixture must exceed the old kill window")
            }
            let initial = await runtime.status()
            precondition(initial.phase == .coreReady && initial.wallet == .walletChecking && initial.recovery == .recoveryRunning)
            let oldPID = initial.pid!
            print("Backend PID \(oldPID)")
            if mode == "supervisor-restart" {
                precondition(Darwin.kill(oldPID, SIGKILL) == 0) // Test-owned fixture; no wallet or payments.
                let deadline = ContinuousClock.now.advanced(by: .seconds(15))
                var recovered = false
                while ContinuousClock.now < deadline {
                    let status = await runtime.status()
                    if let pid = status.pid, pid != oldPID, status.phase == .coreReady {
                        print("Recovered backend PID \(pid)")
                        recovered = true
                        break
                    }
                    try await Task.sleep(for: .milliseconds(100))
                }
                precondition(recovered, "backend must restart automatically without calling ready again")
                precondition(loads.withLock { $0 } == 1, "recovery must reuse the cached management identity")
            }
            _ = try await configuration.request(.health, timeout: 2)
            let stopped = await runtime.shutdown()
            precondition(stopped)
            print("\(mode): progressive readiness, independent wallet/recovery and clean shutdown passed")
            return
        }
        if mode == "credential-cache" {
            let loads = Mutex(0)
            let runtime = makeRuntime(environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: { loads.withLock { $0 += 1 }; return secret })
            async let first: Void = expectPortConflict(runtime)
            async let second: Void = expectPortConflict(runtime)
            _ = try await (first, second)
            precondition(loads.withLock { $0 } == 1, "concurrent readiness must share one credential load")
            try await expectPortConflict(runtime, retry: true)
            precondition(loads.withLock { $0 } == 1, "backend readiness retry must reuse the loaded credential")

            let diagnosticLoads = Mutex(0)
            let diagnostic = makeRuntime(allowsLaunch: false,
                environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: { diagnosticLoads.withLock { $0 += 1 }; return secret })
            do { _ = try await diagnostic.ready(); fatalError("Read-only runtime used the installation credential") }
            catch ServiceRuntimeError.unavailable { }
            precondition(diagnosticLoads.withLock { $0 } == 0, "previews/diagnostics must not load Keychain credentials")

            let invalidLaunchLoads = Mutex(0)
            let invalidLaunch = makeRuntime(environment: [:], bundleURL: URL(fileURLWithPath: "/dev/null"),
                managementTokenLoader: { invalidLaunchLoads.withLock { $0 += 1 }; return secret })
            do { _ = try await invalidLaunch.ready(); fatalError("Missing repository was accepted") }
            catch ServiceRuntimeError.configuration { }
            precondition(invalidLaunchLoads.withLock { $0 } == 0, "invalid launch configuration must fail before Keychain access")
            let conflictingLoads = Mutex(0)
            var conflictingEnvironment = ProcessInfo.processInfo.environment
            conflictingEnvironment["YOSH_MANAGEMENT_TOKEN"] = "conflicting-ambient-value"
            conflictingEnvironment["APP2049_MANAGEMENT_TOKEN"] = secret
            let conflicting = makeRuntime(environment: conflictingEnvironment,
                managementTokenLoader: { conflictingLoads.withLock { $0 += 1 }; return secret })
            do { _ = try await conflicting.ready(); fatalError("Conflicting ambient tokens were accepted") }
            catch ServiceRuntimeError.configuration { }
            precondition(conflictingLoads.withLock { $0 } == 0, "alias conflicts must fail before Keychain access or backend takeover")
            print("Credential cache, concurrent readiness, retries, alias conflicts and no-secret diagnostics passed")
            return
        }
        if mode == "credential-denied" || mode == "credential-invalid" {
            let loads = Mutex(0)
            let runtime = makeRuntime(environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: {
                    let count = loads.withLock { $0 += 1; return $0 }
                    if count == 1 {
                        if mode == "credential-denied" { throw ServiceRuntimeError.configuration }
                        return "invalid"
                    }
                    return secret
                })
            do { _ = try await runtime.ready(); fatalError("Denied/invalid credential was accepted") }
            catch ServiceRuntimeError.credentialUnavailable where mode == "credential-denied" { }
            catch ServiceRuntimeError.configuration where mode == "credential-invalid" { }
            if mode == "credential-invalid" {
                do { _ = try await runtime.ready(); fatalError("Invalid credential was silently retried") }
                catch ServiceRuntimeError.configuration { }
                precondition(loads.withLock { $0 } == 1)
            } else {
                do { _ = try await runtime.ready(); fatalError("Credential cooldown was bypassed") }
                catch ServiceRuntimeError.credentialUnavailable { }
                precondition(loads.withLock { $0 } == 1, "normal polling must not repeat a denied Keychain prompt")
            }
            try await expectPortConflict(runtime, retry: true)
            try await expectPortConflict(runtime, retry: true)
            precondition(loads.withLock { $0 } == 2, "only a successful validated load may be cached")
            print("\(mode): explicit retry recovers without replacing or repeatedly reading the credential")
            return
        }
        if mode == "lifecycle-normal" || mode == "lifecycle-hold" {
            let loads = Mutex(0)
            let runtime = makeRuntime(environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: { loads.withLock { $0 += 1 }; return secret })
            let ready = try await runtime.ready()
            _ = try await runtime.ready()
            _ = try await runtime.ready(retry: true)
            precondition(loads.withLock { $0 } == 1, "authenticated readiness must not re-read Keychain")
            let (body, _) = try await ready.request(.health, timeout: 2)
            let health = try JSONDecoder().decode(Health.self, from: body)
            FileHandle.standardOutput.write(Data("Backend PID \(health.pid)\n".utf8))
            if mode == "lifecycle-hold" {
                while true { try await Task.sleep(for: .seconds(60)) }
            }
            let stopped = await runtime.shutdown()
            precondition(stopped, "normal quit must drain and stop the backend")
            print("Normal lifecycle passed")
            return
        }
        if mode == "fake-owner" {
            let runtime = makeRuntime(allowsLaunch: false, environment: ProcessInfo.processInfo.environment, managementTokenOverride: secret)
            do { _ = try await runtime.ready(); fatalError("Fake owner was accepted") }
            catch ServiceRuntimeError.portConflict { print("Fake owner rejected") }
            return
        }
        if mode == "normal" {
            let loads = Mutex(0)
            let runtime = makeRuntime(allowsLaunch: false, environment: ProcessInfo.processInfo.environment,
                managementTokenOverride: secret, managementTokenLoader: { loads.withLock { $0 += 1 }; return secret })
            _ = try await runtime.ready()
            _ = try await runtime.ready(retry: true)
            precondition(loads.withLock { $0 } == 0, "fixture diagnostics must use their supplied credential")
            _ = try await configuration.request(.health, timeout: 2)
            _ = try await configuration.request(.prepareQuit, timeout: 2)
            print("Authenticated request and response passed")
            return
        }
        let started = ContinuousClock.now
        do {
            _ = try await configuration.request(.health, timeout: 0.4)
            fatalError("Unauthenticated listener was accepted")
        } catch ServiceRuntimeError.authenticationFailed {
            precondition(["fake", "tamper", "status", "nonce"].contains(mode))
            print("\(mode) response rejected")
        } catch ServiceRuntimeError.requestTimedOut {
            precondition(mode == "drip" || mode == "stall")
            precondition(started.duration(to: .now) < .seconds(1.5))
            print("Absolute deadline passed")
        } catch ServiceRuntimeError.responseTooLarge {
            precondition(mode == "oversized" || mode == "content-length")
            precondition(started.duration(to: .now) < .seconds(1.5))
            print("Streaming response limit passed")
        }
    }

    private static func expectPortConflict(_ runtime: NativeServiceRuntime, retry: Bool = false) async throws {
        do { _ = try await runtime.ready(retry: retry); fatalError("Unauthenticated backend was accepted") }
        catch ServiceRuntimeError.portConflict { }
    }

    private struct Health: Decodable { let pid: Int32 }
}
