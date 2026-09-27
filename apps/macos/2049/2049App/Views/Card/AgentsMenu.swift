import SwiftUI

struct AgentsMenu: View {
    var body: some View {
        Menu {
            Button("NIRI", systemImage: "checkmark") {}
        } label: {
            capsuleLabel
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityHint("Current agent: NIRI")
    }

    @ViewBuilder
    private var capsuleLabel: some View {
        if #available(macOS 26, *) {
            label
                .glassEffect(.regular.interactive(), in: .capsule)
        } else {
            label
                .background(.regularMaterial, in: Capsule())
        }
    }

    private var label: some View {
        HStack(spacing: 8) {
            Text("Agents")
                .font(.system(size: 16, weight: .medium))
            Image(systemName: "chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
        }
        .foregroundStyle(Color(nsColor: .labelColor))
        .padding(.horizontal, 22)
        .frame(height: 48)
        .contentShape(Capsule())
    }
}
