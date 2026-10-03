import CommonCrypto
import Darwin
import Foundation
import Security

/// Local App presentation lock only. This record is unrelated to backend authority.
struct YoshAppLockCredential: Codable, Sendable, Equatable {
    var version = 1
    var enabled: Bool
    var digitCount: Int
    var iterations: Int
    var salt: Data
    var verifier: Data

    func validate() throws {
        guard version == 1,
              digitCount == 4 || digitCount == 6,
              (600_000...2_000_000).contains(iterations),
              salt.count == 16 || salt.count == 32,
              verifier.count == 32 else {
            throw YoshAppLockCredentialError.invalidRecord
        }
    }
}

enum YoshAppLockCredentialError: Error, Sendable, Equatable {
    case invalidPIN
    case invalidRecord
    case randomGenerationFailed(OSStatus)
    case derivationFailed(Int32)
}

enum YoshPINVerifier {
    static func create(pin: String, digitCount: Int,
                       enabled: Bool = true) throws -> YoshAppLockCredential {
        try validatePIN(pin, digitCount: digitCount)
        var salt = Data(count: 32)
        let randomStatus = salt.withUnsafeMutableBytes { bytes in
            SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!)
        }
        guard randomStatus == errSecSuccess else {
            throw YoshAppLockCredentialError.randomGenerationFailed(randomStatus)
        }
        let iterations = 600_000
        let verifier = try derive(pin: pin, salt: salt, iterations: iterations)
        return YoshAppLockCredential(enabled: enabled, digitCount: digitCount,
            iterations: iterations, salt: salt, verifier: verifier)
    }

    static func matches(pin: String, credential: YoshAppLockCredential) throws -> Bool {
        // Validate untrusted KDF metadata before allocating or doing expensive derivation.
        try credential.validate()
        try validatePIN(pin, digitCount: credential.digitCount)
        let candidate = try derive(pin: pin, salt: credential.salt,
            iterations: credential.iterations)
        return constantTimeEqual(candidate, credential.verifier)
    }

    private static func validatePIN(_ pin: String, digitCount: Int) throws {
        let bytes = pin.utf8
        guard digitCount == 4 || digitCount == 6,
              bytes.count == digitCount,
              bytes.allSatisfy({ (48...57).contains($0) }) else {
            throw YoshAppLockCredentialError.invalidPIN
        }
    }

    private static func derive(pin: String, salt: Data, iterations: Int) throws -> Data {
        var derived = Data(count: 32)
        let status = pin.utf8CString.withUnsafeBufferPointer { password in
            salt.withUnsafeBytes { saltBytes in
                derived.withUnsafeMutableBytes { output in
                    CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password.baseAddress,
                        pin.utf8.count, saltBytes.bindMemory(to: UInt8.self).baseAddress,
                        saltBytes.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                        UInt32(iterations), output.bindMemory(to: UInt8.self).baseAddress, output.count)
                }
            }
        }
        guard status == kCCSuccess else {
            throw YoshAppLockCredentialError.derivationFailed(status)
        }
        return derived
    }

    private static func constantTimeEqual(_ candidate: Data, _ expected: Data) -> Bool {
        // Lengths are public and fixed; Darwin provides the timing-safe comparison.
        guard candidate.count == 32, expected.count == 32 else { return false }
        return candidate.withUnsafeBytes { candidateBytes in
            expected.withUnsafeBytes { expectedBytes in
                Darwin.timingsafe_bcmp(candidateBytes.baseAddress, expectedBytes.baseAddress, 32) == 0
            }
        }
    }
}
