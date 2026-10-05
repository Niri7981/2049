import AppKit
import SwiftUI

// Compile with CardWindow.swift and CardMetrics.swift. The real card transform
// must leave a text field on its back able to receive a mouse click.
@MainActor private final class FocusProbe {
    static let shared = FocusProbe()
    var flips = 0
    var text = "0.01"
}

struct OverviewClient {}
final class CardMemberSession {
    init(client: OverviewClient) {}
    var selectedMember: AgentMember? { nil }
    func refresh() async {}
}
struct AgentMember { let label: String }
struct AgentIdentity { let name: String }
struct AgentCardFront: View {
    let identity: AgentIdentity?
    let onFlip: () -> Void

    var body: some View {
        Button("Flip") {
            FocusProbe.shared.flips += 1
            onFlip()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }
}
struct AgentCardBack: View {
    let onFlip: () -> Void
    let overviewClient: OverviewClient
    let memberSession: CardMemberSession

    var body: some View {
        TextField("Amount", text: Binding(get: { FocusProbe.shared.text }, set: { FocusProbe.shared.text = $0 }))
            .textFieldStyle(.roundedBorder)
            .frame(width: 300)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
struct CardMaterial: View { var body: some View { Color.white } }
struct WindowControls: View { var body: some View { EmptyView() } }
private final class TestWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

@main struct CardWindowTextFieldHitTest {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let host = NSHostingView(rootView: CardWindow(overviewClient: OverviewClient()))
        let window = TestWindow(contentRect: NSRect(origin: .zero, size: CardMetrics.windowSize),
                                styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
                                backing: .buffered, defer: false)
        window.contentView = host
        window.isMovableByWindowBackground = true
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))

        click(window)
        RunLoop.current.run(until: .now.addingTimeInterval(0.8))
        precondition(FocusProbe.shared.flips == 1, "Card did not flip")
        click(window)
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
        precondition(String(describing: type(of: window.firstResponder ?? window)).contains("FieldEditor"),
                     "Text field on card back did not take focus")

        window.close()
        print("Card back text field focus passed")
    }

    @MainActor private static func click(_ window: NSWindow) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type,
                                           location: NSPoint(x: CardMetrics.windowSize.width / 2, y: CardMetrics.windowSize.height / 2),
                                           modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil,
                                           eventNumber: 1, clickCount: 1, pressure: 1)!
            window.sendEvent(event)
        }
    }
}
