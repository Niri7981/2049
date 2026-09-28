import SwiftUI

struct BackNavigation: View {
    @Binding var selection: BackSection

    var body: some View {
        HStack(spacing: 0) {
            ForEach(BackSection.allCases, id: \.self) { section in
                Button {
                    selection = section
                } label: {
                    VStack(spacing: 4) {
                        Image(systemName: section.symbol)
                            .font(.system(size: 22, weight: .regular))
                            .frame(height: 26)
                        Text(section.title)
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundStyle(selection == section ? Color.primary : Color.secondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 66)
                    .contentShape(Rectangle())
                    .background {
                        if selection == section {
                            Capsule()
                                .fill(Color.white.opacity(0.78))
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == section ? .isSelected : [])
            }
        }
        .padding(5)
        .frame(height: 76)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.white.opacity(0.75), lineWidth: 1)
        }
    }
}
