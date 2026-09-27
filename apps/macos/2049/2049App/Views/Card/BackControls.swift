import SwiftUI

struct BackControls: View {
    let payments: String
    let execution: String

    var body: some View {
        VStack(spacing: 0) {
            row(symbol: "creditcard", title: "Payments", value: payments, valueColor: .primary)

            Rectangle()
                .fill(Color.primary.opacity(0.08))
                .frame(height: 1)
                .padding(.horizontal, 18)

            row(symbol: "square.stack.3d.up", title: "Execution", value: execution, valueColor: .secondary)
        }
        .frame(height: 100)
        .background(Color.white.opacity(0.38), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }

    private func row(symbol: String, title: String, value: String, valueColor: Color) -> some View {
        HStack(spacing: 13) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .regular))
                .frame(width: 28)
                .accessibilityHidden(true)

            Text(title)
                .font(.system(size: 15))

            Spacer(minLength: 8)

            Text(value)
                .font(.system(size: 14))
                .foregroundStyle(valueColor)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 19)
        .frame(height: 49)
    }
}
