import Foundation
import Security

protocol YoshAppLockStoring: Sendable {
    func load() async throws -> YoshAppLockCredential?
    func save(_ credential: YoshAppLockCredential) async throws
}

enum YoshAppLockStoreError: Error, Sendable, Equatable {
    case invalidRecord
    case keychainFailure(OSStatus)
}

/// Its own generic-password item, with the normal system access policy.
/// Actor isolation keeps blocking Security calls away from the main actor.
actor YoshKeychainAppLockStore: YoshAppLockStoring {
    // Preserve existing PIN records under their original Keychain lookup identity.
    static let service = "com.twentyfortynine.yosh-app-lock.v1"
    static let account = "local-app-lock"
    static let maximumEncodedBytes = 2_048

    func load() async throws -> YoshAppLockCredential? {
        var query = itemQuery
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else {
            throw YoshAppLockStoreError.keychainFailure(status)
        }
        guard let data = result as? Data else { throw YoshAppLockStoreError.invalidRecord }
        return try Self.decode(data)
    }

    func save(_ credential: YoshAppLockCredential) async throws {
        let data = try Self.encode(credential)
        let changes: [CFString: Any] = [kSecValueData: data]
        let status = SecItemUpdate(itemQuery as CFDictionary, changes as CFDictionary)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else {
            throw YoshAppLockStoreError.keychainFailure(status)
        }

        var item = itemQuery
        item[kSecValueData] = data
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        guard addStatus == errSecSuccess else {
            // A competing creation or denied access must not silently replace a record.
            throw YoshAppLockStoreError.keychainFailure(addStatus)
        }
    }

    static func encode(_ credential: YoshAppLockCredential) throws -> Data {
        try credential.validate()
        let data = try JSONEncoder().encode(credential)
        guard data.count <= maximumEncodedBytes else { throw YoshAppLockStoreError.invalidRecord }
        return data
    }

    static func decode(_ data: Data) throws -> YoshAppLockCredential {
        guard !data.isEmpty, data.count <= maximumEncodedBytes else {
            throw YoshAppLockStoreError.invalidRecord
        }
        do {
            let credential = try JSONDecoder().decode(YoshAppLockCredential.self, from: data)
            try credential.validate()
            return credential
        } catch {
            throw YoshAppLockStoreError.invalidRecord
        }
    }

    private var itemQuery: [CFString: Any] {
        [kSecClass: kSecClassGenericPassword,
         kSecAttrService: Self.service,
         kSecAttrAccount: Self.account]
    }
}
