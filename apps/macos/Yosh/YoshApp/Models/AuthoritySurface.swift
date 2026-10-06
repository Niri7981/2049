import Foundation

/// Authenticated, scope-bound product facts. Numbers and blocking reasons are computed by the backend.
struct AuthoritySurface: Decodable {
    let mode: AppOverview.Service.PurchaseMode
    let network: String
    let assetId: String
    let assetDecimals: Int
    let assetLabel: String
    let dailyLimit: MinorUnits?
    let available: MinorUnits?
    let reserved: MinorUnits
    let paid: MinorUnits
    let availableDisplay: String
    let reservedDisplay: String
    let paidDisplay: String
    let dailyLimitDisplay: String
    let dailyState: DailyState
    let blockers: [String]
    let wallet: Wallet
    let grant: Grant?

    enum DailyState: String, Decodable {
        case required, paused, active, insufficient
        var label: String {
            switch self {
            case .required: "Daily Authority required"
            case .paused: "Payments are paused"
            case .active: "Daily Authority active"
            case .insufficient: "Insufficient available authority"
            }
        }
    }
    struct Wallet: Decodable {
        let address: String
        let network: String
        let status: Status
        enum Status: String, Decodable { case unavailable, unverified, available }
    }
    struct Grant: Decodable {
        let id: String
        let resourceId: String
        let api: String?
        let network: String
        let assetLabel: String
        let totalDisplay: String
        let remainingDisplay: String
        let committedDisplay: String
        let singleDisplay: String
        let status: AppOverview.Grant.Status
        let expiresAt: Int64
        let usable: Bool
    }
}

extension AppOverview {
    var selectedAuthority: AuthoritySurface? {
        guard let authority, authority.mode == service.purchaseMode else { return nil }
        if let environment = service.execution {
            guard authority.network == environment.network, authority.assetId == environment.asset.mint,
                  authority.assetDecimals == environment.asset.decimals else { return nil }
        }
        return authority
    }

    var scopedGrant: Grant? {
        guard let grant else { return nil }
        if let authority = selectedAuthority {
            guard authority.grant?.id == grant.id else { return nil }
            if service.purchaseMode == .liveMainnet {
                guard grant.network == authority.network, grant.assetId == authority.assetId,
                      grant.assetDecimals == authority.assetDecimals else { return nil }
            }
            return grant
        }
        // Legacy test projections remain readable; missing Mainnet scope never borrows a test grant.
        return service.purchaseMode == .liveMainnet ? nil : grant
    }
}
