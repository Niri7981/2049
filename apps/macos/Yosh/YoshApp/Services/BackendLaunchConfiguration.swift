import CFNetwork
import Darwin
import Foundation
import Security

struct BackendLaunchConfiguration {
    let environment: [String: String]
    let bundleURL: URL

    /// Validate every alias before loading credentials or launching a child. Inherited
    /// management-token aliases are checked too, although production uses Keychain.
    func normalizedEnvironment() throws -> [String: String] {
        var resolved = environment
        let suffixes = Set(environment.keys.compactMap { key -> String? in
            if key.hasPrefix("YOSH_") { return String(key.dropFirst(5)) }
            if key.hasPrefix("APP2049_") { return String(key.dropFirst(8)) }
            return nil
        })
        for suffix in suffixes {
            let canonical = "YOSH_\(suffix)"
            let legacy = "APP2049_\(suffix)"
            if let current = environment[canonical], let previous = environment[legacy], current != previous {
                throw ServiceRuntimeError.configuration
            }
            if let value = environment[canonical] ?? environment[legacy] {
                resolved[canonical] = value
                resolved[legacy] = value
            }
        }
        return resolved
    }

    func configuredValue(_ suffix: String) throws -> String? {
        try normalizedEnvironment()["YOSH_\(suffix)"]
    }

    func servicePort() throws -> Int {
        let raw = try configuredValue("PORT") ?? "3049"
        guard let port = Int(raw), (1024...65535).contains(port), String(port) == raw else {
            throw ServiceRuntimeError.configuration
        }
        return port
    }

    func repositoryRoot() throws -> URL {
        let candidates = [try configuredValue("REPOSITORY_ROOT").map { URL(fileURLWithPath: $0) },
                          try installedPath(for: "YoshRepositoryRoot", legacy: "APP2049RepositoryRoot").map { URL(fileURLWithPath: $0) }, bundleURL]
            .compactMap { $0 }
        for candidate in candidates {
            var directory = candidate.standardizedFileURL
            for _ in 0..<8 {
                if FileManager.default.fileExists(atPath: directory.appending(path: "package.json").path),
                   FileManager.default.fileExists(atPath: directory.appending(path: "node_modules/next/dist/bin/next").path) {
                    return directory
                }
                let parent = directory.deletingLastPathComponent()
                if parent == directory { break }
                directory = parent
            }
        }
        throw ServiceRuntimeError.configuration
    }

    func nodeExecutable() throws -> URL {
        let explicit = try configuredValue("NODE_PATH").map { [$0] } ?? []
        let installed = try installedPath(for: "YoshNodeExecutable", legacy: "APP2049NodeExecutable").map { [$0] } ?? []
        let pathCandidates = (environment["PATH"] ?? "").split(separator: ":").map { "\($0)/node" }
        let candidates = explicit + installed + pathCandidates + ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]
        guard let path = candidates.first(where: { $0.hasPrefix("/") && FileManager.default.isExecutableFile(atPath: $0) }) else {
            throw ServiceRuntimeError.configuration
        }
        return URL(fileURLWithPath: path)
    }

    // The local installer records paths only; Finder does not inherit a development shell's cwd/PATH.
    private func installedPath(for key: String, legacy: String) throws -> String? {
        guard let bundle = Bundle(url: bundleURL) else { return nil }
        let current = bundle.object(forInfoDictionaryKey: key)
        let previous = bundle.object(forInfoDictionaryKey: legacy)
        if let current, let previous {
            guard let current = current as? String, let previous = previous as? String,
                  current == previous else { throw ServiceRuntimeError.configuration }
        }
        guard let raw = current ?? previous else { return nil }
        guard let path = raw as? String, path.hasPrefix("/"), !path.utf8.contains(0) else {
            throw ServiceRuntimeError.configuration
        }
        return path
    }

    func validToken(_ token: String) -> Bool {
        token.utf8.count >= 32 && !token.contains("\r") && !token.contains("\n")
    }

    func managementToken() throws -> String {
        _ = try normalizedEnvironment()
        return try BackendManagementIdentity.loadOrCreate()
    }

    func dataDirectory() throws -> URL {
        // Retain one ledger/wallet/config store; branding must never create a new store.
        let path = try configuredValue("DATA_DIR") ?? FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Application Support/2049").path
        guard path.hasPrefix("/"), !path.utf8.contains(0) else { throw ServiceRuntimeError.configuration }
        let standardized = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        guard let resolved = Darwin.realpath(standardized.path, nil) else { return standardized }
        defer { Darwin.free(resolved) }
        return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
    }

    func childEnvironment(token: String) throws -> [String: String] {
        var childEnvironment = try normalizedEnvironment()
        guard validToken(token) else { throw ServiceRuntimeError.configuration }
        // Both spellings share the same Keychain identity for old/new backend consumers.
        childEnvironment["YOSH_MANAGEMENT_TOKEN"] = token
        childEnvironment["APP2049_MANAGEMENT_TOKEN"] = token
        let directory = try dataDirectory().path
        childEnvironment["YOSH_DATA_DIR"] = directory
        childEnvironment["APP2049_DATA_DIR"] = directory
        childEnvironment["NODE_USE_ENV_PROXY"] = "1"
        addSystemProxyIfNeeded(to: &childEnvironment)
        childEnvironment["NO_PROXY"] = [environment["NO_PROXY"] ?? environment["no_proxy"], "localhost", "127.0.0.1", "::1"]
            .compactMap { $0 }.joined(separator: ",")
        return childEnvironment
    }

    func addSystemProxyIfNeeded(to childEnvironment: inout [String: String]) {
        guard childEnvironment["HTTPS_PROXY"] == nil, childEnvironment["https_proxy"] == nil,
              let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue() as? NSDictionary,
              (settings[kCFNetworkProxiesHTTPSEnable as NSString] as? NSNumber)?.intValue == 1,
              let host = settings[kCFNetworkProxiesHTTPSProxy as NSString] as? String,
              host.range(of: "^[a-zA-Z0-9.-]+$", options: .regularExpression) != nil,
              let port = (settings[kCFNetworkProxiesHTTPSPort as NSString] as? NSNumber)?.intValue,
              (1...65535).contains(port) else { return }
        let proxy = "http://\(host):\(port)"
        childEnvironment["HTTPS_PROXY"] = proxy
        childEnvironment["HTTP_PROXY"] = childEnvironment["HTTP_PROXY"] ?? proxy
    }

}

private enum BackendManagementIdentity {
    // This is an existing installation secret, not public branding.
    private static let service = "com.twentyfortynine.backend-management.v1"
    private static let account = "local-installation"

    static func loadOrCreate() throws -> String {
        if let existing = try read() { return existing }
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw ServiceRuntimeError.configuration
        }
        let token = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        let item: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData: Data(token.utf8),
        ]
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess || status == errSecDuplicateItem,
              let saved = try read() else { throw ServiceRuntimeError.configuration }
        return saved
    }

    private static func read() throws -> String? {
        let query: [CFString: Any] = [
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data,
              let token = String(data: data, encoding: .utf8),
              token.utf8.count >= 32, !token.contains("\r"), !token.contains("\n") else {
            throw ServiceRuntimeError.configuration
        }
        return token
    }
}

struct ReadyResponse: Decodable {
    let ready: Bool
}
