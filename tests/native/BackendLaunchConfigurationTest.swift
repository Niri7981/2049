import Foundation

@main
struct BackendLaunchConfigurationTest {
    static func main() throws {
        func check(_ value: Bool, _ message: String = "", line: UInt = #line) { precondition(value, "line \(line): \(message)") }
        let policy = try JSONDecoder().decode(RegisterAPIRequest.Inputs.self, from: Data(#"{"query":["legacy"],"jsonBody":{"prompt":{"type":"string","required":true,"maxLength":300}}}"#.utf8))
        check(policy.query?.names == ["legacy"] && policy.jsonBody?.names == ["prompt"], "legacy and typed policies decode")
        let request = ResourceDiscoveryRequest(url: "https://unknown.example/analyze", method: "POST", headers: ["content-type": "application/json"],
            body: "{\"prompt\":\"sample\"}", requestInputs: nil, sample: nil)
        let prepare = ServiceEndpoint.prepareResource(.init(kind: "discovery", discovery: request))
        check(prepare.path == "/api/app/resources/prepare" && prepare.method == "POST" && prepare.isMutation, "local preview uses management authentication")
        let hash = String(repeating: "a", count: 64)
        var approved = request; approved.postApprovalHash = hash
        let body = try JSONSerialization.jsonObject(with: ServiceEndpoint.discoverResource(approved).body()!) as! [String: Any]
        check(body["postApprovalHash"] as? String == hash && body["body"] as? String == request.body, "approval preserves exact request")
        let grant = ServiceEndpoint.createGrant(totalLimit: "2000", singleLimit: "1000", expiresAt: 2_000_000_000_000,
            resourceId: "post", postApprovalHash: hash)
        let grantBody = try JSONSerialization.jsonObject(with: grant.body()!) as! [String: Any]
        check(grantBody["postApprovalHash"] as? String == hash, "grant confirmation carries independent scope approval")
        print("Native POST preview, concrete confirmation, typed/legacy policy and Grant transport passed")
        let manager = FileManager.default
        let temporary = manager.temporaryDirectory.appending(path: "yosh-launch-\(UUID().uuidString)")
        try manager.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? manager.removeItem(at: temporary) }
        let app = temporary.appending(path: "Applications/Yosh.app")
        let runtime = app.appending(path: "Contents/Resources/Runtime")
        let node = app.appending(path: "Contents/MacOS/YoshBackendNode")
        try manager.createDirectory(at: runtime.appending(path: "backend"), withIntermediateDirectories: true)
        try manager.createDirectory(at: node.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data().write(to: runtime.appending(path: "backend/server.js"))
        try Data().write(to: runtime.appending(path: "mcp.cjs"))
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: node)
        try manager.setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)
        let installed = BackendLaunchConfiguration(environment: ["PATH": "/usr/bin:/bin",
            "YOSH_REPOSITORY_ROOT": "/missing/developer/repository", "YOSH_NODE_PATH": "/bin/sh"], bundleURL: app)
        check(try installed.runtimeDirectory().path == runtime.path)
        check(try installed.nodeExecutable().path == node.path, "installed app must use only its bundled Node")

        let token = String(repeating: "k", count: 43)
        let isolated = BackendLaunchConfiguration(environment: ["YOSH_DATA_DIR": temporary.path,
            "APP2049_PORT": "4011", "PRIVATE_KEY": "must-not-inherit", "SOLANA_RPC_URL": "must-not-inherit",
            "YOSH_ENABLE_MAINNET_EXECUTION": "1", "YOSH_MANAGEMENT_TOKEN": "ignored"], bundleURL: app)
        let child = try isolated.childEnvironment(token: token)
        check(child["HOSTNAME"] == "127.0.0.1" && child["PORT"] == "4011")
        check(child["YOSH_MANAGEMENT_TOKEN"] == token && child["APP2049_MANAGEMENT_TOKEN"] == token)
        check(URL(fileURLWithPath: child["YOSH_DATA_DIR"]!).resolvingSymlinksInPath().path == temporary.resolvingSymlinksInPath().path)
        check(child["YOSH_PACKAGED_RUNTIME_DIR"] == runtime.path)
        check(child["PRIVATE_KEY"] == nil && child["SOLANA_RPC_URL"] == nil)
        check(child["YOSH_ENABLE_MAINNET_EXECUTION"] == nil, "ambient env must not enable Mainnet")
        check(child["X402_FACILITATOR_URL"] == nil, "ambient facilitator must not enter installed runtime")

        let configuration = temporary.appending(path: "product-configuration.json")
        try Data(#"{"YOSH_ENABLE_MAINNET_EXECUTION":"0"}"#.utf8).write(to: configuration)
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configuration.path)
        check(try isolated.childEnvironment(token: token)["YOSH_ENABLE_MAINNET_EXECUTION"] == "0")
        try manager.setAttributes([.posixPermissions: 0o644], ofItemAtPath: configuration.path)
        try rejectsConfiguration { _ = try isolated.childEnvironment(token: token) }
        try manager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configuration.path)
        try Data(#"{"YOSH_ENABLE_MAINNET_EXECUTION":"1","X402_FACILITATOR_URL":"https://facilitator.example/x402"}"#.utf8)
            .write(to: configuration)
        let configured = try isolated.childEnvironment(token: token)
        check(configured["YOSH_ENABLE_MAINNET_EXECUTION"] == "1")
        check(configured["X402_FACILITATOR_URL"] == "https://facilitator.example/x402")
        for invalid in ["http://facilitator.example", "https://user:password@facilitator.example",
                        "https://facilitator.example?token=value", "https://facilitator.example/#fragment",
                        "https://", "facilitator.example", ""] {
            let data = try JSONSerialization.data(withJSONObject: ["X402_FACILITATOR_URL": invalid])
            try data.write(to: configuration)
            check(try isolated.childEnvironment(token: token)["X402_FACILITATOR_URL"] == invalid,
                  "backend must classify invalid facilitator URL without losing status API")
        }
        for unsafe in ["https://facilitator.example\n", "https://facilitator.example\u{0}",
                       String(repeating: "x", count: 2049)] {
            let data = try JSONSerialization.data(withJSONObject: ["X402_FACILITATOR_URL": unsafe])
            try data.write(to: configuration)
            try rejectsConfiguration { _ = try isolated.childEnvironment(token: token) }
        }
        try Data(#"{"PRIVATE_KEY":"forbidden"}"#.utf8).write(to: configuration)
        try rejectsConfiguration { _ = try isolated.childEnvironment(token: token) }
        try manager.removeItem(at: configuration)
        try manager.createSymbolicLink(at: configuration, withDestinationURL: runtime.appending(path: "mcp.cjs"))
        try rejectsConfiguration { _ = try isolated.childEnvironment(token: token) }
        try manager.removeItem(at: configuration)
        try manager.createSymbolicLink(at: configuration, withDestinationURL: runtime.appending(path: "missing.json"))
        try rejectsConfiguration { _ = try isolated.childEnvironment(token: token) }
        try manager.removeItem(at: configuration)

        for suffix in ["PORT", "REPOSITORY_ROOT", "NODE_PATH", "DATA_DIR", "MANAGEMENT_TOKEN"] {
            let conflicting = BackendLaunchConfiguration(environment: ["YOSH_\(suffix)": "new", "APP2049_\(suffix)": "old"], bundleURL: app)
            try rejectsConfiguration { _ = try conflicting.childEnvironment(token: token) }
        }
        try rejectsConfiguration {
            _ = try BackendLaunchConfiguration(environment: ["YOSH_DATA_DIR": "relative"], bundleURL: app).dataDirectory()
        }
        let current = BackendHealth(ready: true, service: "Yosh", pid: 123, dataDirectory: temporary.path, coreReady: true)
        let old = BackendHealth(ready: true, service: "2049", pid: 123, dataDirectory: temporary.path)
        check(current.matchesNewChild(pid: 123, directory: temporary.path))
        check(!current.matchesNewChild(pid: 124, directory: temporary.path))
        check(old.matchesTakeover(directory: temporary.path) && !old.matchesNewChild(pid: 123, directory: temporary.path))
        check(!BackendHealth(ready: true, service: "Yosh", pid: 123, dataDirectory: temporary.path, coreReady: false)
            .matchesNewChild(pid: 123, directory: temporary.path))
        try manager.removeItem(at: runtime.appending(path: "backend/server.js"))
        try rejectsConfiguration { _ = try installed.runtimeDirectory() }
        print("Packaged launch paths, isolated data, private product config, sanitized environment and authenticated health identity passed")
    }

    private enum Failure: Error { case acceptedInvalidConfiguration }
    private static func rejectsConfiguration(_ operation: () throws -> Void) throws {
        do { try operation(); throw Failure.acceptedInvalidConfiguration }
        catch ServiceRuntimeError.configuration { }
    }
}
