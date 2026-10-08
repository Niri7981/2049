import Foundation

/// Safe backend projection of PaymentEnvironment; no wallet or signing material.
struct ExecutionEnvironment: Decodable {
    let mode: AppOverview.Service.PurchaseMode
    let cluster: String
    let network: String
    let asset: Asset
    let productionExecutionEnabled: Bool
    let spendingAuthorized: Bool
    let configurationReady: Bool
    let readiness: Readiness?

    struct Readiness: Decodable {
        let facilitator: Check?
        let paymentConfiguration: Check?
        struct Check: Decodable { let ready: Bool; let code: String? }
    }

    struct Asset: Decodable {
        let network: String
        let mint: String
        let decimals: Int
        var symbol: String? = nil
        let displayLabel: String
    }

    var assetLabel: String? {
        guard network == asset.network else { return nil }
        return PurchasePresentation.scopedAssetLabel(symbol: asset.symbol ?? asset.displayLabel,
            environment: mode.rawValue, network: network)
    }

    var mainnetStatus: String? {
        guard mode == .liveMainnet else { return nil }
        if !productionExecutionEnabled { return "Mainnet execution is disabled" }
        if let code = readiness?.facilitator?.code {
            return code == "FACILITATOR_CONFIGURATION_REQUIRED" ? "Payment facilitator setup required" : "Payment facilitator configuration invalid"
        }
        if !configurationReady { return "Mainnet payment setup incomplete" }
        if !spendingAuthorized { return "Mainnet spending not yet authorized" }
        return "Purchases remain subject to payment checks"
    }
}
