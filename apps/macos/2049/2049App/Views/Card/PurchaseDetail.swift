import SwiftUI

struct PurchaseDetail: View {
    let purchase: AppOverview.Purchase
    let onBack: () -> Void

    private var item: PurchasePresentation { PurchasePresentation(purchase) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button("Activity", systemImage: "chevron.left", action: onBack)
                    .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 6) {
                    Text(item.title)
                        .font(.title2)
                    Text(item.amount)
                        .font(.largeTitle)
                        .monospacedDigit()
                    Text(item.mode)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Divider()

                VStack(alignment: .leading, spacing: 10) {
                    fact("Status", item.status)
                    fact("Delivery", item.delivery)
                    fact("Created", item.date)
                }

                if let reason = purchase.reason, !reason.isEmpty {
                    Divider()
                    labeledText("Agent request", reason)
                }

                Divider()

                labeledText("Purchase ID", purchase.purchaseId)
                if purchase.executionMode == .simulated {
                    Text("Simulation: no on-chain payment was made.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } else if let transaction = purchase.transaction {
                    labeledText("Recorded transaction", transaction)
                }
                if let network = purchase.network { labeledText("Network", network) }
                if let assetId = purchase.assetId { labeledText("Asset", assetId) }
            }
            .padding(.horizontal, 26)
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
                .multilineTextAlignment(.trailing)
        }
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
