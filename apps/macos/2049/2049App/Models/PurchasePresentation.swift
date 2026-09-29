import Foundation

/// Displays the backend's safe purchase summary without treating a simulation as a chain payment.
struct PurchasePresentation {
    let title: String
    let status: String
    let delivery: String
    let mode: String
    let amount: String
    let date: String

    init(_ purchase: AppOverview.Purchase) {
        title = purchase.offerId.map { ["basic", "premium"].contains($0) } == true ? "SOL price snapshot" : (purchase.offerId ?? "Purchase")
        mode = switch purchase.executionMode {
        case .simulated: "Simulated"
        case .liveDevnet: "Live · Devnet"
        case .unknown: "Mode unknown"
        }
        status = switch purchase.status {
        case "PAID": switch purchase.executionMode {
            case .simulated: "Simulated payment"
            case .liveDevnet: "Paid"
            case .unknown: "Recorded as paid"
        }
        case "APPROVED": "Approved"
        case "DENIED": "Denied"
        case "REQUIRES_APPROVAL": "Needs approval"
        case "PAYING": "Payment in progress"
        case "PAYMENT_UNKNOWN": "Payment status unknown"
        case "FAILED": "Failed"
        case "EXPIRED": "Expired"
        default: "Status unavailable"
        }
        delivery = switch purchase.deliveryStatus {
        case "COMPLETE": "Delivered"
        case "PENDING": "Delivery pending"
        default: "Not paid"
        }
        date = Date(timeIntervalSince1970: TimeInterval(purchase.createdAt) / 1_000)
            .formatted(date: .abbreviated, time: .shortened)
        amount = Self.amount(purchase)
    }

    static func amount(_ purchase: AppOverview.Purchase, minimumFractionDigits: Int = 0) -> String {
        guard let decimals = purchase.assetDecimals, (0...18).contains(decimals) else {
            return "\(purchase.amount.value) base units"
        }
        let digits = String(purchase.amount.value)
        let value: String
        if decimals == 0 {
            value = digits
        } else {
            let padded = String(repeating: "0", count: max(0, decimals + 1 - digits.count)) + digits
            let whole = String(padded.dropLast(decimals))
            let trimmed = String(padded.suffix(decimals)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
            let fractional = trimmed.padding(toLength: max(trimmed.count, min(decimals, minimumFractionDigits)), withPad: "0", startingAt: 0)
            value = fractional.isEmpty ? whole : "\(whole).\(fractional)"
        }
        return "\(value) \(purchase.currency ?? "units")"
    }
}

/// Activity-only wording. The Authority overview continues to use PurchasePresentation unchanged.
struct ActivityPurchasePresentation {
    let title: String
    let symbol: String
    let status: String
    let supportingStatus: String?
    let policy: String
    let denialReason: String?
    let payment: String
    let delivery: String
    let mode: String
    let amount: String
    let time: String
    let timestamp: String

    init(_ purchase: AppOverview.Purchase) {
        switch purchase.resourceId ?? purchase.offerId {
        case "market-analysis":
            title = "SOL Market Analysis"
            symbol = "chart.bar.xaxis"
        case "market-snapshot", "sol-market-snapshot", "premium-sol-market-snapshot", "basic", "premium":
            title = "SOL Market Snapshot"
            symbol = "chart.line.uptrend.xyaxis"
        default:
            title = "Resource request"
            symbol = "doc.text"
        }

        let simulated = purchase.executionMode == .simulated
        // A legacy simulated PAID record is not evidence that money changed hands.
        switch purchase.status {
        case "PAID" where simulated:
            status = "Simulated"
        case "PAID" where purchase.deliveryStatus == "COMPLETE":
            status = "Delivered"
        case "PAID":
            status = "Paid"
        case "PAYING":
            status = "Paying"
        case "PAYMENT_UNKNOWN":
            status = "Payment unknown"
        case "DENIED":
            status = "Denied"
        case "EXPIRED":
            status = "Expired"
        case "APPROVED":
            status = "Approved"
        case "FAILED":
            status = "Failed"
        case "REQUIRES_APPROVAL":
            status = "Needs approval"
        default:
            status = "Status unavailable"
        }

        supportingStatus = purchase.status == "APPROVED" ? "No payment made" : nil
        policy = switch purchase.status {
        case "DENIED": "Denied"
        case "REQUIRES_APPROVAL": "Needs approval"
        case "APPROVED", "PAYING", "PAYMENT_UNKNOWN", "PAID", "FAILED", "EXPIRED": "Approved"
        default: "Unavailable"
        }
        denialReason = purchase.status == "DENIED" ? Self.reason(purchase.decisionReason) : nil
        payment = if simulated {
            "No payment made · Simulated"
        } else {
            switch purchase.status {
            case "PAID": "Paid"
            case "PAYING": "In progress"
            case "PAYMENT_UNKNOWN": "Outcome unknown"
            case "FAILED": "Failed"
            default: "Not started"
            }
        }
        delivery = switch purchase.deliveryStatus {
        case "COMPLETE": simulated ? "Simulated delivery" : "Delivered"
        case "PENDING": "Pending"
        default: "Not delivered"
        }
        mode = switch purchase.executionMode {
        case .simulated: "Simulated"
        case .liveDevnet: "Live · Devnet"
        case .unknown: "Unknown"
        }
        amount = PurchasePresentation.amount(purchase, minimumFractionDigits: 2)
        let date = Date(timeIntervalSince1970: TimeInterval(purchase.createdAt) / 1_000)
        time = date.formatted(date: .omitted, time: .shortened)
        timestamp = date.formatted(date: .abbreviated, time: .shortened)
    }

    private static func reason(_ code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        return switch code {
        case "PAYMENTS_PAUSED": "Payments are paused"
        case "SPEND_GRANT_REVOKED": "Grant revoked"
        case "SPEND_GRANT_EXPIRED": "Grant expired"
        case "SPEND_GRANT_REQUIRED": "Spend grant required"
        case "SPEND_GRANT_SINGLE_LIMIT_EXCEEDED": "Per-transaction limit exceeded"
        case "SPEND_GRANT_TOTAL_LIMIT_EXCEEDED": "Grant limit exceeded"
        case "DAILY_BUDGET_EXCEEDED": "Daily authority exceeded"
        default: "Request did not meet current spending rules"
        }
    }
}
