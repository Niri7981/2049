import Foundation

/// Formats backend facts for the approved Authority card without making spending decisions.
struct AuthorityOverviewPresentation {
    let remaining: String
    let dailyLimit: String
    let progress: Double
    let grantRemaining: String
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
            perTransaction = Self.money(grant.singleLimit, decimals: grant.assetDecimals)
        } else {
            grantRemaining = "—"
            perTransaction = "—"
        }

        payments = overview.service.status == .stopping ? "Unavailable" : (budget.paused ? "Paused" : "On")
        execution = overview.service.purchaseMode == .liveDevnet ? "Live · Devnet" : "Simulated · Devnet"

        if let purchase = overview.purchases.first {
            let title = purchase.offerId.map { ["basic", "premium"].contains($0) } == true ? "SOL price snapshot" : "Activity"
            let date = Date(timeIntervalSince1970: TimeInterval(purchase.createdAt) / 1_000)
            let elapsed = RelativeDateTimeFormatter().localizedString(for: date, relativeTo: now)
            latest = Latest(title: title, detail: "\(Self.status(purchase.status)) · \(elapsed)", amount: Self.money(purchase.amount, decimals: 6))
        } else {
            latest = nil
        }
    }

    private static func status(_ value: String) -> String {
        switch value {
        case "PAID": "Paid"
        case "APPROVED": "Approved"
        case "DENIED": "Denied"
        case "REQUIRES_APPROVAL": "Needs approval"
        case "PAYING": "Paying"
        case "PAYMENT_UNKNOWN": "Status unknown"
        case "FAILED": "Failed"
        default: "Activity"
        }
    }

    private static func money(_ amount: MinorUnits, decimals: Int) -> String {
        guard (0...18).contains(decimals) else { return "—" }
        let divisor = Decimal(string: "1" + String(repeating: "0", count: decimals)) ?? 1
        let value = Decimal(amount.value) / divisor
        return value.formatted(.currency(code: "USD").precision(.fractionLength(2)).locale(Locale(identifier: "en_US")))
    }
}
