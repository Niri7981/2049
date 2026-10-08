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

    func runtimeDirectory() throws -> URL {
        let directory = bundleURL.appending(path: "Contents/Resources/Runtime", directoryHint: .isDirectory)
        guard FileManager.default.fileExists(atPath: directory.appending(path: "backend/server.js").path),
              FileManager.default.fileExists(atPath: directory.appending(path: "mcp.cjs").path) else {
            throw ServiceRuntimeError.configuration
        }
        return directory
    }

    func nodeExecutable() throws -> URL {
        _ = try runtimeDirectory()
        let path = bundleURL.appending(path: "Contents/MacOS/YoshBackendNode").path
        guard FileManager.default.isExecutableFile(atPath: path) else {
            throw ServiceRuntimeError.configuration
        }
        return URL(fileURLWithPath: path)
    }

    func validToken(_ token: String) -> Bool {
        token.utf8.count >= 32 && !token.contains("\r") && !token.contains("\n")
    }

    private func safeFacilitatorSetting(_ raw: String) -> Bool {
        // The backend classifies malformed URLs in payment readiness while
        // remaining available. The native boundary only limits child-env data.
        raw.utf8.count <= 2048 && !raw.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }

    func managementToken() throws -> String {
        _ = try normalizedEnvironment()
        return try BackendManagementIdentity.loadOrCreate()
    }

    func dataDirectory() throws -> URL {
        // Retain one ledger/wallet/config store; branding must never create a new store.
        let support = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support")
        let legacy = support.appending(path: "2049")
        let selected = FileManager.default.fileExists(atPath: legacy.appending(path: "app-ledger.sqlite").path)
            ? legacy : support.appending(path: "Yosh")
        let path = try configuredValue("DATA_DIR") ?? selected.path
        guard path.hasPrefix("/"), !path.utf8.contains(0) else { throw ServiceRuntimeError.configuration }
        let standardized = URL(fileURLWithPath: path, isDirectory: true).standardizedFileURL
        guard let resolved = Darwin.realpath(standardized.path, nil) else { return standardized }
        defer { Darwin.free(resolved) }
        return URL(fileURLWithPath: String(cString: resolved), isDirectory: true)
    }

    func childEnvironment(token: String) throws -> [String: String] {
        var childEnvironment: [String: String] = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "NODE_ENV": "production",
            "HOSTNAME": "127.0.0.1", "PORT": String(try servicePort())]
        guard validToken(token) else { throw ServiceRuntimeError.configuration }
        // Both spellings share the same Keychain identity for old/new backend consumers.
        childEnvironment["YOSH_MANAGEMENT_TOKEN"] = token
        childEnvironment["APP2049_MANAGEMENT_TOKEN"] = token
        let directory = try dataDirectory().path
        childEnvironment["YOSH_DATA_DIR"] = directory
        childEnvironment["APP2049_DATA_DIR"] = directory
        childEnvironment["YOSH_PACKAGED_RUNTIME_DIR"] = try runtimeDirectory().path
        let configuration = URL(fileURLWithPath: directory).appending(path: "product-configuration.json")
        let exists = FileManager.default.fileExists(atPath: configuration.path)
            || (try? FileManager.default.destinationOfSymbolicLink(atPath: configuration.path)) != nil
        if exists {
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: configuration.path) else {
                throw ServiceRuntimeError.configuration
            }
            guard (attributes[.type] as? FileAttributeType) == .typeRegular,
                  (((attributes[.posixPermissions] as? NSNumber)?.intValue ?? 0) & 0o077) == 0,
                  (attributes[.ownerAccountID] as? NSNumber)?.intValue == Int(getuid()),
                  let settings = try JSONSerialization.jsonObject(with: Data(contentsOf: configuration)) as? [String: String],
                  Set(settings.keys).isSubset(of: ["YOSH_MAINNET_RESOURCES", "YOSH_ENABLE_MAINNET_EXECUTION", "YOSH_MAINNET_WALLET_PUBLIC_KEY", "SOLANA_MAINNET_RPC_URL", "X402_FACILITATOR_URL"]),
                  settings["YOSH_ENABLE_MAINNET_EXECUTION"].map({ $0 == "0" || $0 == "1" }) ?? true,
                  settings["X402_FACILITATOR_URL"].map(safeFacilitatorSetting) ?? true else {
                throw ServiceRuntimeError.configuration
            }
            childEnvironment.merge(settings) { _, product in product }
        }
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
