import AppKit
import SwiftUI

@MainActor
private final class SelectionBox {
    var value: BackSection = .authority
}

/// Compile with BackSection.swift and BackNavigation.swift to test the real SwiftUI hit regions.
@main
struct BackNavigationHitTest {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)

        let selection = SelectionBox()
        let binding = Binding(get: { selection.value }, set: { selection.value = $0 })
        let host = NSHostingView(rootView: BackNavigation(selection: binding).frame(width: 420, height: 76))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 76),
                              styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.isMovableByWindowBackground = true
        window.alphaValue = 0
        window.orderFront(nil)

        // These points are inside each tab's visible area but away from its text and icon.
        let cases: [(source: BackSection, destination: BackSection, point: NSPoint)] = [
            (.authority, .members, NSPoint(x: 160, y: 38)),
            (.members, .settings, NSPoint(x: 300, y: 38)),
            (.settings, .authority, NSPoint(x: 25, y: 38)),
        ]
        for test in cases {
            selection.value = test.source
            host.rootView = BackNavigation(selection: binding).frame(width: 420, height: 76)
            host.layoutSubtreeIfNeeded()
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                let event = NSEvent.mouseEvent(with: type, location: test.point,
                                               modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                               windowNumber: window.windowNumber, context: nil, eventNumber: 1,
                                               clickCount: 1, pressure: 1)!
                window.sendEvent(event)
            }
            RunLoop.current.run(until: .now.addingTimeInterval(0.1))
            precondition(selection.value == test.destination, "Tab missed its available hit region")
        }

        window.close()
        print("Back navigation hit regions passed")
    }
}
