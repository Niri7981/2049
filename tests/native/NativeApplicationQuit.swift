import AppKit

/// Send the standard macOS quit request to the App process started by the lifecycle test.
@main
struct NativeApplicationQuit {
    static func main() throws {
        guard CommandLine.arguments.count == 2,
              let pid = Int32(CommandLine.arguments[1]),
              let application = NSRunningApplication(processIdentifier: pid),
              application.terminate() else { throw QuitFailure.refused }
    }
    private enum QuitFailure: Error { case refused }
}
