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

    struct Asset: Decodable {
        let network: String
        let mint: String
        let decimals: Int
        var symbol: String? = nil
        let displayLabel: String
    }

    var mainnetStatus: String? {
        guard mode == .liveMainnet else { return nil }
        if !spendingAuthorized { return "Mainnet selected · spending not yet authorized" }
        if !productionExecutionEnabled { return "Mainnet selected · execution not enabled" }
        if !configurationReady { return "Mainnet selected · payment setup incomplete" }
        return "Mainnet selected · purchases remain subject to payment checks"
    }
}
