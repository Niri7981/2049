import AppKit
import SwiftUI

/// Regresses modal presentation and cancellation with the real view and a callback fixture.
@main
struct ConnectionConfirmationTest {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        var writes: [Bool] = []
        let view = AgentConnectionDetail(
            presentation: ConnectionPresentation(agentName: "Codex", state: .reconnectRequired(lastRequest: nil),
                network: "Solana Devnet", backendAvailable: true),
            isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil,
            onSetEnabled: { writes.append($0) }
        )
        let host = NSHostingView(rootView: view.frame(width: 420, height: 526))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 526),
            styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        settle(0.2)

        click(window, at: NSPoint(x: 80, y: 40))
        settle(0.4)
        guard window.attachedSheet == nil, app.modalWindow == nil else {
            print("FAIL: Disconnect presented a modal sheet instead of an anchored confirmation")
            exit(1)
        }
        guard let popover = app.windows.first(where: { $0 != window && $0.isVisible && !$0.isSheet }) else {
            print("FAIL: Disconnect confirmation did not open")
            exit(1)
        }
        precondition(writes.isEmpty, "Opening confirmation must not revoke access")

        // Escape dismisses the native popover and must leave access unchanged.
        let escape = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: popover.windowNumber,
            context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
            isARepeat: false, keyCode: 53)!
        popover.sendEvent(escape)
        settle(0.2)
        precondition(!popover.isVisible && writes.isEmpty, "Escape must cancel without writing")

        window.close()
        print("Connection confirmation: no modal sheet; opening and Escape cancellation never write")
    }

    @MainActor
    private static func settle(_ seconds: TimeInterval) {
        RunLoop.current.run(until: .now.addingTimeInterval(seconds))
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
}
