import Foundation

@main
struct BackendLaunchConfigurationTest {
    static func main() throws {
        let manager = FileManager.default
        let temporary = manager.temporaryDirectory.appending(path: "2049-launch-\(UUID().uuidString)")
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

        let installedApp = temporary.appending(path: "Applications/2049.app")
        try manager.createDirectory(at: installedApp.appending(path: "Contents"), withIntermediateDirectories: true)
        let info: [String: String] = [
            "CFBundleIdentifier": "com.twentyfortynine.launch-test",
            "CFBundlePackageType": "APPL",
            "APP2049RepositoryRoot": root.path,
            "APP2049NodeExecutable": node.path,
        ]
        try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
            .write(to: installedApp.appending(path: "Contents/Info.plist"))

        // Finder has no repository cwd or shell PATH. The installed bundle must supply both paths.
        let installed = BackendLaunchConfiguration(environment: ["PATH": "/usr/bin:/bin"], bundleURL: installedApp)
        guard try installed.repositoryRoot().path == root.path, try installed.nodeExecutable().path == node.path else {
            throw Failure.failed("Installed app did not resolve its local backend and Node")
        }

        let development = BackendLaunchConfiguration(environment: [:], bundleURL: root.appending(path: "build/macos/Build/Products/Debug/2049.app"))
        guard try development.repositoryRoot().path == root.path else {
            throw Failure.failed("Repository build discovery regressed")
        }
        let overrides = BackendLaunchConfiguration(environment: [
            "APP2049_REPOSITORY_ROOT": overrideRoot.path,
            "APP2049_NODE_PATH": "/bin/sh",
        ], bundleURL: installedApp)
        guard try overrides.repositoryRoot().path == overrideRoot.path,
              try overrides.nodeExecutable().path == "/bin/sh" else {
            throw Failure.failed("Development environment overrides lost precedence")
        }

        // Moving/removing the external repository must produce a configuration error.
        try manager.removeItem(at: root)
        do {
            _ = try installed.repositoryRoot()
            throw Failure.failed("Missing external repository was accepted")
        } catch ServiceRuntimeError.configuration { }
        print("Backend launch configuration passed: installed paths, spaces, development discovery, overrides, missing repository")
    }

    private enum Failure: Error {
        case failed(String)
    }
}
