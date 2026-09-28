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

    private static func amount(_ purchase: AppOverview.Purchase) -> String {
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
            let fractional = String(padded.suffix(decimals)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
            value = fractional.isEmpty ? whole : "\(whole).\(fractional)"
        }
        return "\(value) \(purchase.currency ?? "units")"
    }
}
