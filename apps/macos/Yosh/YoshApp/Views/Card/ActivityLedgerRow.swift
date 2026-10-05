import SwiftUI

struct ActivityLedgerRow: View {
    let row: ActivityLedgerPresentation.Row
    let onSelect: (String) -> Void

    @State private var isHovered = false

    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)

    private var statusInk: Color {
        switch row.tone {
        case .positive: Color(red: 0.18, green: 0.38, blue: 0.38)
        case .pending: Color(red: 0.47, green: 0.39, blue: 0.23)
        case .negative: Color(red: 0.58, green: 0.28, blue: 0.31)
        case .neutral: secondaryInk
        }
    }

    private var statusTint: Color {
        switch row.tone {
        case .positive: Color(red: 0.67, green: 0.87, blue: 0.85).opacity(0.4)
        case .pending: Color(red: 0.85, green: 0.8, blue: 0.62).opacity(0.24)
        case .negative: Color(red: 0.85, green: 0.71, blue: 0.73).opacity(0.24)
        case .neutral: secondaryInk.opacity(0.1)
        }
    }

    var body: some View {
        Button(action: selectPurchase) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: row.item.symbol)
                    .font(.system(size: 20))
                    .foregroundStyle(secondaryInk)
                    .frame(width: 24, height: 24)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    Text(row.item.title)
                        .font(.system(size: 15, weight: .medium))
                        .lineLimit(1)
                    Text(row.context)
                        .font(.system(size: 11))
                        .foregroundStyle(secondaryInk)
                        .lineLimit(1)
                    if let purpose = row.purpose {
                        Text(purpose)
                            .font(.system(size: 11))
                            .foregroundStyle(secondaryInk)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .trailing, spacing: 8) {
                    Text(row.item.amount)
                        .font(.system(size: 15, weight: .medium))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity, alignment: .trailing)

                    HStack(spacing: 6) {
                        Text(row.item.time)
                            .font(.system(size: 11))
                            .monospacedDigit()
                            .foregroundStyle(secondaryInk)
                            .lineLimit(1)
                            .frame(width: 54, alignment: .trailing)
                        Text(row.item.status.uppercased())
                            .font(.system(size: 9, weight: .semibold))
                            .tracking(0.3)
                            .foregroundStyle(statusInk)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(statusTint, in: Capsule())
                            .frame(width: 94, alignment: .trailing)
                    }
                }
                .frame(width: 154)
            }
            .frame(minHeight: 56, alignment: .top)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .background(isHovered ? Color.blue.opacity(0.055) : .clear, in: .rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .accessibilityLabel("\(row.item.title), \(row.context), \(row.purpose ?? ""), requested amount \(row.item.amount), \(row.item.status), \(row.item.timestamp)")
        .accessibilityHint("Opens purchase details, including the separate payment and delivery states.")
    }

    private func selectPurchase() {
        onSelect(row.id)
    }
}
