import Foundation

@main
struct ManagementClientSmoke {
    static func main() async throws {
        let port = ProcessInfo.processInfo.environment["APP2049_PORT"]!
        let token = ProcessInfo.processInfo.environment["APP2049_MANAGEMENT_TOKEN"]!
        let runtime = NativeServiceRuntime(environment: ["APP2049_PORT": port, "APP2049_MANAGEMENT_TOKEN": token])
        let client = OverviewClient(runtime: runtime)
        let unauthorizedRuntime = NativeServiceRuntime(environment: ["APP2049_PORT": port, "APP2049_MANAGEMENT_TOKEN": String(repeating: "x", count: 43)])
        do {
            _ = try await OverviewClient(runtime: unauthorizedRuntime).load()
            fatalError("Wrong management token unexpectedly worked")
        } catch let error as OverviewLoadError {
            guard case .unauthorized = error else { throw error }
        }
        let initial = try await client.load()
        precondition(!initial.connection.enabled && initial.grant == nil)
        precondition(initial.purchases.count == 2)
        let simulated = PurchasePresentation(initial.purchases[0])
        precondition(simulated.status == "Simulated payment" && simulated.amount == "0.01 USDC")
        let unknown = PurchasePresentation(initial.purchases[1])
        precondition(unknown.status == "Payment status unknown" && unknown.amount == "0.000001 USDC")

        let activityBase: [String: Any] = ["purchaseId": "activity-fixture", "status": "APPROVED",
            "deliveryStatus": "NOT_DELIVERED", "amount": "200000", "createdAt": 1_000 as Int64,
            "resourceId": "market-snapshot", "executionMode": "simulated", "currency": "USDC", "assetDecimals": 6]
        func activity(_ changes: [String: Any]) throws -> ActivityPurchasePresentation {
            var fields = activityBase
            for (key, value) in changes { fields[key] = value }
            let data = try JSONSerialization.data(withJSONObject: fields)
            return ActivityPurchasePresentation(try JSONDecoder().decode(AppOverview.Purchase.self, from: data))
        }
        let approved = try activity([:])
        precondition(approved.title == "SOL Market Snapshot" && approved.status == "Approved"
            && approved.amount == "0.20 USDC" && approved.payment == "No payment made · Simulated"
            && approved.supportingStatus == "No payment made")
        let denied = try activity(["resourceId": "market-analysis", "status": "DENIED", "amount": "20000000",
            "decisionReason": "SPEND_GRANT_SINGLE_LIMIT_EXCEEDED"])
        precondition(denied.title == "SOL Market Analysis" && denied.status == "Denied"
            && denied.amount == "20.00 USDC" && denied.denialReason == "Per-transaction limit exceeded")
        let expired = try activity(["status": "EXPIRED"])
        let paying = try activity(["status": "PAYING", "executionMode": "live_devnet"])
        let paymentUnknown = try activity(["status": "PAYMENT_UNKNOWN", "executionMode": "live_devnet"])
        let failed = try activity(["status": "FAILED", "executionMode": "live_devnet"])
        precondition(expired.status == "Expired" && paying.status == "Paying"
            && paymentUnknown.status == "Payment unknown" && failed.status == "Failed")
        let paid = try activity(["status": "PAID", "deliveryStatus": "PENDING", "executionMode": "live_devnet"])
        precondition(paid.status == "Paid" && paid.payment == "Paid" && paid.delivery == "Pending")
        let delivered = try activity(["status": "PAID", "deliveryStatus": "COMPLETE", "executionMode": "live_devnet"])
        let simulatedPaid = try activity(["status": "PAID", "deliveryStatus": "COMPLETE"])
        let unknownResource = try activity(["resourceId": "legacy-unknown", "offerId": "premium"])
        let legacyOffer = try activity(["resourceId": NSNull(), "offerId": "basic"])
        precondition(delivered.status == "Delivered" && simulatedPaid.status == "Simulated")
        precondition(unknownResource.title == "Resource request" && legacyOffer.title == "SOL Market Snapshot")

        try await client.setConnection(true)
        let connected = try await client.load()
        precondition(connected.connection.enabled)

        let expiresAt = Int64(Date.now.addingTimeInterval(3_600).timeIntervalSince1970 * 1_000)
        try await client.createGrant(totalLimit: "5000000", singleLimit: "500000", expiresAt: expiresAt)
        let created = try await client.load()
        precondition(created.grant?.status == .active && created.grant?.totalLimit.value == 5_000_000)

        try await client.createGrant(totalLimit: "7000000", singleLimit: "1000000", expiresAt: expiresAt)
        let replaced = try await client.load()
        precondition(replaced.grant?.totalLimit.value == 7_000_000 && replaced.grant?.singleLimit.value == 1_000_000)

        do {
            try await client.createGrant(totalLimit: "0", singleLimit: "1000000", expiresAt: expiresAt)
            fatalError("Rejected grant write unexpectedly succeeded")
        } catch let error as OverviewLoadError {
            guard case .invalidRequest = error else { throw error }
        }
        let afterRejectedWrite = try await client.load()
        precondition(afterRejectedWrite.grant?.totalLimit.value == 7_000_000)

        try await client.revokeGrant()
        let revoked = try await client.load()
        precondition(revoked.grant?.status == .revoked)
        try await client.setConnection(false)
        let disconnected = try await client.load()
        precondition(!disconnected.connection.enabled)

        try await client.setDailyLimit("9000000")
        let limited = try await client.load()
        precondition(limited.budget.dailyLimit?.value == 9_000_000)
        try await client.setPaused(true)
        let paused = try await client.load()
        precondition(paused.budget.paused)
        try await client.setPaused(false)
        let resumed = try await client.load()
        precondition(!resumed.budget.paused)

        print("Native management client smoke passed")
    }
}
