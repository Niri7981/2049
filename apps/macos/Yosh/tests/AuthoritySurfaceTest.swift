import Foundation

@main
struct AuthoritySurfaceTest {
    static func main() throws {
        func decode<T: Decodable>(_ type: T.Type, _ payload: [String: Any]) throws -> T {
            try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: payload))
        }
        let mainNetwork = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", testNetwork = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"
        func payload(mainnet: Bool, grant: Bool = false) -> [String: Any] {
            let mode = mainnet ? "live_mainnet" : "live_devnet"
            let network = mainnet ? mainNetwork : testNetwork
            let label = mainnet ? "USDC" : "Test USDC"
            let mint = mainnet ? "mainnet-mint" : "devnet-mint"
            let rawGrant: [String: Any] = ["id": "test-grant", "resourceId": "test-api", "status": "ACTIVE", "totalLimit": "5000000", "remaining": "4000000", "singleLimit": "100000", "assetDecimals": 6, "expiresAt": 2_000_000_000_000 as Int64]
            return ["service": ["status": "running", "purchaseMode": mode, "network": mainnet ? "Solana Mainnet" : "Solana Devnet",
                                "execution": ["mode": mode, "cluster": mainnet ? "mainnet-beta" : "devnet", "network": network,
                                              "asset": ["network": network, "mint": mint, "symbol": "USDC", "decimals": 6, "displayLabel": label],
                                              "productionExecutionEnabled": false, "spendingAuthorized": false, "configurationReady": false]],
                    "wallet": ["address": ""],
                    "budget": ["dailyLimit": "9000000", "dailyLimitDisplay": "9 Test USDC", "paid": "0", "reserved": "0", "remaining": "9000000", "remainingDisplay": "9 Test USDC", "paused": false],
                    "grant": grant ? rawGrant : NSNull(),
                    "connection": ["enabled": false, "lastSeen": NSNull(), "access": "purchase_intent"], "purchases": [],
                    "authority": ["mode": mode, "network": network, "assetId": mint, "assetDecimals": 6, "assetLabel": label,
                                  "dailyLimit": "3000000", "available": "1850000", "reserved": "900000", "paid": "250000", "availableDisplay": "1.85", "reservedDisplay": "0.90", "paidDisplay": "0.25",
                                  "dailyLimitDisplay": "of 3.00 \(label) daily", "dailyState": "paused", "blockers": ["Mainnet execution is disabled", "Payments are paused", "Spend Grant required", "Mainnet wallet unavailable"],
                                  "wallet": ["address": "", "network": mainnet ? "Solana Mainnet" : "Solana Devnet", "status": "unavailable"], "grant": NSNull()]]
        }
        let mainnet = try decode(AppOverview.self, payload(mainnet: true, grant: true))
        let main = AuthorityOverviewPresentation(mainnet)
        precondition(main.remaining == "1.85" && main.reserved == "0.90" && main.paid == "0.25", "Use exact backend displays, never Swift-computed totals or another budget")
        precondition(main.asset == "USDC" && !main.dailyLimit.contains("Test"))
        precondition(main.grantRemaining == "—" && mainnet.scopedGrant == nil, "Test grant must not appear usable in Mainnet")
        precondition(main.dailyState == "Payments are paused" && main.blockedReason == "Mainnet execution is disabled")
        let test = try decode(AppOverview.self, payload(mainnet: false))
        precondition(AuthorityOverviewPresentation(test).asset == "Test USDC")
        var missing = payload(mainnet: true, grant: true); missing.removeValue(forKey: "authority")
        let missingProjection = AuthorityOverviewPresentation(try decode(AppOverview.self, missing))
        precondition(missingProjection.remaining == "—" && missingProjection.reserved == "—" && missingProjection.paid == "—", "Missing Mainnet scope fails closed")
        var mismatched = payload(mainnet: true)
        guard var authority = mismatched["authority"] as? [String: Any] else { fatalError("Missing fixture authority") }
        authority["network"] = testNetwork; authority["assetId"] = "devnet-mint"; mismatched["authority"] = authority
        let mismatchedOverview = try decode(AppOverview.self, mismatched)
        precondition(AuthorityOverviewPresentation(mismatchedOverview).remaining == "—", "Cross-network scope must be rejected")
        let daily = DailyAuthorityPresentation(overview: mainnet)
        let good = try decode(AppBalance.self, ["amount": "5000000", "display": "5.00 USDC", "available": true, "network": mainNetwork, "assetId": "mainnet-mint", "assetDecimals": 6])
        precondition(daily.balanceDisplay(good) == "5.00 USDC")
        let wrong = try decode(AppBalance.self, ["amount": "5000000", "display": "5.00 Test USDC", "available": true, "network": testNetwork, "assetId": "devnet-mint", "assetDecimals": 6])
        precondition(daily.balanceDisplay(wrong) == nil, "A test balance must never be relabeled as Mainnet USDC")
        precondition(mainnet.selectedAuthority?.wallet.status == .unavailable && mainnet.selectedAuthority?.wallet.address == "")
        var scopedPayload = payload(mainnet: true, grant: true)
        guard var rawGrant = scopedPayload["grant"] as? [String: Any],
              var validScope = scopedPayload["authority"] as? [String: Any] else { fatalError("Missing grant fixture") }
        rawGrant["network"] = mainNetwork; rawGrant["assetId"] = "mainnet-mint"; rawGrant["resourceId"] = "registered-api"
        let grantScope: [String: Any] = ["id": "test-grant", "resourceId": "registered-api", "api": "https://provider.example/data", "network": "Solana Mainnet", "assetLabel": "USDC", "totalDisplay": "5.00", "remainingDisplay": "4.00", "committedDisplay": "1.00", "singleDisplay": "0.10", "status": "ACTIVE", "expiresAt": 2_000_000_000_000 as Int64, "usable": true]
        validScope["grant"] = grantScope; scopedPayload["authority"] = validScope; scopedPayload["grant"] = rawGrant
        let scopedOverview = try decode(AppOverview.self, scopedPayload)
        precondition(AuthorityOverviewPresentation(scopedOverview).grantRemaining == "4.00")
        precondition(scopedOverview.selectedAuthority?.grant?.api == "https://provider.example/data")
        precondition(abs(AuthorityOverviewPresentation(scopedOverview).progress - 1.85 / 3.0) < 0.00001, "The visual line follows this scope's limit")
        for status in ["REVOKED", "EXPIRED"] {
            rawGrant["status"] = status; scopedPayload["grant"] = rawGrant
            var inactiveScope = grantScope; inactiveScope["status"] = status; inactiveScope["usable"] = false
            validScope["grant"] = inactiveScope; scopedPayload["authority"] = validScope
            let inactive = try decode(AppOverview.self, scopedPayload)
            precondition(AuthorityOverviewPresentation(inactive).grantRemaining == "—")
            precondition(inactive.scopedGrant?.status.rawValue == status)
        }
        let legacy = DailyAuthorityPresentation(network: "Solana Mainnet")
        precondition(legacy.balanceDisplay(wrong) == nil, "Even legacy Mainnet cannot display a test-unit balance")
        print("Authority surface native projections: exact Available/Reserved/Paid, Mainnet/Test asset labels, scoped grant rejection, missing/mismatched scope and wallet, balance identity passed")
    }
}
