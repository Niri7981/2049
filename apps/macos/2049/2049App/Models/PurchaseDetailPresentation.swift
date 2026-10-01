import Foundation

/// A transaction story from the safe overview, not an invented event log.
struct PurchaseDetailPresentation {
    enum Tone { case success, pending, negative, neutral }

    struct Stage: Identifiable {
        enum Kind {
            case approved, denied, needsApproval, expired, paid, paying, paymentUnknown, failed
            case simulatedPayment, paymentUnverified, delivered, deliveryPending, simulatedDelivery, unavailable
        }
        let id: Kind
        let title: String
        let detail: String
        let tone: Tone
        // The overview supplies creation time only. It cannot timestamp approval, payment, or delivery.
        let time: String? = nil
    }

    struct Receipt: Identifiable {
        var id: String { label }
        let label: String
        let value: String
        let copyValue: String?
    }

    let title: String
    let status: String
    let tone: Tone
    let stages: [Stage]
    let authorityTitle: String
    let authorityReason: String
    let resourceID: String?
    let resourceContext: String?
    let receipts: [Receipt]

    init(_ purchase: AppOverview.Purchase) {
        let item = ActivityPurchasePresentation(purchase)
        title = item.title
        status = item.status
        tone = switch purchase.status {
        case "APPROVED": .success
        case "PAID" where purchase.executionMode == .liveDevnet: .success
        case "PAYING", "PAYMENT_UNKNOWN", "REQUIRES_APPROVAL": .pending
        case "DENIED", "FAILED": .negative
        default: .neutral
        }

        let approvedStates = ["APPROVED", "PAYING", "PAYMENT_UNKNOWN", "PAID", "FAILED", "EXPIRED"]
        let approved = approvedStates.contains(purchase.status)
        let reason = Self.nonempty(purchase.decisionReason)
        authorityTitle = switch purchase.status {
        case "DENIED": "Denied by policy"
        case "REQUIRES_APPROVAL": "Approval required"
        default: if approved {
            ["AUTHORITY_AND_BUDGET_PASSED", "AUTHORITY_BUDGET_AND_GRANT_PASSED"].contains(reason ?? "")
                ? "Approved automatically" : "Approved by policy"
        } else { "Decision unavailable" }
        }
        authorityReason = Self.policyReason(reason, approved: approved)

        let network = Self.nonempty(purchase.network)
        let paymentContext = [item.amount, network.map(Self.shortNetwork)].compactMap { $0 }.joined(separator: " · ")
        var observed: [Stage] = []
        if approved {
            observed.append(Stage(id: .approved, title: "Approved",
                detail: purchase.status == "APPROVED" ? "No payment made." : "Request allowed by policy.", tone: .success))
        }
        switch purchase.status {
        case "APPROVED": break
        case "DENIED":
            observed.append(Stage(id: .denied, title: "Denied", detail: "No payment made.", tone: .negative))
        case "REQUIRES_APPROVAL":
            observed.append(Stage(id: .needsApproval, title: "Needs approval", detail: "Payment has not started.", tone: .pending))
        case "EXPIRED":
            observed.append(Stage(id: .expired, title: "Expired", detail: "Expired before payment started.", tone: .neutral))
        case "FAILED":
            observed.append(Stage(id: .failed, title: "Payment failed", detail: "No confirmed payment.", tone: .negative))
        case "PAYING":
            observed.append(Stage(id: .paying, title: "Payment in progress", detail: paymentContext, tone: .pending))
        case "PAYMENT_UNKNOWN":
            observed.append(Stage(id: .paymentUnknown, title: "Payment outcome unknown", detail: paymentContext, tone: .pending))
        case "PAID":
            switch purchase.executionMode {
            case .simulated:
                observed.append(Stage(id: .simulatedPayment, title: "Simulated payment",
                    detail: "\(item.amount) · No funds transferred", tone: .neutral))
            case .unknown:
                observed.append(Stage(id: .paymentUnverified, title: "Payment unverified",
                    detail: "\(item.amount) · Execution mode unavailable", tone: .neutral))
            case .liveDevnet:
                observed.append(Stage(id: .paid, title: "Paid", detail: paymentContext, tone: .success))
            }
            if purchase.deliveryStatus == "COMPLETE" {
                if purchase.executionMode == .simulated {
                    observed.append(Stage(id: .simulatedDelivery, title: "Simulated delivery",
                        detail: "Resource returned in simulation.", tone: .neutral))
                } else {
                    observed.append(Stage(id: .delivered,
                        title: purchase.executionMode == .unknown ? "Resource returned" : "Delivered",
                        detail: "Resource returned successfully.",
                        tone: purchase.executionMode == .liveDevnet ? .success : .neutral))
                }
            } else if purchase.deliveryStatus == "PENDING" {
                observed.append(Stage(id: .deliveryPending, title: "Delivery pending",
                    detail: "Resource not yet returned.", tone: .pending))
            }
        default:
            observed.append(Stage(id: .unavailable, title: "Status unavailable",
                detail: "No lifecycle details provided.", tone: .neutral))
        }
        stages = observed

        // Merchant, URL, pay-to address, and payment channel are not exposed by this summary.
        resourceID = Self.nonempty(purchase.resourceId) ?? Self.nonempty(purchase.offerId)
        resourceContext = Self.nonempty(purchase.reason)
        var fields: [Receipt] = []
        // A simulated transaction string is not a chain receipt.
        if purchase.executionMode != .simulated, let transaction = Self.nonempty(purchase.transaction) {
            fields.append(Receipt(label: "Transaction ID", value: transaction, copyValue: transaction))
        }
        fields.append(Receipt(label: "Request ID", value: purchase.purchaseId, copyValue: purchase.purchaseId))
        if let network {
            fields.append(Receipt(label: "Network", value: Self.receiptNetwork(network), copyValue: nil))
        }
        if purchase.createdAt > 0 {
            fields.append(Receipt(label: "Request time", value: item.timestamp, copyValue: nil))
        }
        if let assetID = Self.nonempty(purchase.assetId) {
            fields.append(Receipt(label: "Asset ID", value: assetID, copyValue: assetID))
        }
        receipts = fields
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
        return value
    }

