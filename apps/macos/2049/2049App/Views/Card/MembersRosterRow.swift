import SwiftUI

struct MembersRosterRow: View {
    let row: MembersRosterPresentation.Row
    let isSelected: Bool
    let interactionsDisabled: Bool
    let onSelect: (UUID) -> Void
    let onConnect: (UUID) -> Void

    private let ink = Color(red: 0.07, green: 0.10, blue: 0.15)
    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let signal = Color(red: 0.24, green: 0.49, blue: 0.81)

    var body: some View {
        HStack(spacing: 14) {
            if row.canSelect, let id = row.memberID {
                Button(action: { onSelect(id) }) { identity }
                    .buttonStyle(.plain)
                    .disabled(interactionsDisabled)
                    .accessibilityLabel("\(row.name), \(row.provider)")
                    .accessibilityHint("Selects this member and opens its details.")
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
            } else {
                identity
            }
            Button(action: connect) {
                Text(row.action.title)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(row.action == .unavailable ? secondaryInk : signal)
                    .frame(width: 92, height: 32)
                    .background(actionFill, in: Capsule())
                    .overlay {
                        Capsule().strokeBorder(row.action == .connect ? signal.opacity(0.45) : .clear, lineWidth: 1)
                    }
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(interactionsDisabled || (row.action != .connect && row.action != .reconnect) || row.memberID == nil)
            .help(row.explanation)
            .accessibilityLabel("\(row.action.title) · \(row.name)")
            .accessibilityHint(row.explanation)
        }
        .frame(minHeight: 74)
    }

    private var identity: some View {
        HStack(spacing: 16) {
            providerIcon
            VStack(alignment: .leading, spacing: 4) {
                Text(row.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(ink)
                    .lineLimit(1)
                Text(row.provider)
                    .font(.system(size: 12))
                    .foregroundStyle(secondaryInk)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var providerIcon: some View {
        Group {
            switch row.icon {
            case .monogram(let text):
                Text(text).font(.system(size: text.count > 2 ? 18 : 23, weight: .semibold))
            case .symbol(let name):
                Image(systemName: name).font(.system(size: 25, weight: .regular))
            }
        }
        .foregroundStyle(ink)
        .frame(width: 44, height: 44)
        .background(secondaryInk.opacity(0.06), in: .rect(cornerRadius: 12))
        .accessibilityHidden(true)
    }

    private var actionFill: Color {
        switch row.action {
        case .connect: .clear
        case .connecting, .connected, .reconnect, .enabled: Color(red: 0.76, green: 0.85, blue: 0.98).opacity(0.32)
        case .unavailable: secondaryInk.opacity(0.08)
        }
    }

    private func connect() {
        guard !interactionsDisabled, row.action == .connect || row.action == .reconnect, let id = row.memberID else { return }
        onConnect(id)
    }
}
