import Foundation

enum ServiceRuntimeError: Error {
    case configuration
    case portConflict
    case authenticationFailed
    case cannotStart
    case notReady
    case processExited
    case dataDirectoryInUse
    case unavailable
}

extension Notification.Name {
    static let nativeServiceExited = Notification.Name("2049.nativeServiceExited")
}

/// Owns only the Node process it starts. An externally authenticated service is left running.
actor NativeServiceRuntime {
    private let launch: BackendLaunchConfiguration
    private let allowsLaunch: Bool
    private var process: BackendChildProcess?
    private var ownedConfiguration: ServiceConfiguration?
    private var readyConfiguration: ServiceConfiguration?
    private var startup: Task<ServiceConfiguration, Error>?
    private var lastFailure: ServiceRuntimeError?
    private var isShuttingDown = false

    init(
        allowsLaunch: Bool = true,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        bundleURL: URL = Bundle.main.bundleURL
    ) {
        self.allowsLaunch = allowsLaunch
        self.launch = BackendLaunchConfiguration(environment: environment, bundleURL: bundleURL)
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
            throw error
        }
    }

    private func start() async throws -> ServiceConfiguration {
        guard allowsLaunch else { throw ServiceRuntimeError.unavailable }
        let port = try launch.servicePort()
        let baseURL = URL(string: "http://127.0.0.1:\(port)")!
        let providedToken = launch.environment["APP2049_MANAGEMENT_TOKEN"]
        if let providedToken, !launch.validToken(providedToken) { throw ServiceRuntimeError.configuration }

        // An existing service is reused only when this process already has its management credential.
        let probe = ServiceConfiguration(baseURL: baseURL, managementToken: providedToken ?? "")
        if let (data, response) = try? await probe.request(.health, timeout: 1) {
            if response.statusCode == 401, providedToken != nil { throw ServiceRuntimeError.authenticationFailed }
            guard response.statusCode == 200, providedToken != nil,
                  (try? JSONDecoder().decode(ReadyResponse.self, from: data).ready) == true else {
                throw ServiceRuntimeError.portConflict
            }
            return probe
        }

        let root = try launch.repositoryRoot()
        let node = try launch.nodeExecutable()
        let next = root.appending(path: "node_modules/next/dist/bin/next")
        guard FileManager.default.fileExists(atPath: next.path),
              FileManager.default.fileExists(atPath: root.appending(path: ".next/BUILD_ID").path) else {
            throw ServiceRuntimeError.configuration
        }
        let token = try providedToken ?? launch.randomToken()
        let configuration = ServiceConfiguration(baseURL: baseURL, managementToken: token)

        let child = BackendChildProcess(node: node, next: next, root: root, port: port,
            environment: launch.childEnvironment(token: token)) { [weak self] pid in
            Task { await self?.ownedProcessExited(pid: pid) }
        }
        try child.run()
        process = child

        let deadline = ContinuousClock.now.advanced(by: .seconds(10))
        while ContinuousClock.now < deadline {
            if !child.isRunning {
                process = nil
                throw ServiceRuntimeError.processExited
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
                if response.statusCode == 200,
                   (try? JSONDecoder().decode(ReadyResponse.self, from: data).ready) == true {
                    ownedConfiguration = configuration
                    return configuration
                }
            }
            try? await Task.sleep(for: .milliseconds(100))
        }
        await stopUnreadyChild(child)
        throw ServiceRuntimeError.notReady
    }

    private func ownedProcessExited(pid: Int32) async {
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
        while child.isRunning { try? await Task.sleep(for: .milliseconds(100)) }
        if process?.processIdentifier == child.processIdentifier { process = nil }
    }

    func shutdown() async {
        isShuttingDown = true
        if let startup { _ = try? await startup.value }
        guard let child = process, child.isRunning else { return }
        if let configuration = ownedConfiguration {
            // Like Electron, do not terminate an active signer until prepareQuit has drained it.
            while child.isRunning {
                if let (data, response) = try? await configuration.request(.prepareQuit, timeout: 15),
                   response.statusCode == 200,
                   (try? JSONDecoder().decode(ReadyResponse.self, from: data).ready) == true { break }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        child.terminateIfRunning()
        while child.isRunning { try? await Task.sleep(for: .milliseconds(100)) }
        process = nil
        ownedConfiguration = nil
        readyConfiguration = nil
    }
}

private struct ServiceErrorResponse: Decodable {
    let code: String
}
