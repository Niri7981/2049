import AppKit
import SwiftUI

@MainActor @Observable
private final class ExpiryProbe {
    var selection: Date
    init(_ selection: Date) { self.selection = selection }
}

/// Native, callback-only fixtures. No backend, real grant, credentials or payments.
@main
struct SpendGrantViewTest {
    @MainActor static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        for (input, expected) in [("0.20", "200000"), ("1.000001", "1000001"), (" 2.123456 ", "2123456"), ("0", "0")] {
            precondition(SpendGrantDraft.minorUnits(input) == expected)
        }
        for input in ["-1", "1e3", "0.0000001", "01.2", "NaN", "1000000000"] {
            precondition(SpendGrantDraft.minorUnits(input) == nil, "Malformed or inexact amounts must not be rounded")
        }
        precondition(SpendGrantDraft.decimal(200000, decimals: 6) == "0.20")
        precondition(SpendGrantDraft.decimal(200001, decimals: 6) == "0.200001")
        precondition(SpendGrantDraft.decimal(0, decimals: 6) == "0.00")
        precondition(SpendGrantDraft.decimal(1, decimals: 18) == "0.000000000000000001")
        let expired = try overview(enabled: false)
        let draft = SpendGrantDraft(grant: expired.grant)
        precondition(draft.expiration > .now && draft.total == "0.20", "Expired grants seed a future draft without losing the current summary")
        var backs = 0, connections = 0, submissions: [(String, String, Int64)] = []
        func page(_ overview: AppOverview, saving: Bool = false, id: Int = 0) -> some View {
            SpendGrantDetail(overview: overview, isSaving: saving, writeMessage: nil, writeFailed: false,
                onBack: { backs += 1 }, onConnection: { connections += 1 },
                onCreate: { total, single, expiresAt, _ in submissions.append((total, single, expiresAt)) }, onRevoke: {})
                .id(id).frame(width: 420, height: 526)
                .background(Color(red: 0.95, green: 0.97, blue: 0.985))
                .environment(\.colorScheme, .light)
        }
        let host = NSHostingView(rootView: page(expired))
        let window = makeWindow(host, size: NSSize(width: 420, height: 526))
        defer { window.close() }
        settle(host)
        guard let scroll = scrollViews(host).first, let document = scroll.documentView else { fatalError("Missing native page scroll view") }
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1)
        precondition(abs(scroll.contentView.bounds.origin.y) < 0.5)
        if let prefix = CommandLine.arguments.dropFirst().first { try render(host, to: prefix + "-collapsed.png") }
        click(window, at: NSPoint(x: 80, y: 490))
        precondition(backs == 1 && submissions.isEmpty)
        click(window, at: NSPoint(x: 85, y: 70))
        precondition(connections == 1, "Connection required must retain its navigation action")
        click(window, at: NSPoint(x: 100, y: 35))
        settle(host)
        precondition(submissions.isEmpty, "Disabled connection must prevent grant writes")
        click(window, at: NSPoint(x: 70, y: 172))
        guard let editor = window.firstResponder as? NSTextView else { fatalError("Amount must retain a native text editor") }
        editor.selectAll(nil)
        editor.insertText("2.123456", replacementRange: editor.selectedRange())
        settle(host)
        let connected = try overview(enabled: true)
        host.rootView = page(connected)
        settle(host)
        click(window, at: NSPoint(x: 100, y: 60))
        settle(host)
        precondition(submissions.count == 1 && submissions[0].0 == "2123456" && submissions[0].1 == "200000",
            "Connection refresh must preserve the draft and submit exact amounts")
        precondition(submissions[0].2 > Int64(Date.now.timeIntervalSince1970 * 1000))
        host.rootView = page(connected, saving: true)
        settle(host)
        click(window, at: NSPoint(x: 80, y: 490))
        click(window, at: NSPoint(x: 100, y: 60))
        settle(host)
        precondition(backs == 1 && submissions.count == 1, "Saving must block Back and duplicate writes")
        host.rootView = page(connected)
        settle(host)
        click(window, at: NSPoint(x: 180, y: 111))
        settle(host)
        precondition(document.bounds.height > scroll.contentView.bounds.height, "Expanded picker must scroll inside the same fixed card")
        if let prefix = CommandLine.arguments.dropFirst().first { try render(host, to: prefix + "-page-expanded.png") }
        try expiryFixture(reduceMotion: false)
        try expiryFixture(reduceMotion: true)
        print("Spend Grant: exact submission, connection/saving guards, retained draft, narrow layout, inline wheel selection, keyboard adjustment, collapse/reopen and Reduce Motion passed")
    }

    @MainActor private static func expiryFixture(reduceMotion: Bool) throws {
        var calendar = Calendar.current
        calendar.timeZone = .current
        let day = calendar.date(byAdding: .day, value: 1, to: .now)!
        let initial = calendar.date(bySettingHour: 6, minute: 59, second: 0, of: day)!
        let probe = ExpiryProbe(initial)
        let binding = Binding(get: { probe.selection }, set: { probe.selection = $0 })
        let host = NSHostingView(rootView: VStack(spacing: 0) {
            SpendGrantExpiryPicker(selection: binding, reduceMotion: reduceMotion)
            Spacer(minLength: 0)
        }.frame(width: 368, height: 190).background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light))
        let window = makeWindow(host, size: NSSize(width: 368, height: 190))
        defer { window.close() }
        settle(host)
        click(window, at: NSPoint(x: 180, y: 169))
        settle(host)
        precondition(scrollViews(host).count == 3, "Expires must expand three native inline wheels")
        precondition(probe.selection == initial, "Opening the wheel must not change the selected date/time")
        if let prefix = CommandLine.arguments.dropFirst().first, !reduceMotion { try render(host, to: prefix + "-wheel.png") }
        click(window, at: NSPoint(x: 231, y: 87))
        key(window, code: 125, characters: "\u{F701}")
        settle(host)
        precondition(calendar.component(.hour, from: probe.selection) == 7 && calendar.component(.minute, from: probe.selection) == 59,
            "Hour keyboard input must preserve day/minute")
        click(window, at: NSPoint(x: 316, y: 87))
        key(window, code: 126, characters: "\u{F700}")
        settle(host)
        precondition(calendar.component(.hour, from: probe.selection) == 7 && calendar.component(.minute, from: probe.selection) == 58,
            "Minute keyboard input must preserve day/hour: \(probe.selection.formatted(date: .complete, time: .complete))")
        let edited = probe.selection
        if let prefix = CommandLine.arguments.dropFirst().first, !reduceMotion { try render(host, to: prefix + "-edited-wheel.png") }
        click(window, at: NSPoint(x: 180, y: 169))
        settle(host)
        if let prefix = CommandLine.arguments.dropFirst().first, !reduceMotion { try render(host, to: prefix + "-after-collapse.png") }
        click(window, at: NSPoint(x: 231, y: 87))
        key(window, code: 125, characters: "\u{F701}")
        settle(host)
        precondition(probe.selection == edited, "Collapsed wheels must stop receiving pointer and keyboard input")
        click(window, at: NSPoint(x: 180, y: 169))
        settle(host)
        precondition(probe.selection == edited, "Collapse/reopen must retain the edited expiry")
        for wheel in scrollViews(host) {
            precondition(abs(wheel.bounds.height - 90) < 1 && wheel.documentView!.bounds.width <= wheel.bounds.width + 1)
        }
    }

    private static func overview(enabled: Bool, status: String = "EXPIRED") throws -> AppOverview {
        let payload: [String: Any] = [
            "service": ["status": "running", "purchaseMode": "simulated", "network": "Solana Devnet"],
            "wallet": ["address": "FixturePublicAddress"],
            "budget": ["dailyLimit": "1000000", "dailyLimitDisplay": "Fixture limit", "paid": "0", "reserved": "0",
                "remaining": "1000000", "remainingDisplay": "Fixture remaining", "paused": false],
            "grant": ["id": "fixture-grant", "status": status, "totalLimit": "200000", "singleLimit": "200000",
                "remaining": "170000", "assetDecimals": 6, "expiresAt": Int64(Date.now.addingTimeInterval(status == "EXPIRED" ? -3600 : 3600).timeIntervalSince1970 * 1000)],
            "connection": ["enabled": enabled, "lastSeen": NSNull(), "access": "purchase_intent"], "purchases": [],
        ]
        return try JSONDecoder().decode(AppOverview.self, from: JSONSerialization.data(withJSONObject: payload))
    }

    @MainActor private static func makeWindow(_ host: NSView, size: NSSize) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        return window
    }
    @MainActor private static func settle(_ host: NSView) {
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.35))
    }
    @MainActor private static func scrollViews(_ view: NSView) -> [NSScrollView] {
        (view as? NSScrollView).map { [$0] + view.subviews.flatMap(scrollViews) } ?? view.subviews.flatMap(scrollViews)
    }
    @MainActor private static func click(_ window: NSWindow, at point: NSPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!)
        }
    }
    @MainActor private static func key(_ window: NSWindow, code: UInt16, characters: String) {
        window.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)!)
    }
    @MainActor private static func render(_ host: NSView, to path: String) throws {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("Fixture rendering unavailable") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])?.write(to: URL(filePath: path))
    }
}
