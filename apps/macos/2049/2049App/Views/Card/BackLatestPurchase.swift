import SwiftUI

struct BackLatestPurchase: View {
    let title: String
    let detail: String
    let amount: String

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("Latest")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
                .padding(.leading, 2)

            HStack(spacing: 12) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 48, height: 48)
                    .background(Color.white.opacity(0.65), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 4)

                Text(amount)
                    .font(.system(size: 15, weight: .medium))
                    .monospacedDigit()

                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .frame(height: 68)
            .background(Color.white.opacity(0.4), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
            }
        }
    }
}
