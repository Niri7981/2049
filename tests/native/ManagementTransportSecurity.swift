import Foundation
import Synchronization

@main
struct ManagementTransportSecurity {
    static func main() async throws {
        let port = ProcessInfo.processInfo.environment["APP2049_PORT"]!
        let secret = ProcessInfo.processInfo.environment["APP2049_MANAGEMENT_TOKEN"]!
        let configuration = ServiceConfiguration(baseURL: URL(string: "http://127.0.0.1:\(port)")!, managementToken: secret)
        let mode = CommandLine.arguments.dropFirst().first ?? "fake"
        if mode == "credential-cache" {
            let loads = Mutex(0)
            let runtime = NativeServiceRuntime(environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: { loads.withLock { $0 += 1 }; return secret })
            async let first: Void = expectPortConflict(runtime)
            async let second: Void = expectPortConflict(runtime)
            _ = try await (first, second)
            precondition(loads.withLock { $0 } == 1, "concurrent readiness must share one credential load")
            try await expectPortConflict(runtime, retry: true)
            precondition(loads.withLock { $0 } == 1, "backend readiness retry must reuse the loaded credential")

            let diagnosticLoads = Mutex(0)
            let diagnostic = NativeServiceRuntime(allowsLaunch: false,
                environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: { diagnosticLoads.withLock { $0 += 1 }; return secret })
            do { _ = try await diagnostic.ready(); fatalError("Read-only runtime used the installation credential") }
            catch ServiceRuntimeError.unavailable { }
            precondition(diagnosticLoads.withLock { $0 } == 0, "previews/diagnostics must not load Keychain credentials")

            let invalidLaunchLoads = Mutex(0)
            let invalidLaunch = NativeServiceRuntime(environment: [:], bundleURL: URL(fileURLWithPath: "/dev/null"),
                managementTokenLoader: { invalidLaunchLoads.withLock { $0 += 1 }; return secret })
            do { _ = try await invalidLaunch.ready(); fatalError("Missing repository was accepted") }
            catch ServiceRuntimeError.configuration { }
            precondition(invalidLaunchLoads.withLock { $0 } == 0, "invalid launch configuration must fail before Keychain access")
            print("Credential cache, concurrent readiness, retries and no-secret diagnostics passed")
            return
        }
        if mode == "credential-denied" || mode == "credential-invalid" {
            let loads = Mutex(0)
            let runtime = NativeServiceRuntime(environment: ProcessInfo.processInfo.environment,
                managementTokenLoader: {
                    let count = loads.withLock { $0 += 1; return $0 }
                    if count == 1 {
                        if mode == "credential-denied" { throw ServiceRuntimeError.configuration }
                        return "invalid"
                    }
                    return secret
                })
            do { _ = try await runtime.ready(); fatalError("Denied/invalid credential was accepted") }
            catch ServiceRuntimeError.configuration { }
            do { _ = try await runtime.ready(); fatalError("Failure was silently retried") }
            catch ServiceRuntimeError.configuration { }
            precondition(loads.withLock { $0 } == 1)
            try await expectPortConflict(runtime, retry: true)
            try await expectPortConflict(runtime, retry: true)
            precondition(loads.withLock { $0 } == 2, "only a successful validated load may be cached")
            print("\(mode): explicit retry recovers without replacing or repeatedly reading the credential")
            return
        }
        if mode == "lifecycle-normal" || mode == "lifecycle-hold" {
            let loads = Mutex(0)
            let runtime = NativeServiceRuntime(environment: ProcessInfo.processInfo.environment,
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
            let runtime = NativeServiceRuntime(allowsLaunch: false, environment: ProcessInfo.processInfo.environment, managementTokenOverride: secret)
            do { _ = try await runtime.ready(); fatalError("Fake owner was accepted") }
            catch ServiceRuntimeError.portConflict { print("Fake owner rejected") }
            return
        }
        if mode == "normal" {
            let loads = Mutex(0)
            let runtime = NativeServiceRuntime(allowsLaunch: false, environment: ProcessInfo.processInfo.environment,
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
