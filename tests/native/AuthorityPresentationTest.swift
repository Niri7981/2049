import Foundation

/// Isolated presentation fixtures: no service, signer, payment or UI is started.
@main
@MainActor
struct AuthorityPresentationTest {
    private static let now = Date(timeIntervalSince1970: 1_800_000_000)
    private static let purchase: [String: Any] = [
        "purchaseId": "authority-fixture", "status": "APPROVED", "deliveryStatus": "NOT_PAID",
        "amount": "200000", "createdAt": 1_799_913_600_000 as Int64,
        "resourceId": "market-snapshot", "reason": "Research context",
        "executionMode": "live_devnet", "currency": "USDC", "assetDecimals": 6,
    ]

    private static func presentation(
        changes: [String: Any] = [:], remaining: String? = "650000",
        hasPurchase: Bool = true, network: String = "Solana Devnet"
    ) throws -> AuthorityOverviewPresentation {
        var record = purchase
        record.merge(changes) { _, new in new }
        let payload: [String: Any] = [
            "service": ["status": "running", "purchaseMode": "simulated", "network": network],
            "wallet": ["address": "FixturePublicAddress"],
            "budget": [
                "dailyLimit": remaining == nil ? NSNull() : "1000000",
                "dailyLimitDisplay": "Fixture limit", "paid": "100000", "reserved": "200000",
                "remaining": remaining.map { $0 as Any } ?? NSNull(),
                "remainingDisplay": "Fixture remaining", "paused": false,
            ],
            "grant": ["id": "fixture-grant", "status": "EXPIRED", "totalLimit": "5000000",
                "remaining": "4800000", "singleLimit": "1000000", "assetDecimals": 6,
                "expiresAt": 1_799_000_000_000 as Int64],
            "connection": ["enabled": true, "lastSeen": NSNull(), "access": "purchase_intent"],
            "purchases": hasPurchase ? [record] : [],
        ]
        let overview = try JSONDecoder().decode(AppOverview.self,
            from: JSONSerialization.data(withJSONObject: payload))
        return AuthorityOverviewPresentation(overview, now: now)
    }

    static func main() throws {
        let approved = try presentation()
        // Backend remaining deliberately differs from limit - paid - reserved.
        // The view must display that authoritative value rather than recomputing it.
        precondition(approved.remaining == "$0.65" && approved.progress == 0.65)
        precondition(approved.grantRemaining == "—" && approved.grantDetail == "expired"
            && approved.perTransaction == "—")
        precondition(approved.latest?.decision == "APPROVED" && approved.latest?.payment == "Not paid"
            && approved.latest?.paymentConfirmed == false)
        precondition(approved.latest?.title == "Market Snapshot" && approved.latest?.purpose == "Research context"
            && approved.latest?.amount == "0.2 USDC" && approved.latest?.recency.isEmpty == false)

        let unset = try presentation(remaining: nil, hasPurchase: false)
        precondition(unset.remaining == "—" && unset.dailyLimit == "daily limit not set"
            && unset.progress == 0 && unset.latest == nil)
        let zero = try presentation(remaining: "0")
        precondition(zero.remaining == "$0.00" && zero.progress == 0)

        let paid = try presentation(changes: ["status": "PAID", "deliveryStatus": "PENDING"])
        precondition(paid.latest?.payment == "Paid" && paid.latest?.paymentConfirmed == true
            && paid.latest?.decision == "APPROVED")
        let simulated = try presentation(changes: ["status": "PAID", "deliveryStatus": "COMPLETE", "executionMode": "simulated"])
        precondition(simulated.latest?.payment == "Simulated payment" && simulated.latest?.paymentConfirmed == false
            && simulated.latest?.decisionTone == .neutral)
        let unverified = try presentation(changes: ["status": "PAID", "executionMode": "UNKNOWN"])
        precondition(unverified.latest?.payment == "Recorded as paid" && unverified.latest?.paymentConfirmed == false
            && unverified.latest?.decisionTone == .neutral)
        let unknown = try presentation(changes: ["status": "PAYMENT_UNKNOWN"])
        precondition(unknown.latest?.payment == "Payment status unknown" && unknown.latest?.paymentConfirmed == false
            && unknown.latest?.decision == "APPROVED" && unknown.latest?.decisionTone == .neutral)
        let denied = try presentation(changes: ["status": "DENIED"])
        precondition(denied.latest?.payment == "Not paid" && denied.latest?.decision == "DENIED")
        let needsApproval = try presentation(changes: ["status": "REQUIRES_APPROVAL"])
        precondition(needsApproval.latest?.payment == "Awaiting approval" && needsApproval.latest?.decision == "NEEDS APPROVAL")
        for status in ["FAILED", "EXPIRED"] {
            let result = try presentation(changes: ["status": status])
            precondition(result.latest?.paymentConfirmed == false && result.latest?.decisionTone == .neutral)
            precondition(result.latest?.payment == (status == "FAILED" ? "Failed" : "Expired"))
        }
        let unavailable = try presentation(changes: ["status": "UNRECOGNIZED", "resourceId": "unknown-resource", "offerId": "basic"])
        precondition(unavailable.latest?.decision == "UNAVAILABLE" && unavailable.latest?.title == "unknown-resource")
        let legacy = try presentation(changes: ["resourceId": NSNull(), "offerId": "basic", "reason": "  "])
        precondition(legacy.latest?.title == "Market Snapshot" && legacy.latest?.purpose == nil)
        let network = try presentation(network: "Fixture network")
        precondition(network.execution == "Simulated · Fixture network")
        print("Native Authority presentation tests passed")
    }
}
