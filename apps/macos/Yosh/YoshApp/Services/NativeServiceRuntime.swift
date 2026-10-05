import Darwin
import Foundation
import os

enum ServiceRuntimeError: Error {
    case configuration
    case portConflict
    case authenticatedShutdownFailed
    case authenticatedShutdownTimedOut
    case authenticationFailed
    case requestTimedOut
    case responseTooLarge
    case cannotStart
    case notReady
    case processExited
    case dataDirectoryInUse
    case unavailable
}

extension Notification.Name {
    static let nativeServiceExited = Notification.Name("Yosh.nativeServiceExited")
}

/// Only a backend authenticated with this installation's management identity may be stopped.
actor NativeServiceRuntime {
    private let launch: BackendLaunchConfiguration
    private let allowsLaunch: Bool
    private let managementTokenOverride: String?
    private let managementTokenLoader: (@Sendable () throws -> String)?
    private let logger = Logger(subsystem: "com.yosh.macos", category: "backend-lifecycle")
    private var process: BackendChildProcess?
    private var ownedConfiguration: ServiceConfiguration?
    private var readyConfiguration: ServiceConfiguration?
    private var loadedManagementToken: String?
    private var startup: Task<ServiceConfiguration, Error>?
    private var lastFailure: ServiceRuntimeError?
    private var isShuttingDown = false

    init(
        allowsLaunch: Bool = true,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundleURL: URL = Bundle.main.bundleURL,
        managementTokenOverride: String? = nil,
        managementTokenLoader: (@Sendable () throws -> String)? = nil
    ) {
        self.allowsLaunch = allowsLaunch
        self.launch = BackendLaunchConfiguration(environment: environment, bundleURL: bundleURL)
        self.managementTokenOverride = managementTokenOverride
        self.managementTokenLoader = managementTokenLoader
    }

    func ready(retry: Bool = false) async throws -> ServiceConfiguration {
        if isShuttingDown { throw ServiceRuntimeError.unavailable }
        if retry && process == nil { readyConfiguration = nil }
        if let readyConfiguration {
            if process == nil || process?.isRunning == true { return readyConfiguration }
            self.readyConfiguration = nil
            lastFailure = .processExited
        }
        if retry { lastFailure = nil }
        if let lastFailure { throw lastFailure }
        if let startup { return try await startup.value }

        let task = Task { try await start() }
        startup = task
        do {
            let configuration = try await task.value
            guard process == nil || process?.isRunning == true else { throw ServiceRuntimeError.processExited }
            readyConfiguration = configuration
            startup = nil
            return configuration
        } catch {
            startup = nil
            if let failure = error as? ServiceRuntimeError { lastFailure = failure }
            logger.error("Backend startup failed: \(String(describing: error), privacy: .public)")
            throw error
        }
    }

    private func start() async throws -> ServiceConfiguration {
        // Previews and diagnostic fixtures must supply their own identity instead
        // of requesting access to the installation's Keychain item.
        guard allowsLaunch || managementTokenOverride != nil else { throw ServiceRuntimeError.unavailable }
        let port = try launch.servicePort()
        // Validate the current runtime before asking an old backend to stop.
        let root = try launch.repositoryRoot()
        let node = try launch.nodeExecutable()
        let dataDirectory = try launch.dataDirectory().path
        let next = root.appending(path: "node_modules/next/dist/bin/next")
        guard FileManager.default.fileExists(atPath: next.path),
              FileManager.default.fileExists(atPath: root.appending(path: ".next/BUILD_ID").path) else {
            throw ServiceRuntimeError.configuration
        }
        let token = try managementToken()
        let configuration = ServiceConfiguration(baseURL: URL(string: "http://127.0.0.1:\(port)")!, managementToken: token)

        if !Self.portAvailable(port) {
            guard let (data, response) = try? await configuration.request(.health, timeout: 2),
                  response.statusCode == 200, data.count <= 4096,
                  let identity = try? JSONDecoder().decode(BackendHealth.self, from: data),
                  identity.matchesTakeover(directory: dataDirectory) else {
                logger.error("Unverified listener occupies backend port \(port, privacy: .public)")
                throw ServiceRuntimeError.portConflict
            }
            if !allowsLaunch { return configuration } // The CLI management smoke test only reads a fixture.
            logger.notice("Authenticated stale backend detected, PID \(identity.pid, privacy: .public)")
            try await stopAuthenticatedBackend(configuration, pid: identity.pid, port: port)
            logger.notice("Authenticated stale backend stopped, PID \(identity.pid, privacy: .public)")
        }
        guard allowsLaunch else { throw ServiceRuntimeError.unavailable }

        let child = BackendChildProcess(node: node, next: next, root: root, port: port,
            environment: try launch.childEnvironment(token: token)) { [weak self] pid, status in
            Task { await self?.ownedProcessExited(pid: pid, status: status) }
        }
        try child.run()
        process = child
        logger.notice("Backend spawned, PID \(child.processIdentifier, privacy: .public)")

        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < deadline {
            if !child.isRunning {
                process = nil
                throw Self.portAvailable(port) ? ServiceRuntimeError.processExited : ServiceRuntimeError.portConflict
            }
            if let (data, response) = try? await configuration.request(.health, timeout: 1) {
                if response.statusCode == 401 {
                    await stopUnreadyChild(child)
                    throw ServiceRuntimeError.authenticationFailed
                }
                if response.statusCode == 503,
                   (try? JSONDecoder().decode(ServiceErrorResponse.self, from: data).code) == "DATA_DIRECTORY_IN_USE" {
                    await stopUnreadyChild(child)
                    throw ServiceRuntimeError.dataDirectoryInUse
                }
                if response.statusCode == 200, data.count <= 4096,
                   let identity = try? JSONDecoder().decode(BackendHealth.self, from: data),
                   identity.matchesNewChild(pid: child.processIdentifier, directory: dataDirectory) {
                    ownedConfiguration = configuration
                    logger.notice("Backend ready, PID \(identity.pid, privacy: .public)")
                    return configuration
                }
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        await stopUnreadyChild(child)
        throw ServiceRuntimeError.notReady
    }

    private func managementToken() throws -> String {
        if let loadedManagementToken { return loadedManagementToken }
        let token = try managementTokenOverride ?? managementTokenLoader?() ?? launch.managementToken()
        guard launch.validToken(token) else { throw ServiceRuntimeError.configuration }
        // Backend retries/restarts reuse the same installation identity. Cache
        // only validated success; denied Keychain access remains retryable.
        loadedManagementToken = token
        return token
    }

    private func stopAuthenticatedBackend(_ configuration: ServiceConfiguration, pid: Int32, port: Int) async throws {
        let deadline = ContinuousClock.now.advanced(by: .seconds(30))
        logger.notice("Requesting graceful shutdown, PID \(pid, privacy: .public)")
        let response = try? await configuration.request(.shutdown, timeout: 15)
        if let response,
           (response.1.statusCode != 200 || response.0.count > 4096 ||
            (try? JSONDecoder().decode(ReadyResponse.self, from: response.0).ready) != true) {
            logger.error("Authenticated backend rejected shutdown, PID \(pid, privacy: .public)")
            throw ServiceRuntimeError.authenticatedShutdownFailed
        }
        while ContinuousClock.now < deadline {
            if !Self.pidExists(pid) && Self.portAvailable(port) { return }
            try? await Task.sleep(for: .milliseconds(100))
        }
        logger.error("Authenticated backend shutdown timed out, PID \(pid, privacy: .public)")
        throw ServiceRuntimeError.authenticatedShutdownTimedOut
    }

    private func ownedProcessExited(pid: Int32, status: Int32) async {
        logger.notice("Backend exited, PID \(pid, privacy: .public), status \(status, privacy: .public)")
        guard process?.processIdentifier == pid else { return }
        let wasReady = readyConfiguration != nil
        process = nil
        ownedConfiguration = nil
        readyConfiguration = nil
        if wasReady && !isShuttingDown {
            lastFailure = .processExited
            await MainActor.run { NotificationCenter.default.post(name: .nativeServiceExited, object: nil) }
        }
    }

    private func stopUnreadyChild(_ child: BackendChildProcess) async {
        child.terminateIfRunning()
        let deadline = ContinuousClock.now.advanced(by: .seconds(5))
        while child.isRunning && ContinuousClock.now < deadline { try? await Task.sleep(for: .milliseconds(100)) }
        if process?.processIdentifier == child.processIdentifier && !child.isRunning { process = nil }
    }

    /// False keeps the native App alive so it cannot silently abandon an active signer.
    func shutdown() async -> Bool {
        isShuttingDown = true
        let startupDeadline = ContinuousClock.now.advanced(by: .seconds(45))
        while startup != nil && ContinuousClock.now < startupDeadline {
            try? await Task.sleep(for: .milliseconds(100))
        }
        if startup != nil {
            logger.error("Backend startup did not settle before native quit timeout")
            isShuttingDown = false
            return false
        }
        guard let child = process, child.isRunning else { return true }
        guard let configuration = ownedConfiguration else {
            logger.error("Backend quit could not verify ownership, PID \(child.processIdentifier, privacy: .public)")
            isShuttingDown = false
            return false
        }
        do {
            try await stopAuthenticatedBackend(configuration, pid: child.processIdentifier, port: try launch.servicePort())
            process = nil
            ownedConfiguration = nil
            readyConfiguration = nil
            return true
        } catch {
            logger.error("Backend quit failed: \(String(describing: error), privacy: .public)")
            isShuttingDown = false
            return false
        }
    }

    private static func pidExists(_ pid: Int32) -> Bool {
        Darwin.kill(pid, 0) == 0 || errno == EPERM
    }

    private static func portAvailable(_ port: Int) -> Bool {
        let descriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return false }
        defer { Darwin.close(descriptor) }
        var reuse: Int32 = 1
        _ = withUnsafePointer(to: &reuse) {
            Darwin.setsockopt(descriptor, SOL_SOCKET, SO_REUSEADDR, $0, socklen_t(MemoryLayout<Int32>.size))
        }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(port).bigEndian
        address.sin_addr = in_addr(s_addr: in_addr_t(0x7f000001).bigEndian)
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0
            }
        }
        return bound && Darwin.listen(descriptor, 1) == 0
    }
}

struct BackendHealth: Decodable {
    let ready: Bool
    let service: String
    let pid: Int32
    let dataDirectory: String

    // Callers only decode these facts after request/response HMAC and nonce verification.
    // The legacy service name is permitted solely for identifying an existing backend.
    func matchesTakeover(directory: String) -> Bool {
        ready && (service == "Yosh" || service == "2049") && pid > 0 && dataDirectory == directory
    }

    func matchesNewChild(pid expectedPID: Int32, directory: String) -> Bool {
        ready && service == "Yosh" && pid > 0 && pid == expectedPID && dataDirectory == directory
    }
}

private struct ServiceErrorResponse: Decodable {
    let code: String
}
