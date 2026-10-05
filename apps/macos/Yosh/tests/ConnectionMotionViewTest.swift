import AppKit
import SwiftUI

@MainActor @Observable
private final class Probe {
    var observation = ConnectionMotionObservation()
    var active = true
    var issue = false
    var reduced = false
    var writes = 0
    let member = UUID()
    var connection = AppOverview.Connection(enabled: false, lastSeen: nil, access: .purchaseIntent,
        integration: .init(provider: "codex", configured: false, connected: false,
            state: "disconnected", lastHandshake: nil, lastHeartbeat: nil))

    func read(_ handshake: Int64? = nil, enabled: Bool = true, configured: Bool = true, memberID: UUID? = nil) {
        connection = AppOverview.Connection(enabled: enabled, lastSeen: nil, access: .purchaseIntent,
            integration: .init(provider: "codex", configured: configured, connected: handshake != nil,
                state: !enabled ? "disconnected" : handshake == nil ? "reconnect_required" : "connected",
                lastHandshake: handshake, lastHeartbeat: handshake))
        observation.observe(ConnectionMotionFact(memberID: memberID ?? member, connection: connection,
            service: .init(status: .running, purchaseMode: .simulated, network: "Solana Devnet")))
    }

    func prepare() { observation.beginPreparation(memberID: member) }
    func finishRequest() { observation.endPreparation(memberID: member) }
}

private struct Fixture: View {
    let probe: Probe
    var body: some View {
        ConnectionBridge(agentName: "Codex", status: "Fixture", input: .init(observation: probe.observation,
            isConnected: false, isActive: probe.active, hasIssue: probe.issue, reduceMotion: probe.reduced))
            // The selected-member surface has the same identity boundary in AgentCardBack.
            .id(probe.observation.fact?.memberID)
            .frame(width: 368, height: 36).background(.white).environment(\.colorScheme, .light)
    }
}

