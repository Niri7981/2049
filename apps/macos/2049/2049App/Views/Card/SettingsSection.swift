import SwiftUI

struct SettingsSection<Content: View>: View {
    let title: String
    let symbol: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .regular))
                    .frame(width: 20, height: 20)
                    .accessibilityHidden(true)
                Text(title)
                    .font(.system(size: 10, weight: .semibold))
                    .tracking(1.8)
                    .accessibilityAddTraits(.isHeader)
            }
            .foregroundStyle(Color(red: 0.42, green: 0.48, blue: 0.57))
            VStack(spacing: 0) { content }
                .frame(maxWidth: .infinity)
        }
    }
}
