import Foundation

@main
struct AppInstanceLockTest {
    static func main() throws {
        if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "--probe" {
            let lock = try AppInstanceLock.acquire(at: URL(fileURLWithPath: CommandLine.arguments[2]))
            print(lock == nil ? "busy" : "acquired")
            return
        }
        let directory = FileManager.default.temporaryDirectory.appending(path: "yosh-instance-lock-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appending(path: "native-app.lock")

        var first = try AppInstanceLock.acquire(at: url)
        precondition(first != nil, "first process must own the lock")
        precondition(AppInstanceLock.ownerPID(at: url) == getpid(), "lock records its owner")
        let blocked = try probe(url)
        precondition(blocked == "busy", "another process must not acquire the lock")

        first = nil
        let next = try probe(url)
        precondition(next == "acquired", "lock must release after the owner exits")
        let resumed = try AppInstanceLock.acquire(at: url)
        precondition(resumed != nil, "stale lock file must be reusable")
        print("Native single-instance lock tests passed")
    }

    private static func probe(_ url: URL) throws -> String {
        let child = Process()
        child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
        child.arguments = ["--probe", url.path]
        let output = Pipe()
        child.standardOutput = output
        try child.run()
        let result = output.fileHandleForReading.readDataToEndOfFile()
        child.waitUntilExit()
        precondition(child.terminationStatus == 0, "probe process failed")
        return String(decoding: result, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
