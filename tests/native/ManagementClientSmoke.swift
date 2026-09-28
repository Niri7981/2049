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
