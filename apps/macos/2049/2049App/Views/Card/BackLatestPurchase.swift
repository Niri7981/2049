import SwiftUI

struct BackLatestPurchase: View {
    let latest: AuthorityOverviewPresentation.Latest?
    let agentName: String
    let isLoading: Bool
    let activityAvailable: Bool
    let onActivity: () -> Void
    let onPurchase: (String) -> Void

    private var context: String {
        if let purpose = latest?.purpose { return "\(agentName) · \(purpose)" }
        return agentName
    }

    private var decisionColor: Color {
        switch latest?.decisionTone {
        case .approved: Color(red: 0.18, green: 0.38, blue: 0.38)
        case .denied: Color(red: 0.58, green: 0.28, blue: 0.31)
        case .neutral, nil: .secondary
        }
    }

    private var decisionTint: Color {
        switch latest?.decisionTone {
        case .approved: Color(red: 0.67, green: 0.87, blue: 0.85).opacity(0.5)
        case .denied: Color(red: 0.85, green: 0.71, blue: 0.73).opacity(0.25)
        case .neutral, nil: Color.secondary.opacity(0.1)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button(action: onActivity) {
                HStack(spacing: 7) {
                    Text("LATEST ACTIVITY")
                        .font(.system(size: 10, weight: .medium))
                        .tracking(2.6)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .medium))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(.secondary)
                .frame(minHeight: 20)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!activityAvailable)
            .accessibilityLabel("View all activity")
            .accessibilityHint("Opens the full purchase history for \(agentName).")

            Button(action: openPurchase) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: latest?.symbol ?? "clock")
                        .font(.system(size: 23, weight: .regular))
                        .foregroundStyle(.secondary)
                        .frame(width: 28, height: 32)
                        .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 5) {
                        Text(latest?.title ?? (isLoading ? "—" : "No activity yet"))
                            .font(.system(size: 15, weight: .medium))
                            .lineLimit(1)
                        Text(latest == nil ? (isLoading ? "Activity unavailable" : "\(agentName) purchase history") : context)
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)

                        if let latest {
                            HStack(alignment: .firstTextBaseline, spacing: 5) {
                                Circle()
                                    .fill(latest.paymentConfirmed ? Color(red: 0.48, green: 0.64, blue: 0.88) : Color.secondary)
                                    .frame(width: 6, height: 6)
                                    .accessibilityHidden(true)
                                Text("\(latest.payment) · \(latest.recency)")
                                    .font(.system(size: 11))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(alignment: .trailing, spacing: 8) {
                        HStack(spacing: 8) {
                            if let latest {
                                Text(latest.amount)
                                    .font(.system(size: 15, weight: .medium))
                                    .monospacedDigit()
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.6)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(.secondary)
                                    .accessibilityHidden(true)
                            }
                        }

                        if let latest {
                            Text(latest.decision)
                                .font(.system(size: 9, weight: .semibold))
                                .tracking(0.5)
                                .foregroundStyle(decisionColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 4)
                                .background(decisionTint, in: Capsule())
                                .accessibilityLabel("Policy decision: \(latest.decision)")
                        }
                    }
                    .frame(maxWidth: latest == nil ? nil : 122, alignment: .trailing)
                }
                .frame(minHeight: 68, alignment: .top)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!activityAvailable || latest == nil)
            .accessibilityLabel(latest.map { "Latest purchase: \($0.title), \(context), \($0.payment), \($0.recency), \($0.amount). Policy decision: \($0.decision)" } ?? "Activity. \(isLoading ? "Unavailable" : "No purchases yet")")
            .accessibilityHint("Opens this purchase's details. Recency is when the request was created.")
        }
    }

    private func openPurchase() {
        guard let latest else { return }
        onPurchase(latest.purchaseId)
    }
}
