import Foundation

@main
struct ManagementTransportSecurity {
    static func main() async throws {
        let port = ProcessInfo.processInfo.environment["APP2049_PORT"]!
        let secret = ProcessInfo.processInfo.environment["APP2049_MANAGEMENT_TOKEN"]!
        let configuration = ServiceConfiguration(baseURL: URL(string: "http://127.0.0.1:\(port)")!, managementToken: secret)
        let mode = CommandLine.arguments.dropFirst().first ?? "fake"
        if mode == "lifecycle-normal" || mode == "lifecycle-hold" {
            let runtime = NativeServiceRuntime(environment: ProcessInfo.processInfo.environment, managementTokenOverride: secret)
            let ready = try await runtime.ready()
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

    private struct Health: Decodable { let pid: Int32 }
}
