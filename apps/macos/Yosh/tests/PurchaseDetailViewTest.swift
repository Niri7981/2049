import AppKit
import SwiftUI

/// Native fixture hosting only; never connects to the installed app or payment backend.
@main
struct PurchaseDetailViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let transaction = String(repeating: "fixture-chain-receipt-", count: 10)
        let request = String(repeating: "fixture-stable-request-", count: 12)
        let fields: [String: Any] = [
            "purchaseId": request, "status": "PAID", "deliveryStatus": "COMPLETE",
            "amount": "200000", "createdAt": 1_790_694_299_718 as Int64,
            "resourceId": "market-snapshot", "reason": "Fixture inspection",
            "executionMode": "live_devnet", "network": "solana:devnet",
            "currency": "USDC", "assetDecimals": 6,
            "decisionReason": "AUTHORITY_BUDGET_AND_GRANT_PASSED", "transaction": transaction,
        ]
        let purchase = try JSONDecoder().decode(AppOverview.Purchase.self,
            from: JSONSerialization.data(withJSONObject: fields))
        var backs = 0
        var copies: [String] = []
        let view = PurchaseDetail(purchase: purchase, agentName: "Codex", backTitle: "Activity",
            onBack: { backs += 1 }, onCopy: { copies.append($0) })
            .frame(width: 420, height: 526)
            .background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light)
        let host = NSHostingView(rootView: view)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 526),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))
        guard let scroll = findScroll(in: host), let document = scroll.documentView else {
            fatalError("Detail must use a native vertical scroll view")
        }
        precondition(host.frame.size == NSSize(width: 420, height: 526))
        precondition(document.bounds.height > scroll.contentView.bounds.height, "Receipt continues below the fold")
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1, "Long IDs must not create horizontal scrolling")

        click(window, at: NSPoint(x: 60, y: 490))
        precondition(backs == 1)

        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-top.png") }
        let bottom = max(0, document.bounds.height - scroll.contentView.bounds.height)
        scroll.contentView.scroll(to: NSPoint(x: 0, y: bottom))
        scroll.reflectScrolledClipView(scroll.contentView)
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
        click(window, at: NSPoint(x: 366, y: 106))
        click(window, at: NSPoint(x: 366, y: 78))
        precondition(copies == [transaction, request], "Copy must retain every character, independently of middle truncation")
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1)
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-bottom.png") }
        window.close()
        print("Purchase detail native view: 420×526 viewport, vertical scrolling, long-ID containment, full copy, and Activity back action passed")
    }

    @MainActor
    private static func findScroll(in view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView { return scroll }
        return view.subviews.compactMap { findScroll(in: $0) }.first
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
    private static func render(_ host: NSView, to path: String) throws {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("Fixture image unavailable") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])?.write(to: URL(filePath: path))
    }
}
