import AppKit
import SwiftUI

private enum DetailRoute: Hashable {
    case activity, purchase(String), member(UUID)
    var parent: DetailRoute? {
        if case .purchase = self { return .activity }
        return nil
    }
}

@MainActor @Observable
private final class ScrollProbe {
    var navigation = YoshDetailNavigation<DetailRoute>()
    var refreshing = false
    var selectedPurchase: String?
    var selectedMember: UUID?
    func show(_ route: DetailRoute?) { navigation.show(route, parent: { $0.parent }) }
}

private struct DetailFixture: View {
    let probe: ScrollProbe
    let purchases: [AppOverview.Purchase]
    let members: [CardMemberSummary]
    let reduceMotion: Bool
    var body: some View {
        YoshDetailStack(navigation: probe.navigation, reduceMotion: reduceMotion, parent: { $0.parent }) {
            MembersRoster(presentation: MembersRosterPresentation(members), selectedMemberID: probe.selectedMember,
                isLoading: false, interactionsDisabled: false, error: nil,
                onSelect: { probe.selectedMember = $0; probe.show(.member($0)) }, onConnect: { _ in }, onAdd: {}, onRetry: nil)
                .padding(.horizontal, CardPageHeader.Layout.contentInset)
                .padding(.top, CardPageHeader.Layout.topSpacing).padding(.bottom, 12)
        } destination: { route in
            switch route {
            case .activity:
                ActivityDetail(purchases: purchases, agentName: "Fixture", isRefreshing: probe.refreshing,
                    refreshError: nil, onBack: { probe.show(nil) }, onRefresh: {},
                    onSelect: { probe.selectedPurchase = $0; probe.show(.purchase($0)) })
            case .purchase(let id):
                if let purchase = purchases.first(where: { $0.purchaseId == id }) {
                    PurchaseDetail(purchase: purchase, agentName: "Fixture", backTitle: "Activity",
                        onBack: { probe.show(.activity) }, onCopy: { _ in })
                }
            case .member(let id):
                Text(id.uuidString).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 420, height: 526)
        .background(Color(white: 0.95)).environment(\.colorScheme, .light)
    }
}

/// Real roster, Activity and Purchase scroll views inside the production depth stack.
@main
struct DetailScrollStabilityTest {
    @MainActor static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let purchases = try (0..<25).map { index in
            try JSONDecoder().decode(AppOverview.Purchase.self, from: JSONSerialization.data(withJSONObject: [
                "purchaseId": "receipt-\(index)", "status": "PAID", "deliveryStatus": "COMPLETE", "amount": "200000",
                "createdAt": 1_790_694_299_718 - Int64(index) * 3_600_000, "resourceId": "market-snapshot",
                "reason": "Fixture", "executionMode": "simulated", "currency": "USDC", "assetDecimals": 6,
                "transaction": String(repeating: "fixture-receipt-", count: 15),
            ]))
        }
        let members = try (0..<10).map { index in
            try JSONDecoder().decode(CardMemberSummary.self, from: JSONSerialization.data(withJSONObject: [
                "member": ["id": UUID().uuidString, "label": "Member \(index)", "status": "ACTIVE",
                    "isDefault": index == 0, "createdAt": 1, "updatedAt": 1],
                "connection": ["enabled": false, "lastSeen": NSNull(), "access": "read_only"],
            ]))
        }
        for reduceMotion in [false, true] { try validate(purchases: purchases, members: members, reduceMotion: reduceMotion) }
        print("Detail scroll stability: real Members/Activity/Purchase retain native scroll positions, fixed viewports and selected identities through repeated/rapid Back and Reduce Motion")
    }