    private static func shortNetwork(_ value: String) -> String {
        ["solana:devnet", "Solana Devnet"].contains(value) ? "Devnet" : value
    }

    private static func receiptNetwork(_ value: String) -> String {
        ["solana:devnet", "Solana Devnet"].contains(value) ? "Devnet (Solana)" : value
    }

    private static func policyReason(_ code: String?, approved: Bool) -> String {
        guard let code else { return approved ? "Approval reason not provided." : "Decision reason not provided." }
        return switch code {
        case "AUTHORITY_BUDGET_AND_GRANT_PASSED":
            "Matched the SpendGrant at approval.\nWithin daily, grant, and per-transaction limits."
        case "AUTHORITY_AND_BUDGET_PASSED": "Within daily and per-transaction limits."
        case "SINGLE_LIMIT_EXCEEDED": "The per-transaction limit requires your approval."
        case "DAILY_BUDGET_EXCEEDED": "The shared daily spending limit was exceeded."
        case "DAILY_LIMIT_NOT_SET": "The shared daily spending limit is not set."
        case "DAILY_LIMIT_ZERO": "The shared daily spending limit is zero."
        case "INVALID_DAILY_LIMIT": "The daily spending limit is invalid."
        case "INVALID_SINGLE_LIMIT": "The per-transaction limit is invalid."
        case "PAYMENTS_PAUSED": "Payments are paused."
        case "SPEND_GRANT_REQUIRED": "A SpendGrant is required."
        case "SPEND_GRANT_REVOKED": "The SpendGrant was revoked."
        case "SPEND_GRANT_EXPIRED": "The SpendGrant expired."
        case "SPEND_GRANT_INACTIVE": "The SpendGrant is inactive."
        case "SPEND_GRANT_PRINCIPAL_MISMATCH": "The SpendGrant no longer matches this member."
        case "SPEND_GRANT_SCOPE_MISMATCH": "The request is outside the SpendGrant's scope."
        case "SPEND_GRANT_SINGLE_LIMIT_EXCEEDED": "The SpendGrant's per-transaction limit was exceeded."
        case "SPEND_GRANT_TOTAL_LIMIT_EXCEEDED": "The SpendGrant's total limit was exceeded."
        case "SPEND_GRANT_ACCOUNTING_INVALID": "The SpendGrant's spending could not be verified."
        case "CARD_MEMBER_REVOKED": "This member's access was revoked."
        case "INVALID_SPEND_INTENT": "The purchase request is invalid."
        case "SPEND_INTENT_EXPIRED_OR_INVALID": "The purchase request expired or is invalid."
        case "LEDGER_UNRESOLVED": "An unresolved payment prevents a new purchase."
        default: "Policy reason: \(code)"
        }
    }
}
