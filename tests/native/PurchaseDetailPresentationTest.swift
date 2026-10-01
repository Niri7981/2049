import Foundation

/// Safe overview fixtures only. No backend, wallet, or payment is used.
@main
struct PurchaseDetailPresentationTest {
    static func purchase(_ changes: [String: Any] = [:]) throws -> AppOverview.Purchase {
        var fields: [String: Any] = [
            "purchaseId": "fixture-request-with-a-long-stable-identifier",
            "status": "PAID", "deliveryStatus": "COMPLETE", "amount": "200000",
            "createdAt": 1_790_694_299_718 as Int64, "resourceId": "market-snapshot",
            "reason": "  Live devnet acceptance test  ", "executionMode": "live_devnet",
            "currency": "USDC", "assetDecimals": 6, "network": "solana:devnet",
            "decisionReason": "AUTHORITY_BUDGET_AND_GRANT_PASSED", "transaction": "fixture-transaction",
        ]
        fields.merge(changes) { _, value in value }
        return try JSONDecoder().decode(AppOverview.Purchase.self,
            from: JSONSerialization.data(withJSONObject: fields))
    }

    static func main() throws {
        func detail(_ changes: [String: Any] = [:]) throws -> PurchaseDetailPresentation {
            PurchaseDetailPresentation(try purchase(changes))
        }
        let delivered = try detail()
        precondition(delivered.title == "Market Snapshot" && delivered.status == "Delivered")
        precondition(delivered.stages.map(\.id) == [.approved, .paid, .delivered])
        precondition(delivered.stages[1].detail == "0.20 USDC · Devnet")
        precondition(delivered.stages.filter { $0.detail.contains("0.20 USDC") }.count == 1)
        precondition(delivered.stages.allSatisfy { $0.time == nil }, "Request creation is not a stage timestamp")
        precondition(!delivered.stages.map(\.title).contains("Reserved"), "The summary exposes no reservation event")
        precondition(delivered.authorityTitle == "Approved automatically")
        precondition(delivered.authorityReason.contains("at approval"), "Historical approval must not assert a currently active grant")
        precondition(delivered.resourceID == "market-snapshot" && delivered.resourceContext == "Live devnet acceptance test")
        precondition(delivered.receipts.map(\.label) == ["Transaction ID", "Request ID", "Network", "Request time"])
        precondition(delivered.receipts[0].copyValue == "fixture-transaction")
        precondition(delivered.receipts[1].copyValue == "fixture-request-with-a-long-stable-identifier")
        precondition(!delivered.receipts.contains { $0.label == "Channel" }, "Architecture does not prove a record's payment channel")

        let approved = try detail(["status": "APPROVED", "deliveryStatus": "NOT_PAID", "transaction": NSNull()])
        precondition(approved.stages.map(\.id) == [.approved])
        let denied = try detail(["status": "DENIED", "deliveryStatus": "NOT_PAID", "decisionReason": "DAILY_BUDGET_EXCEEDED"])
        precondition(denied.stages.map(\.id) == [.denied] && denied.authorityTitle == "Denied by policy")
        precondition(denied.authorityReason == "The shared daily spending limit was exceeded.")
        let expired = try detail(["status": "EXPIRED", "deliveryStatus": "NOT_PAID"])
        precondition(expired.stages.map(\.id) == [.approved, .expired])
        let failed = try detail(["status": "FAILED", "deliveryStatus": "NOT_PAID"])
        precondition(failed.stages.map(\.id) == [.approved, .failed])
        let unknown = try detail(["status": "PAYMENT_UNKNOWN", "deliveryStatus": "NOT_PAID"])
        precondition(unknown.stages.map(\.id) == [.approved, .paymentUnknown])
        precondition(unknown.stages.last?.tone == .pending)
        let pendingDelivery = try detail(["deliveryStatus": "PENDING"])
        precondition(pendingDelivery.stages.map(\.id) == [.approved, .paid, .deliveryPending])
        let requiresApproval = try detail(["status": "REQUIRES_APPROVAL", "deliveryStatus": "NOT_PAID", "decisionReason": "SINGLE_LIMIT_EXCEEDED"])
        precondition(requiresApproval.stages.map(\.id) == [.needsApproval])
        precondition(requiresApproval.authorityReason == "The per-transaction limit requires your approval.")

        let simulated = try detail(["executionMode": "simulated"])
        precondition(simulated.status == "Simulated" && simulated.tone == .neutral)
        precondition(simulated.stages.map(\.id) == [.approved, .simulatedPayment, .simulatedDelivery])
        precondition(simulated.stages[1].detail.contains("No funds transferred"))
        precondition(!simulated.receipts.contains { $0.label == "Transaction ID" })
        let unverified = try detail(["executionMode": "UNKNOWN"])
        precondition(unverified.status == "Payment unverified" && unverified.tone == .neutral)
        precondition(unverified.stages[1].id == .paymentUnverified && unverified.stages[1].tone == .neutral)
        precondition(unverified.stages.last?.tone == .neutral)
        let missing = try detail(["decisionReason": NSNull(), "network": NSNull(), "resourceId": NSNull(), "reason": " "])
        precondition(missing.authorityTitle == "Approved by policy" && missing.authorityReason == "Approval reason not provided.")
        precondition(missing.resourceID == nil && missing.resourceContext == nil)
        precondition(!missing.receipts.contains { $0.label == "Network" })
        precondition(!missing.stages[1].detail.contains("Devnet"), "Execution mode is not network metadata")
        let future = try detail(["status": "NEW_STATE", "decisionReason": "NEW_REASON", "deliveryStatus": "NOT_PAID"])
        precondition(future.stages.map(\.id) == [.unavailable] && future.authorityTitle == "Decision unavailable")
        let newReason = try detail(["status": "DENIED", "decisionReason": "NEW_POLICY_REASON", "deliveryStatus": "NOT_PAID"])
        precondition(newReason.authorityReason == "Policy reason: NEW_POLICY_REASON")
        let asset = try detail(["assetId": "fixture-asset-id"])
        precondition(asset.receipts.last?.label == "Asset ID" && asset.receipts.last?.copyValue == "fixture-asset-id")
        print("Purchase detail: truthful lifecycle, historical policy, missing metadata, simulation, unknown payment, and full receipt IDs passed")
    }
}
