import SwiftUI

struct ActivityDetail: View {
    let purchases: [AppOverview.Purchase]
    let isRefreshing: Bool
    let refreshError: String?
    let onBack: () -> Void
    let onRefresh: () async -> Void
    let onSelect: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Button("Authority", systemImage: "chevron.left", action: onBack)
                    .buttonStyle(.plain)
                Spacer()
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await onRefresh() } }
                    .buttonStyle(.plain)
                    .disabled(isRefreshing)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text("Activity")
                    .font(.title2)
                Text("Recent purchases")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if isRefreshing {
                ProgressView("Refreshing activity")
                    .controlSize(.small)
            } else if let refreshError {
                Text(refreshError)
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }

            if purchases.isEmpty {
                ContentUnavailableView("No purchases yet", systemImage: "clock.arrow.circlepath", description: Text("Purchases will appear here when they are recorded."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List(purchases, id: \.purchaseId) { purchase in
                    let item = PurchasePresentation(purchase)
                    Button {
                        onSelect(purchase.purchaseId)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title)
                                    .font(.body)
                                    .lineLimit(1)
                                Text("\(item.status) · \(item.mode) · \(item.date)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer(minLength: 4)
                            Text(item.amount)
                                .font(.subheadline)
                                .monospacedDigit()
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(item.title), \(item.status), \(item.mode), \(item.amount), \(item.date)")
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .padding(.bottom, 12)
    }
}