    @MainActor private static func validate(purchases: [AppOverview.Purchase], members: [CardMemberSummary], reduceMotion: Bool) throws {
        let probe = ScrollProbe()
        let host = NSHostingView(rootView: DetailFixture(probe: probe, purchases: purchases, members: members, reduceMotion: reduceMotion))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 526),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        defer { window.close() }
        pause(0.35)
        guard let roster = scrollViews(host).first else { throw Failure("Missing native roster") }
        let rosterFrame = roster.convert(roster.bounds, to: host)
        try require(abs(roster.contentView.bounds.origin.y) < 0.5, "Roster must start at the top")
        probe.show(.activity)
        pause(0.4)
        guard let activity = scrollViews(host).first(where: { $0 !== roster }) else { throw Failure("Missing Activity scroll view") }
        let activityFrame = activity.convert(activity.bounds, to: host)
        try require(abs(activity.contentView.bounds.origin.y) < 0.5, "Entering Activity must not invent a scroll offset")
        probe.selectedPurchase = purchases[0].purchaseId
        probe.show(.purchase(purchases[0].purchaseId))
        pause(0.4)
        guard let receipt = scrollViews(host).first(where: { $0 !== roster && $0 !== activity }) else { throw Failure("Missing Purchase scroll view") }
        let receiptFrame = receipt.convert(receipt.bounds, to: host)
        try require(abs(receipt.contentView.bounds.origin.y) < 0.5, "Purchase must initially start at the top")
        for route in [DetailRoute.activity, .purchase(purchases[0].purchaseId), .activity] {
            probe.show(route)
            pause(0.4)
            try require(abs(activity.contentView.bounds.origin.y) < 0.5 && abs(receipt.contentView.bounds.origin.y) < 0.5,
                "Entering and Back without wheel input must not move either scroll position")
        }
        scroll(activity, by: 190)
        pause(0.1)
        let activityY = activity.contentView.bounds.origin.y
        try require(activityY > 100, "Activity must actually scroll before the retention test")
        probe.show(.purchase(purchases[0].purchaseId))
        pause(0.4)
        scroll(receipt, by: 140)
        pause(0.1)
        let receiptY = receipt.contentView.bounds.origin.y
        try require(receiptY > 60, "Receipt must actually scroll before the retention test")
        for route in [DetailRoute.activity, .purchase(purchases[0].purchaseId), .activity, .purchase(purchases[0].purchaseId), .activity] {
            probe.show(route)
            pause(0.025)
        }
        pause(0.4)
        try require(abs(activity.contentView.bounds.origin.y - activityY) < 0.5
            && abs(receipt.contentView.bounds.origin.y - receiptY) < 0.5,
            "Rapid nested Back must retain both deliberate scroll positions: activity=\(activity.contentView.bounds.origin.y) expected=\(activityY), receipt=\(receipt.contentView.bounds.origin.y) expected=\(receiptY)")
        try require(sameLayout(activity.convert(activity.bounds, to: host), activityFrame), "Activity viewport must return to its exact layout")
        probe.show(.purchase(purchases[0].purchaseId))
        pause(0.4)
        try require(sameLayout(receipt.convert(receipt.bounds, to: host), receiptFrame), "Purchase viewport must return to its exact layout")
        probe.show(nil)
        pause(0.4)
        scroll(roster, by: 160)
        pause(0.1)
        let rosterY = roster.contentView.bounds.origin.y
        try require(rosterY > 100, "Roster must actually scroll")
        probe.selectedMember = members[0].member.id
        probe.show(.member(members[0].member.id))
        pause(0.035)
        probe.show(nil)
        pause(0.4)
        try require(abs(roster.contentView.bounds.origin.y - rosterY) < 0.5
            && sameLayout(roster.convert(roster.bounds, to: host), rosterFrame), "Member Back must restore the roster context")
        try require(probe.selectedMember == members[0].member.id && probe.selectedPurchase == purchases[0].purchaseId,
            "Back must preserve selected member and purchase identities")
    }

    @MainActor private static func scrollViews(_ view: NSView) -> [NSScrollView] {
        if let scroll = view as? NSScrollView { return [scroll] }
        return view.subviews.flatMap(scrollViews)
    }
    @MainActor private static func scroll(_ view: NSScrollView, by pixels: Int32) {
        // Hidden fixture windows have no physical wheel target. Set the deliberate
        // position through the real native clip view, then verify navigation retains it.
        let origin = view.contentView.bounds.origin
        let maximum = max(0, (view.documentView?.bounds.height ?? 0) - view.contentView.bounds.height)
        view.contentView.scroll(to: NSPoint(x: origin.x, y: min(maximum, max(0, origin.y + CGFloat(pixels)))))
        view.reflectScrolledClipView(view.contentView)
    }
    @MainActor private static func pause(_ duration: TimeInterval) { RunLoop.current.run(until: .now.addingTimeInterval(duration)) }
    private static func sameLayout(_ actual: CGRect, _ expected: CGRect) -> Bool {
        abs(actual.minX - expected.minX) < 0.1 && abs(actual.minY - expected.minY) < 0.1
            && abs(actual.width - expected.width) < 0.1 && abs(actual.height - expected.height) < 0.1
    }
    private static func require(_ condition: Bool, _ message: String) throws { if !condition { throw Failure(message) } }
    private struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
}
