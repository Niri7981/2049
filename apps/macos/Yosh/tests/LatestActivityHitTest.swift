import AppKit
import SwiftUI

/// Exercises the actual Authority Latest Activity controls using callback-only fixtures.
@main
struct LatestActivityHitTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        var listOpens = 0
        var detailOpens: [String] = []
        let fields: [String: Any] = [
            "service": ["status": "running", "purchaseMode": "simulated", "network": "Solana Devnet"],
            "wallet": ["address": "FixtureAddress"],
            "budget": ["dailyLimit": "1000000", "dailyLimitDisplay": "Fixture limit", "paid": "200000",
                "reserved": "0", "remaining": "800000", "remainingDisplay": "Fixture remaining", "paused": false],
            "grant": NSNull(), "connection": ["enabled": true, "lastSeen": NSNull(), "access": "purchase_intent"],
            "purchases": [["purchaseId": "visible-latest", "status": "PAID", "deliveryStatus": "PENDING",
                "amount": "200000", "createdAt": 1_800_000_000_000 as Int64, "resourceId": "market-snapshot",
                "reason": "Fixture context", "executionMode": "live_devnet", "currency": "USDC", "assetDecimals": 6]],
        ]
        let overview = try JSONDecoder().decode(AppOverview.self, from: JSONSerialization.data(withJSONObject: fields))
        let latest = AuthorityOverviewPresentation(overview).latest
        precondition(latest?.purchaseId == "visible-latest", "Visible summary must retain its backend record ID")
        func page(_ latest: AuthorityOverviewPresentation.Latest?, available: Bool = true) -> some View {
            BackLatestPurchase(latest: latest, agentName: "Codex", isLoading: !available,
                activityAvailable: available, onActivity: { listOpens += 1 },
                onPurchase: { detailOpens.append($0) })
                .frame(width: 368, height: 140, alignment: .topLeading)
        }
        let host = NSHostingView(rootView: page(latest))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 368, height: 140),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))
        click(window, at: NSPoint(x: 100, y: 134))
        guard listOpens == 1 else {
            print("FAIL: LATEST ACTIVITY heading must independently open the full list")
            exit(1)
        }
        precondition(detailOpens.isEmpty)
        click(window, at: NSPoint(x: 360, y: 91))
        precondition(detailOpens == ["visible-latest"] && listOpens == 1,
            "Right-hand record arrow must open only the displayed purchase")

        host.rootView = page(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))
        click(window, at: NSPoint(x: 100, y: 134))
        click(window, at: NSPoint(x: 360, y: 91))
        precondition(listOpens == 2 && detailOpens == ["visible-latest"],
            "Empty history remains accessible without a fabricated purchase detail")

        host.rootView = page(latest, available: false)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.2))
        click(window, at: NSPoint(x: 100, y: 134))
        click(window, at: NSPoint(x: 360, y: 91))
        precondition(listOpens == 2 && detailOpens == ["visible-latest"],
            "Loading or saving must disable both routes")
        window.close()
        print("Latest Activity: separate list/detail hit regions, matching record ID, empty and unavailable states passed")
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
