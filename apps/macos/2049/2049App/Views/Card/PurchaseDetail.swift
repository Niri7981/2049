import SwiftUI

struct PurchaseDetail: View {
    let purchase: AppOverview.Purchase
    let agentName: String
    let onBack: () -> Void

    private var item: ActivityPurchasePresentation { ActivityPurchasePresentation(purchase) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button("Activity", systemImage: "chevron.left", action: onBack)
                    .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 5) {
                    Text(item.title)
                        .font(.title2.weight(.semibold))
                    Text(item.status)
                        .font(.headline)
                    if let supportingStatus = item.supportingStatus {
                        Text(supportingStatus)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Divider()

                VStack(alignment: .leading, spacing: 10) {
                    fact("Agent", agentName)
                    fact("Requested amount", item.amount)
                    fact("Policy result", item.policy)
                    if let denialReason = item.denialReason {
                        fact("Denial reason", denialReason)
                    }
                    if purchase.status == "EXPIRED" {
                        Text("This request expired before payment started.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }

                Divider()

                VStack(alignment: .leading, spacing: 10) {
                    fact("Payment", item.payment)
                    fact("Delivery", item.delivery)
                    fact("Execution mode", item.mode)
                    fact("Network", purchase.network ?? "Unavailable")
                    fact("Time", item.timestamp)
                }

                if let reason = purchase.reason, !reason.isEmpty {
                    Divider()
                    labeledText("Agent request", reason)
                }

                Divider()

                labeledText("Request ID", purchase.purchaseId)
                if purchase.executionMode == .liveDevnet, let transaction = purchase.transaction, !transaction.isEmpty {
                    labeledText("Transaction ID", transaction)
                }
                if let assetId = purchase.assetId { labeledText("Asset ID", assetId) }
            }
            .padding(.horizontal, 26)
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        LabeledContent(label, value: value)
            .font(.subheadline)
    }

    private func labeledText(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
