import Foundation

@main
struct BackendLaunchConfigurationTest {
    static func main() throws {
        let manager = FileManager.default
        let temporary = manager.temporaryDirectory.appending(path: "yosh-launch-\(UUID().uuidString)")
        try manager.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }

        func repository(_ name: String) throws -> URL {
            let root = temporary.appending(path: name)
            try manager.createDirectory(at: root.appending(path: "node_modules/next/dist/bin"), withIntermediateDirectories: true)
            try Data("{}".utf8).write(to: root.appending(path: "package.json"))
            try Data().write(to: root.appending(path: "node_modules/next/dist/bin/next"))
            return root
        }

        let root = try repository("Repository with spaces")
        let overrideRoot = try repository("Development override")
        let node = temporary.appending(path: "Node runtime/node")
        try manager.createDirectory(at: node.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: node)
        try manager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)

        func app(_ name: String, hints: [String: String]) throws -> URL {
            let url = temporary.appending(path: "Applications/\(name).app")
            try manager.createDirectory(at: url.appending(path: "Contents"), withIntermediateDirectories: true)
            var info = hints
            info["CFBundleIdentifier"] = "com.yosh.launch-test.\(name)"
            info["CFBundlePackageType"] = "APPL"
            try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
                .write(to: url.appending(path: "Contents/Info.plist"))
            return url
        }
        let installedApp = try app("Yosh", hints: ["YoshRepositoryRoot": root.path, "YoshNodeExecutable": node.path])

        // Finder has no repository cwd or shell PATH. The installed bundle must supply both paths.
        let installed = BackendLaunchConfiguration(environment: ["PATH": "/usr/bin:/bin"], bundleURL: installedApp)
        guard try installed.repositoryRoot().path == root.path, try installed.nodeExecutable().path == node.path else {
            throw Failure.failed("Installed app did not resolve its local backend and Node")
        }

        let legacyApp = try app("Legacy", hints: ["APP2049RepositoryRoot": root.path, "APP2049NodeExecutable": node.path])
        let legacy = BackendLaunchConfiguration(environment: [:], bundleURL: legacyApp)
        guard try legacy.repositoryRoot().path == root.path, try legacy.nodeExecutable().path == node.path else {
            throw Failure.failed("Legacy installed path hints were not preserved")
        }
        let sharedApp = try app("Shared", hints: ["YoshRepositoryRoot": root.path, "APP2049RepositoryRoot": root.path,
            "YoshNodeExecutable": node.path, "APP2049NodeExecutable": node.path])
        guard try BackendLaunchConfiguration(environment: [:], bundleURL: sharedApp).repositoryRoot().path == root.path else {
            throw Failure.failed("Equal installed path aliases were rejected")
        }
        for hints in [
            ["YoshRepositoryRoot": overrideRoot.path, "APP2049RepositoryRoot": root.path],
            ["YoshNodeExecutable": "/bin/sh", "APP2049NodeExecutable": node.path],
        ] {
            let conflictingApp = try app("Conflict-\(UUID().uuidString)", hints: hints)
            let configuration = BackendLaunchConfiguration(environment: [:], bundleURL: conflictingApp)
            try rejectsConfiguration {
                if hints["YoshNodeExecutable"] != nil { _ = try configuration.nodeExecutable() }
                else { _ = try configuration.repositoryRoot() }
            }
        }

        let development = BackendLaunchConfiguration(environment: [:], bundleURL: root.appending(path: "build/macos/Build/Products/Debug/Yosh.app"))
        guard try development.repositoryRoot().path == root.path else {
            throw Failure.failed("Repository build discovery regressed")
        }
        for prefix in ["YOSH_", "APP2049_"] {
            let overrides = BackendLaunchConfiguration(environment: [
                "\(prefix)REPOSITORY_ROOT": overrideRoot.path, "\(prefix)NODE_PATH": "/bin/sh",
                "\(prefix)PORT": "4011", "\(prefix)DATA_DIR": temporary.path,
            ], bundleURL: installedApp)
            guard try overrides.repositoryRoot().path == overrideRoot.path,
                  try overrides.nodeExecutable().path == "/bin/sh", try overrides.servicePort() == 4011,
                  try overrides.dataDirectory().resolvingSymlinksInPath().path == temporary.resolvingSymlinksInPath().path else {
                throw Failure.failed("Canonical/legacy overrides lost precedence")
            }
        }
        let defaults = BackendLaunchConfiguration(environment: [:], bundleURL: installedApp)
        let legacyDirectory = manager.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/2049")
        guard try defaults.dataDirectory().path == legacyDirectory.resolvingSymlinksInPath().path else {
            throw Failure.failed("Rename created a different default ledger location")
        }
        for suffix in ["PORT", "REPOSITORY_ROOT", "NODE_PATH", "DATA_DIR", "MANAGEMENT_TOKEN", "ENABLE_DEVNET_PURCHASES"] {
            let conflict = BackendLaunchConfiguration(environment: ["YOSH_\(suffix)": "new", "APP2049_\(suffix)": "old"], bundleURL: installedApp)
            try rejectsConfiguration { _ = try conflict.servicePort() }
            try rejectsConfiguration { _ = try conflict.childEnvironment(token: String(repeating: "k", count: 43)) }
        }
        try rejectsConfiguration {
            _ = try BackendLaunchConfiguration(environment: ["YOSH_DATA_DIR": "relative/data"], bundleURL: installedApp).dataDirectory()
        }
        let child = try BackendLaunchConfiguration(environment: ["YOSH_MANAGEMENT_TOKEN": "ignored-ambient-value",
            "APP2049_PORT": "4011", "YOSH_DATA_DIR": temporary.path], bundleURL: installedApp)
            .childEnvironment(token: String(repeating: "k", count: 43))
        guard child["YOSH_MANAGEMENT_TOKEN"] == String(repeating: "k", count: 43),
              child["APP2049_MANAGEMENT_TOKEN"] == child["YOSH_MANAGEMENT_TOKEN"],
              child["YOSH_DATA_DIR"] == child["APP2049_DATA_DIR"], child["YOSH_PORT"] == "4011" else {
            throw Failure.failed("Child lost its one installation token or alias compatibility")
        }

        let current = BackendHealth(ready: true, service: "Yosh", pid: 123, dataDirectory: temporary.path)
        let previous = BackendHealth(ready: true, service: "2049", pid: 123, dataDirectory: temporary.path)
        guard current.matchesNewChild(pid: 123, directory: temporary.path), current.matchesTakeover(directory: temporary.path),
              previous.matchesTakeover(directory: temporary.path), !previous.matchesNewChild(pid: 123, directory: temporary.path),
              !current.matchesNewChild(pid: 124, directory: temporary.path),
              !previous.matchesTakeover(directory: overrideRoot.path),
              !BackendHealth(ready: true, service: "unrelated", pid: 123, dataDirectory: temporary.path).matchesTakeover(directory: temporary.path),
              !BackendHealth(ready: true, service: "2049", pid: 0, dataDirectory: temporary.path).matchesTakeover(directory: temporary.path),
              !BackendHealth(ready: false, service: "Yosh", pid: 123, dataDirectory: temporary.path).matchesTakeover(directory: temporary.path) else {
            throw Failure.failed("Backend rename weakened health identity checks")
        }

        // Moving/removing the external repository must produce a configuration error.
        try manager.removeItem(at: root)
        do {
            _ = try installed.repositoryRoot()
            throw Failure.failed("Missing external repository was accepted")
        } catch ServiceRuntimeError.configuration { }
        print("Backend launch configuration passed: Yosh/legacy paths and environment, conflicts, one ledger/token, new-child and takeover identity checks")
    }

    private enum Failure: Error {
        case failed(String)
    }

    private static func rejectsConfiguration(_ operation: () throws -> Void) throws {
        do {
            try operation()
            throw Failure.failed("Conflicting/invalid configuration was accepted")
        } catch ServiceRuntimeError.configuration { }
    }
}
