import AppKit
import SwiftUI

/// Exercises native layout/scrolling and the real row's detail callback using simulated fixtures.
@main
struct ActivityLedgerViewTest {
    @MainActor
    static func main() throws {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        let purchases = try (0..<20).map { index in
            let fields: [String: Any] = [
                "purchaseId": "fixture-\(index)", "status": index == 1 ? "DENIED" : "APPROVED",
                "deliveryStatus": "NOT_PAID", "amount": "200000",
                "createdAt": Int64(Date.now.addingTimeInterval(Double(-index) * 3_600).timeIntervalSince1970 * 1_000),
                "resourceId": index == 1 ? "token-risk-report" : "market-snapshot",
                "reason": "Fixture inspection", "executionMode": "simulated",
                "currency": "USDC", "assetDecimals": 6,
            ]
            return try JSONDecoder().decode(AppOverview.Purchase.self,
                from: JSONSerialization.data(withJSONObject: fields))
        }
        var selections: [String] = []
        let row = ActivityLedgerPresentation.Row(purchases[0], agentName: "Codex")
        let rowHost = NSHostingView(rootView: ActivityLedgerRow(row: row, onSelect: { selections.append($0) })
            .frame(width: 368, height: 80))
        let rowWindow = hostWindow(rowHost, size: NSSize(width: 368, height: 80))
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: NSPoint(x: 360, y: 40), modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: rowWindow.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
            rowWindow.sendEvent(event)
        }
        precondition(selections == [purchases[0].purchaseId], "Full row hit region must retain purchase identity")
        rowWindow.close()

        let view = ActivityDetail(purchases: purchases, agentName: "Codex", isRefreshing: false,
            refreshError: nil, onBack: {}, onRefresh: {}, onSelect: { _ in })
            .frame(width: 420, height: 526)
            .background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light)
        let host = NSHostingView(rootView: view)
        let window = hostWindow(host, size: NSSize(width: 420, height: 526))
        guard let scroll = scrollView(in: host), let document = scroll.documentView else {
            fatalError("Activity must expose one native scrollable ledger")
        }
        precondition(host.frame.size == NSSize(width: 420, height: 526))
        precondition(document.bounds.height > scroll.contentView.bounds.height, "History must continue below the viewport")
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1, "Ledger must fit without horizontal scrolling")
        if CommandLine.arguments.count == 2,
           let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) {
            host.cacheDisplay(in: host.bounds, to: bitmap)
            try bitmap.representation(using: .png, properties: [:])?.write(to: URL(filePath: CommandLine.arguments[1]))
        }
        window.close()
        print("Activity native view: fixed Connection viewport, vertical overflow, and row detail identity passed")
    }

    @MainActor
    private static func hostWindow(_ host: NSView, size: NSSize) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))
        return window
    }

    @MainActor
    private static func scrollView(in view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView { return scroll }
        for child in view.subviews {
            if let scroll = scrollView(in: child) { return scroll }
        }
        return nil
    }
}
