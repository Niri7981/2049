import Foundation

/// Owns the child process mechanics; NativeServiceRuntime decides when it is safe to stop.
final class BackendChildProcess {
    private let process: Process

    init(node: URL, next: URL, root: URL, port: Int, environment: [String: String], onExit: @escaping @Sendable (Int32) -> Void) {
        let child = Process()
        child.executableURL = node
        child.arguments = [next.path, "start", "--hostname", "127.0.0.1", "--port", String(port)]
        child.currentDirectoryURL = root
        child.environment = environment
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        child.terminationHandler = { terminated in onExit(terminated.processIdentifier) }
        self.process = child
    }

    var isRunning: Bool { process.isRunning }
    var processIdentifier: Int32 { process.processIdentifier }

    func run() throws {
        do { try process.run() }
        catch { throw ServiceRuntimeError.cannotStart }
    }

    func terminateIfRunning() {
        if process.isRunning { process.terminate() }
    }
}
