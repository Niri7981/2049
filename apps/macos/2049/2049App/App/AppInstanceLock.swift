import Darwin
import Foundation

/// A process lock is needed because launching the app executable directly bypasses Launch Services reuse.
final class AppInstanceLock {
    private let descriptor: Int32

    private init(descriptor: Int32) {
        self.descriptor = descriptor
    }

    static func acquire(at url: URL) throws -> AppInstanceLock? {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        // O_EXLOCK takes the advisory lock atomically with open; close releases it after a crash too.
        let descriptor = Darwin.open(
            url.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW | O_EXLOCK | O_NONBLOCK, 0o600
        )
        guard descriptor >= 0 else {
            if errno == EWOULDBLOCK { return nil }
            throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }

        let owner = Array("\(getpid())\n".utf8)
        let written = owner.withUnsafeBytes { bytes in
            Darwin.ftruncate(descriptor, 0) == 0 &&
                Darwin.lseek(descriptor, 0, SEEK_SET) == 0 &&
                Darwin.write(descriptor, bytes.baseAddress, bytes.count) == bytes.count
        }
        guard written else {
            let failure = errno
            Darwin.close(descriptor)
            throw POSIXError(POSIXErrorCode(rawValue: failure) ?? .EIO)
        }
        return AppInstanceLock(descriptor: descriptor)
    }

    static func ownerPID(at url: URL) -> pid_t? {
        guard let contents = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        return pid_t(contents.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    deinit {
        Darwin.close(descriptor)
    }
}