/// Native rendering and native button events in invisible fixture windows. No backend/App/Keychain.
@main
struct ConnectionMotionViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let probe = Probe()
        probe.read(enabled: false, configured: false)
        let host = NSHostingView(rootView: Fixture(probe: probe))
        let window = makeWindow(host, width: 368, height: 36)
        defer { window.close() }
        pause(0.15)
        try require(try extent(host) == nil, "Disconnected bridge must be at rest")

        probe.prepare()
        pause(0.115)
        let moving = try extent(host)
        try require(moving != nil && moving! < 178, "Connect must physically prepare the first half through intermediate positions")
        try require(try !filledNode(host, x: 5) && !filledNode(host, x: 363),
            "Preparing endpoints must stay hollow and cannot imply host success")
        try require(probe.observation.fact?.isPrepared == false && probe.observation.fact?.isConnected == false,
            "Request feedback cannot confirm backend readiness or connection")
        probe.read()
        probe.finishRequest()
        pause(0.025)
        let confirmed = try extent(host)
        try require(confirmed != nil && confirmed! >= moving! && confirmed! < 185,
            "Confirming Waiting and completing the request must not restart or snap preparation")
        pause(0.25)
        try require(try isHalfBridge(host) && !filledNode(host, x: 5) && !filledNode(host, x: 363),
            "Waiting must settle into a half bridge with hollow endpoints")
        try require(try hasDashGaps(host), "Waiting must retain its lighter dashed distinction")

        probe.read(100)
        pause(0.145)
        try require(try extent(host)! > 310 && filledNode(host, x: 5) && filledNode(host, x: 363),
            "Confirmed Codex arrival must finish the remaining half quickly without replaying preparation")
        probe.read(100)
        pause(0.03)
        try require(try filledNode(host, x: 363) && extent(host)! > 310,
            "Duplicate Connected snapshots must remain fully established")
        probe.read()
        pause(0.15)
        try require(try isHalfBridge(host) && !filledNode(host, x: 363),
            "Host loss must quietly return to Waiting while access remains prepared")
        probe.read(enabled: false, configured: false)
        pause(0.10)
        let withdrawing = try extent(host)
        try require(withdrawing == nil || withdrawing! < 175, "Disconnect must withdraw the prepared bridge")
        pause(0.24)
        try require(try extent(host) == nil && !filledNode(host, x: 5), "Disconnect must retract and settle")

        probe.prepare()
        pause(0.025)
        probe.read(200)
        probe.finishRequest()
        pause(0.16)
        try require(try filledNode(host, x: 363) && extent(host)! > 310,
            "Fast host arrival must interrupt preparation with a short confirmed completion")
        pause(0.25)
        try require(try extent(host)! > 310, "An old preparation timer must never pull Connected back to half")
        probe.read(enabled: false, configured: false)
        pause(0.035)
        probe.prepare()
        pause(0.08)
        probe.read()
        probe.finishRequest()
        pause(0.30)
        try require(try isHalfBridge(host), "A fast reconnect must cancel an outgoing disconnect's final rest")

        probe.read(enabled: false, configured: false)
        pause(0.30)
        probe.prepare()
        pause(0.08)
        probe.issue = true
        pause(0.03)
        try require(try extent(host) == nil && !filledNode(host, x: 363), "Issue must interrupt preparation immediately")
        probe.read()
        probe.finishRequest()
        probe.issue = false
        pause(0.03)
        try require(try isHalfBridge(host) && !filledNode(host, x: 363),
            "Retry clearing Issue must show resting Waiting and must not fake successful connection")

        probe.read(enabled: false, configured: false)
        pause(0.30)
        probe.prepare()
        pause(0.08)
        probe.active = false
        probe.read()
        probe.finishRequest()
        pause(0.03)
        probe.active = true
        pause(0.03)
        try require(try isHalfBridge(host), "Returning to a prepared tab must show rest without replay")
        probe.active = false
        probe.read(300)
        pause(0.03)
        probe.active = true
        pause(0.03)
        try require(try filledNode(host, x: 363) && extent(host)! > 310,
            "A host connected while hidden must appear fully established immediately on return")
        probe.issue = true
        pause(0.03)
        try require(try extent(host) == nil, "Issue must immediately suppress connected emphasis")
        probe.issue = false
        probe.read(300)
        pause(0.03)
        try require(try filledNode(host, x: 363), "Clearing an error over an old live snapshot cannot replay completion")

        probe.read(enabled: false, configured: false)
        pause(0.30)
        probe.prepare()
        pause(0.08)
        probe.read(memberID: UUID())
        probe.finishRequest()
        pause(0.03)
        try require(try isHalfBridge(host) && !filledNode(host, x: 363),
            "Changing Agent must cancel outgoing preparation and establish the incoming resting baseline")
        pause(0.30)
        try require(try isHalfBridge(host), "Outgoing timers cannot affect a newly selected member")

        probe.read(enabled: false, configured: false)
        pause(0.03)
        probe.reduced = true
        pause(0.03)
        probe.prepare()
        pause(0.045)
        let preparedBitmap = try capture(host)
        let near = regionalBlue(preparedBitmap, from: 60, to: 90)
        let far = regionalBlue(preparedBitmap, from: 130, to: 160)
        try require(near > 0.08 && abs(near - far) < 0.04 && (try extent(host))! > 170,
            "Reduce Motion must fade the entire prepared half instead of traveling")
        probe.read()
        probe.finishRequest()
        pause(0.15)
        try require(try isHalfBridge(host) && !filledNode(host, x: 363),
            "Reduce Motion must keep prepared and connected visually distinct")
        probe.read(500)
        pause(0.045)
        try require(try extent(host)! > 310, "Reduce Motion completion must fade the full result without spatial progression")
        pause(0.15)
        try require(try filledNode(host, x: 363), "Reduce Motion must retain the confirmed result")

        // Newly mounted pages with existing Waiting/Connected must both start settled.
        let existingHost = NSHostingView(rootView: Fixture(probe: probe))
        let existingWindow = makeWindow(existingHost, width: 368, height: 36)
        pause(0.03)
        try require(try filledNode(existingHost, x: 363), "Opening already Connected must not play preparation")
        existingWindow.close()
        let waitingProbe = Probe()
        waitingProbe.read()
        let waitingHost = NSHostingView(rootView: Fixture(probe: waitingProbe))
        let waitingWindow = makeWindow(waitingHost, width: 368, height: 36)
        pause(0.03)
        try require(try isHalfBridge(waitingHost) && !filledNode(waitingHost, x: 363),
            "Opening already Waiting must show a static incomplete bridge")
        waitingWindow.close()
        try requestInput()
        print("Connection native motion: explicit half preparation, hollow/dashed Waiting, short confirmed completion, inverse disconnect, interruptions, no tab/Retry/member/launch replay, Reduce Motion and duplicate/inactive input passed")
    }

    @MainActor private static func requestInput() throws {
        let probe = Probe()
        probe.read(enabled: false, configured: false)
        struct RequestFixture: View {
            let probe: Probe
            var body: some View {
                AgentConnectionDetail(presentation: .init(connection: probe.connection,
                    service: .init(status: .running, purchaseMode: .simulated, network: "Solana Devnet"), agentName: "Codex"),
                    isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in
                        probe.writes += 1
                        probe.prepare()
                        try? await Task.sleep(for: .milliseconds(200))
                        probe.read()
                        probe.finishRequest()
                    }, motionObservation: probe.observation, isActive: probe.active)
                    .frame(width: 420, height: 526).environment(\.colorScheme, .light)
            }
        }
        let host = NSHostingView(rootView: RequestFixture(probe: probe))
        let window = makeWindow(host, width: 420, height: 526)
        defer { window.close() }
        pause(0.15)
        click(window, x: 80, y: 40)
        click(window, x: 80, y: 40)
        pause(0.03)
        try require(probe.writes == 1, "Rapid duplicate Connect must submit only one request")
        let service = AppOverview.Service(status: .running, purchaseMode: .simulated, network: "Solana Devnet")
        try require(ConnectionPresentation(connection: probe.connection, service: service, agentName: "Codex").state == .notConnected,
            "Immediate request feedback must not show Waiting before backend confirmation")
        pause(0.25)
        try require(ConnectionPresentation(connection: probe.connection, service: service, agentName: "Codex").state == .waitingForCodex,
            "Confirmed readiness must show the existing waiting copy")
        probe.active = false
        pause(0.03)
        click(window, x: 80, y: 40)
        try require(probe.writes == 1, "Outgoing Connection must stop receiving input immediately")
    }

    @MainActor private static func makeWindow(_ host: NSView, width: CGFloat, height: CGFloat) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: height),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        return window
    }
    @MainActor private static func capture(_ host: NSView) throws -> NSBitmapImageRep {
        host.layoutSubtreeIfNeeded()
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw Failure("Bitmap unavailable") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
    }
    @MainActor private static func extent(_ host: NSView) throws -> Double? {
        let bitmap = try capture(host)
        let scale = Double(bitmap.pixelsWide) / 368
        var last: Double?
        for x in Int(50 * scale)..<Int(318 * scale) where blueIntensity(bitmap, x: Double(x) / scale) > 0.13 {
            last = Double(x) / scale
        }
        return last
    }
    @MainActor private static func isHalfBridge(_ host: NSView) throws -> Bool {
        guard let last = try extent(host) else { return false }
        return (170...190).contains(last)
    }
    @MainActor private static func hasDashGaps(_ host: NSView) throws -> Bool {
        let bitmap = try capture(host)
        let intensities = (120..<170).map { blueIntensity(bitmap, x: Double($0)) }
        return intensities.contains { $0 > 0.13 } && intensities.contains { $0 < 0.07 }
    }
    @MainActor private static func filledNode(_ host: NSView, x: Double) throws -> Bool {
        let bitmap = try capture(host)
        let scale = Double(bitmap.pixelsWide) / 368
        let column = Int(x * scale)
        let filledRows = (0..<bitmap.pixelsHigh / 2).filter { y in
            guard let color = bitmap.colorAt(x: column, y: y)?.usingColorSpace(.deviceRGB) else { return false }
            return color.redComponent < 0.4 && color.blueComponent > 0.65
        }.count
        // Hollow waiting outlines can be blue at their top/bottom; a filled interior
        // occupies substantially more vertical area in this center column.
        return Double(filledRows) >= 4.5 * scale
    }
    private static func regionalBlue(_ bitmap: NSBitmapImageRep, from: Int, to: Int) -> Double {
        (from..<to).map { blueIntensity(bitmap, x: Double($0)) }.max() ?? 0
    }
    private static func blueIntensity(_ bitmap: NSBitmapImageRep, x: Double) -> Double {
        let column = Int(x * Double(bitmap.pixelsWide) / 368)
        return (0..<bitmap.pixelsHigh / 2).map { y -> Double in
            guard let color = bitmap.colorAt(x: column, y: y)?.usingColorSpace(.deviceRGB) else { return 0 }
            return color.blueComponent - color.redComponent
        }.max() ?? 0
    }
    @MainActor private static func pause(_ seconds: Double) { RunLoop.current.run(until: .now.addingTimeInterval(seconds)) }
    @MainActor private static func click(_ window: NSWindow, x: CGFloat, y: CGFloat) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: y), modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!)
        }
    }
    private static func require(_ value: Bool, _ message: String) throws { if !value { throw Failure(message) } }
    private struct Failure: Error, CustomStringConvertible { let description: String; init(_ message: String) { description = message } }
}
