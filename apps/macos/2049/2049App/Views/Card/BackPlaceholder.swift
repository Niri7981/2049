import SwiftUI

struct BackPlaceholder: View {
    let section: BackSection

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: section.symbol)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text(section.title)
                .font(.title2)
            Text("Coming in a later phase")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
