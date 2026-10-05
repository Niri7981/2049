import SwiftUI

struct BackNavigation: View {
    @Binding var selection: BackSection
    @Namespace private var selectionSurface
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(BackSection.allCases, id: \.self) { section in
                Button {
                    withAnimation(reduceMotion ? .easeOut(duration: YoshTabMotion.reducedDuration)
                        : YoshTabMotion.indicatorSpring) {
                        selection = section
                    }
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
                        Group {
                            if selection == section {
                                if reduceMotion {
                                    Capsule()
                                        .fill(Color.white.opacity(0.78))
                                        .transition(.opacity)
                                } else {
                                    Capsule()
                                        .fill(Color.white.opacity(0.78))
                                        .matchedGeometryEffect(id: "selection", in: selectionSurface)
                                }
                            }
                        }
                        // The moving indicator must not capture presses meant for another tab.
                        .allowsHitTesting(false)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == section ? .isSelected : [])
            }
        }
        .animation(reduceMotion ? .easeOut(duration: YoshTabMotion.reducedDuration)
            : YoshTabMotion.indicatorSpring, value: selection)
        .padding(5)
        .frame(height: 76)
        .background(.regularMaterial, in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(Color.white.opacity(0.75), lineWidth: 1)
        }
    }
}
