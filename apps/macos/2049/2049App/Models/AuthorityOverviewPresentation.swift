import Foundation

/// Formats backend facts for the approved Authority card without making spending decisions.
struct AuthorityOverviewPresentation {
    let remaining: String
    let dailyLimit: String
    let progress: Double
    let grantRemaining: String
    let grantDetail: String
    let perTransaction: String
    let payments: String
    let execution: String
    let latest: Latest?

    struct Latest {
        let title: String
        let detail: String
        let amount: String
    }

    init(_ overview: AppOverview, now: Date = .now) {
        let budget = overview.budget
        remaining = budget.remaining.map { Self.money($0, decimals: 6) } ?? "—"
        dailyLimit = budget.dailyLimit.map { "of \(Self.money($0, decimals: 6)) daily" } ?? "daily limit not set"
        if let limit = budget.dailyLimit?.value, let available = budget.remaining?.value, limit > 0 {
            progress = min(1, Double(available) / Double(limit))
        } else {
            progress = 0
        }

        if let grant = overview.grant, grant.status == .active {
            grantRemaining = Self.money(grant.remaining, decimals: grant.assetDecimals)
            grantDetail = "remaining"
            perTransaction = Self.money(grant.singleLimit, decimals: grant.assetDecimals)
        } else {
            grantRemaining = "—"
            switch overview.grant?.status {
            case .revoked: grantDetail = "revoked"
            case .expired: grantDetail = "expired"
            case .active, nil: grantDetail = "not set"
            }
            perTransaction = "—"
        }

        payments = overview.service.status == .stopping ? "Unavailable" : (budget.paused ? "Paused" : "On")
        execution = overview.service.purchaseMode == .liveDevnet ? "Live · Devnet" : "Simulated · Devnet"

        if let purchase = overview.purchases.first {
            let formatted = PurchasePresentation(purchase)
            let date = Date(timeIntervalSince1970: TimeInterval(purchase.createdAt) / 1_000)
            let elapsed = RelativeDateTimeFormatter().localizedString(for: date, relativeTo: now)
            latest = Latest(title: formatted.title, detail: "\(formatted.status) · \(elapsed)", amount: formatted.amount)
        } else {
            latest = nil
        }
    }

    private static func money(_ amount: MinorUnits, decimals: Int) -> String {
        guard (0...18).contains(decimals) else { return "—" }
        let divisor = Decimal(string: "1" + String(repeating: "0", count: decimals)) ?? 1
        let value = Decimal(amount.value) / divisor
        return value.formatted(.currency(code: "USD").precision(.fractionLength(2)).locale(Locale(identifier: "en_US")))
    }
}
