import Foundation

@main
struct ActivityEnvironmentIsolationTest {
    static func main() throws {
        let mainnet = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
        let devnet = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
        func record(_ id: String, _ environment: String?, _ network: String, _ status: String = "PAID") -> [String: Any] {
            ["purchaseId": id, "status": status, "deliveryStatus": "PENDING", "amount": "200000",
             "createdAt": 1_800_000_000_000 as Int64, "resourceId": "market-snapshot",
             "executionMode": status == "DENIED" ? "UNKNOWN" : environment == "simulated" ? "simulated" : environment == "legacy_test" ? "UNKNOWN" : environment ?? "UNKNOWN",
             "monetaryEnvironment": environment.map { $0 as Any } ?? NSNull(), "network": network,
             "currency": "USDC", "assetDecimals": 6]
        }
        let records = [record("test", "live_devnet", devnet), record("simulation", "simulated", devnet),
                       record("main", "live_mainnet", mainnet), record("main-denied", "live_mainnet", mainnet, "DENIED"),
                       record("mismatch", "live_mainnet", devnet), record("unscoped", nil, mainnet), record("legacy", "legacy_test", devnet)]
        func overview(_ mode: String, _ purchases: [[String: Any]]) throws -> AppOverview {
            let fields: [String: Any] = [
                "service": ["status": "running", "purchaseMode": mode, "network": mode == "live_mainnet" ? "Solana Mainnet" : "Solana Devnet"],
                "wallet": ["address": "Fixture"], "budget": ["dailyLimit": NSNull(), "dailyLimitDisplay": "—", "paid": "0", "reserved": "0", "remaining": NSNull(), "remainingDisplay": "—", "paused": true],
                "connection": ["enabled": false, "lastSeen": NSNull(), "access": "purchase_intent"], "purchases": purchases]
            return try JSONDecoder().decode(AppOverview.self, from: JSONSerialization.data(withJSONObject: fields))
        }
        let main = try overview("live_mainnet", records)
        precondition(AuthorityOverviewPresentation(main).latest?.purchaseId == "main", "Mainnet Activity summary must not show a newer Devnet record")
        precondition(main.activityPurchases.map(\.purchaseId) == ["main", "main-denied"])
        precondition(main.purchases.count == records.count, "Filtering must not delete or rewrite ledger records")
        let test = try overview("live_devnet", records)
        precondition(test.activityPurchases.map(\.purchaseId) == ["test", "legacy"])
        let simulation = try overview("simulated", records)
        precondition(simulation.activityPurchases.map(\.purchaseId) == ["simulation"])
        for selected in [main, test, simulation] {
            let rows = ActivityLedgerPresentation(selected.activityPurchases, agentName: "Codex").days.flatMap(\.rows)
            precondition(Set(rows.map(\.id)) == Set(selected.activityPurchases.map(\.purchaseId)))
            precondition(AuthorityOverviewPresentation(selected).latest?.purchaseId == selected.activityPurchases.first?.purchaseId)
        }
        let noMainnet = try overview("live_mainnet", [records[0], records[1], records[4], records[5]])
        precondition(noMainnet.activityPurchases.isEmpty && AuthorityOverviewPresentation(noMainnet).latest == nil,
            "An environment without purchases must show an empty state rather than borrow test history")
        for state in ["APPROVED", "DENIED", "PAYING", "PAYMENT_UNKNOWN", "PAID", "FAILED"] {
            let scoped = try overview("live_mainnet", [record("state", "live_mainnet", mainnet, state)])
            precondition(scoped.activityPurchases.count == 1, "Environment isolation must retain every payment/policy state")
        }
        print("Activity isolation: Mainnet/Devnet/Simulation summaries, ledger rows, empty states, legacy test scope, missing/conflicting metadata, all lifecycle states and preserved history passed")
    }
}
