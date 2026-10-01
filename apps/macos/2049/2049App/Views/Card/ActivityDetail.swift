import SwiftUI

struct ActivityDetail: View {
    let purchases: [AppOverview.Purchase]
    let agentName: String
    let isRefreshing: Bool
    let refreshError: String?
    let onBack: () -> Void
    let onRefresh: () async -> Void
    let onSelect: (String) -> Void

    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let rule = Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5)

    private var ledger: ActivityLedgerPresentation {
        ActivityLedgerPresentation(purchases, agentName: agentName)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("LATEST ACTIVITY")
                .font(.system(size: 10, weight: .medium))
                .tracking(2.6)
                .foregroundStyle(secondaryInk)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .trailing) {
                    HStack(spacing: 12) {
                        Button("Back to Authority", systemImage: "chevron.left", action: onBack)
                            .help("Back to Authority")
                        Button("Refresh activity", systemImage: "arrow.clockwise", action: refresh)
                            .disabled(isRefreshing)
                            .help("Refresh activity")
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .font(.system(size: 12))
                    .foregroundStyle(secondaryInk)
                }

            Text("Agent activity")
                .font(.system(size: 44, weight: .regular, design: .serif))
                .tracking(-1.4)
                .frame(height: 52, alignment: .leading)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)

            Text("Purchases, decisions, and outcomes for \(agentName).")
                .font(.system(size: 13))
                .foregroundStyle(secondaryInk)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)

            if isRefreshing {
                Text("Refreshing activity…")
                    .font(.system(size: 11))
                    .foregroundStyle(secondaryInk)
                    .accessibilityAddTraits(.updatesFrequently)
                    .padding(.top, 8)
            }
            if let refreshError {
                Text(refreshError)
                    .font(.system(size: 11))
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
            }

            if purchases.isEmpty {
                ContentUnavailableView("No activity yet", systemImage: "clock",
                    description: Text("Requests made by \(agentName) will appear here."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        ForEach(ledger.days) { day in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(day.title)
                                    .font(.system(size: 12))
                                    .foregroundStyle(secondaryInk)
                                    .accessibilityAddTraits(.isHeader)
                                LazyVStack(spacing: 0) {
                                    ForEach(day.rows) { row in
                                        ActivityLedgerRow(row: row, onSelect: onSelect)
                                        Rectangle().fill(rule).frame(height: 1)
                                            .accessibilityHidden(true)
                                    }
                                }
                            }
                        }
                    }
                    .padding(.bottom, 12)
                }
                .scrollIndicators(.automatic)
                .padding(.top, 22)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 44)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func refresh() {
        Task { await onRefresh() }
    }
}
