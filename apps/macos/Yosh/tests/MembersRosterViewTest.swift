import AppKit
import SwiftUI

/// Exercises the real roster controls in native fixture windows, without an app/backend connection.
@main
struct MembersRosterViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let id = UUID()
        let data = try JSONSerialization.data(withJSONObject: [
            "member": ["id": id.uuidString, "label": "Codex", "status": "ACTIVE", "isDefault": true,
                       "createdAt": 1, "updatedAt": 1],
            "connection": ["enabled": false, "lastSeen": NSNull(), "access": "read_only"],
        ])
        let member = try JSONDecoder().decode(CardMemberSummary.self, from: data)
        let roster = MembersRosterPresentation([member])
        var selections: [UUID] = [], connections: [UUID] = []
        let select: (UUID) -> Void = { selections.append($0) }
        let connect: (UUID) -> Void = { connections.append($0) }

        let row = MembersRosterRow(row: roster.rows[0], isSelected: true, interactionsDisabled: false,
            onSelect: select, onConnect: connect).frame(width: 368, height: 74)
        let rowWindow = window(NSHostingView(rootView: row), size: NSSize(width: 368, height: 74))
        click(rowWindow, at: NSPoint(x: 330, y: 37))
        precondition(connections == [id] && selections.isEmpty, "Connect must not open or select a member")
        click(rowWindow, at: NSPoint(x: 85, y: 37))
        precondition(selections == [id] && connections == [id], "Row selection must not enable access")
        rowWindow.close()

        for state in [MembersRosterPresentation.Status.settingUp, .connected, .waiting, .accessAllowed, .comingSoon, .revoked] {
            let inactive = MembersRosterPresentation.Row(id: "fixture", memberID: id, name: "Fixture",
                provider: "Yosh", icon: .symbol("sparkle"), group: .available,
                status: state, action: nil, canSelect: true, explanation: "Fixture state")
            let host = NSHostingView(rootView: MembersRosterRow(row: inactive, isSelected: false, interactionsDisabled: false,
                onSelect: select, onConnect: connect).frame(width: 368, height: 74))
            let inactiveWindow = window(host, size: NSSize(width: 368, height: 74))
            click(inactiveWindow, at: NSPoint(x: 330, y: 37))
            precondition(connections == [id] && selections == [id], "Disabled state controls must trigger neither action")
            inactiveWindow.close()
        }

        let view = MembersRoster(presentation: roster, selectedMemberID: id, isLoading: false,
            interactionsDisabled: false, error: nil, onSelect: select, onConnect: connect, onAdd: {}, onRetry: {})
            .padding(.horizontal, CardPageHeader.Layout.contentInset)
            .padding(.top, CardPageHeader.Layout.topSpacing).padding(.bottom, 12)
            .frame(width: 420, height: 526)
            .background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light)
        let host = NSHostingView(rootView: view)
        let rosterWindow = window(host, size: NSSize(width: 420, height: 526))
        guard let scroll = scrollView(in: host), let document = scroll.documentView else {
            fatalError("Members must expose a native vertical scroll view")
        }
        precondition(host.frame.size == NSSize(width: 420, height: 526))
        precondition(document.bounds.height > scroll.contentView.bounds.height)
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1)
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-top.png") }
        scroll.contentView.scroll(to: NSPoint(x: 0, y: document.bounds.height - scroll.contentView.bounds.height))
        scroll.reflectScrolledClipView(scroll.contentView)
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-bottom.png") }
        rosterWindow.close()
        print("Members native roster: independent row/connect controls, disabled states, fixed 420×526 viewport, and vertical scrolling passed")
    }

    @MainActor
    private static func window(_ host: NSView, size: NSSize) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
        return window
    }

    @MainActor
    private static func click(_ window: NSWindow, at point: NSPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
            window.sendEvent(event)
        }
    }

    @MainActor
    private static func scrollView(in view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView { return scroll }
        return view.subviews.compactMap { scrollView(in: $0) }.first
    }

    @MainActor
    private static func render(_ host: NSView, to path: String) throws {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("Fixture rendering unavailable") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])?.write(to: URL(filePath: path))
    }
}
