import SwiftUI

struct MembersRoster: View {
    let presentation: MembersRosterPresentation
    let selectedMemberID: UUID?
    let isLoading: Bool
    let interactionsDisabled: Bool
    let error: String?
    let onSelect: (UUID) -> Void
    let onConnect: (UUID) -> Void
    let onAdd: () -> Void
    let onRetry: (() -> Void)?

    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let rule = Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Members")
                .font(.system(size: 52, weight: .regular, design: .serif))
                .tracking(-1.5)
                .foregroundStyle(Color(red: 0.07, green: 0.10, blue: 0.15))
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
                .overlay(alignment: .trailing) {
                    Button("Add agent", systemImage: "plus", action: onAdd)
                        .labelStyle(.iconOnly)
                        .font(.system(size: 14))
                        .frame(width: 28, height: 28)
                        .buttonStyle(.plain)
                        .foregroundStyle(secondaryInk)
                        .disabled(interactionsDisabled)
                        .help("Add agent")
                }
            Text("Agents share one daily budget.")
                .font(.system(size: 13))
                .foregroundStyle(secondaryInk)
                .padding(.top, 6)

            if isLoading {
                Text("Loading agents…")
                    .font(.system(size: 11))
                    .foregroundStyle(secondaryInk)
                    .padding(.top, 8)
            }
            if let error {
                HStack(alignment: .top, spacing: 8) {
                    Text(error).fixedSize(horizontal: false, vertical: true)
                    if let onRetry {
                        Button("Retry", action: onRetry)
                            .buttonStyle(.link)
                            .disabled(interactionsDisabled)
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(Color(red: 0.58, green: 0.28, blue: 0.31))
                .padding(.top, 8)
            }

            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(presentation.rows) { row in
                        MembersRosterRow(row: row, isSelected: row.memberID == selectedMemberID,
                            interactionsDisabled: interactionsDisabled, onSelect: onSelect, onConnect: onConnect)
                        Rectangle().fill(rule).frame(height: 1)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.bottom, 12)
            }
            .scrollIndicators(.automatic)
            .padding(.top, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
