import SwiftUI

struct BackNavigation: View {
    @Binding var selection: BackSection
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Namespace private var glassNamespace
    @State private var leadingPosition: CGFloat
    @State private var trailingPosition: CGFloat
    @State private var motionGeneration = 0
    private let selectionHeight: CGFloat = 62

    init(selection: Binding<BackSection>) {
        _selection = selection
        let position = CGFloat(selection.wrappedValue.rawValue)
        _leadingPosition = State(initialValue: position)
        _trailingPosition = State(initialValue: position)
    }

    var body: some View {
        GeometryReader { geometry in
            let inset: CGFloat = 20
            let tabWidth = max(0, (geometry.size.width - inset * 2) / CGFloat(BackSection.allCases.count))

            ZStack(alignment: .leading) {
                navigationGlass(width: max(0, geometry.size.width - inset * 2), tabWidth: tabWidth)
                    .clipShape(Capsule())
                    .offset(x: inset)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)

                HStack(spacing: 0) {
                    ForEach(BackSection.allCases, id: \.self) { section in
                        Button {
                            if reduceMotion {
                                selection = section
                            } else {
                                withAnimation(YoshTabMotion.indicatorSpring) { selection = section }
                            }
                        } label: {
                            VStack(spacing: 3) {
                                Image(systemName: section.symbol)
                                    .font(.system(size: 21, weight: .regular))
                                    .frame(height: 24)
                                Text(section.title)
                                    .font(.system(size: 11, weight: .medium))
                            }
                            .modifier(TabSelectionEmphasis(
                                position: leadingPosition,
                                tab: CGFloat(section.rawValue)))
                            .frame(maxWidth: .infinity)
                            .frame(height: 66)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(section.title)
                        .accessibilityAddTraits(selection == section ? .isSelected : [])
                    }
                }
                .padding(.horizontal, inset)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .frame(height: 76)
        .onChange(of: selection) { _, section in
            motionGeneration += 1
            let generation = motionGeneration
            let destination = CGFloat(section.rawValue)
            if reduceMotion {
                leadingPosition = destination
                trailingPosition = destination
            } else {
                // The leading lens reacts first; the slower lens catches up. Both
                // springs retarget from their current presentation on rapid taps.
                withAnimation(.interactiveSpring(response: 0.20, dampingFraction: 0.84)) {
                    leadingPosition = destination
                }
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(14))
                    guard motionGeneration == generation else { return }
                    withAnimation(.interactiveSpring(response: 0.32, dampingFraction: 0.90)) {
                        trailingPosition = destination
                    }
                }
            }
        }
        .onChange(of: reduceMotion) { _, isReduced in
            if isReduced {
                motionGeneration += 1
                leadingPosition = CGFloat(selection.rawValue)
                trailingPosition = CGFloat(selection.rawValue)
            }
        }
    }

    @ViewBuilder
    private func navigationGlass(width: CGFloat, tabWidth: CGFloat) -> some View {
        if reduceTransparency {
            ZStack(alignment: .leading) {
                Capsule().fill(YoshShellPalette.surface)
                Capsule()
                    .fill(YoshShellPalette.activeInk.opacity(0.10))
                    .frame(width: selectionWidth(tabWidth), height: selectionHeight)
                    .offset(x: tabOffset(leadingPosition, tabWidth: tabWidth))
            }
            .frame(width: width, height: 66)
        } else if #available(macOS 26, *) {
            ZStack {
                Color.clear
                    .frame(width: width, height: 66)
                    .glassEffect(.regular, in: .capsule)

                // The two lobes belong to one selection material. Apple's glass
                // container fuses them at rest and stretches their union in flight.
                GlassEffectContainer(spacing: 32) {
                    ZStack(alignment: .leading) {
                        glassLobe(at: trailingPosition, tabWidth: tabWidth, id: "selection-trailing")
                        glassLobe(at: leadingPosition, tabWidth: tabWidth, id: "selection-leading")
                    }
                    // The tab offsets are measured from the bar's leading edge.
                    // Keep the compact glass at that edge before applying them.
                    .frame(width: width, height: 66, alignment: .leading)
                }
            }
            .frame(width: width, height: 66)
        } else {
            ZStack(alignment: .leading) {
                Capsule().fill(.regularMaterial)
                Capsule()
                    .fill(.regularMaterial)
                    .frame(width: selectionWidth(tabWidth), height: selectionHeight)
                    .offset(x: tabOffset(leadingPosition, tabWidth: tabWidth))
            }
            .frame(width: width, height: 66)
        }
    }

    @available(macOS 26, *)
    private func glassLobe(at position: CGFloat, tabWidth: CGFloat, id: String) -> some View {
        Color.clear
            .frame(width: selectionWidth(tabWidth), height: selectionHeight)
            .glassEffect(.regular.tint(YoshShellPalette.activeInk.opacity(0.10)), in: .capsule)
            .glassEffectID(id, in: glassNamespace)
            .offset(x: tabOffset(position, tabWidth: tabWidth))
    }

    private func tabOffset(_ position: CGFloat, tabWidth: CGFloat) -> CGFloat {
        (tabWidth - selectionWidth(tabWidth)) / 2 + position * tabWidth
    }

    private func selectionWidth(_ tabWidth: CGFloat) -> CGFloat {
        max(0, tabWidth - 8)
    }
}

/// Animates both icon and label emphasis with the same position as the shared
/// selection surface, instead of switching their color at the destination.
private struct TabSelectionEmphasis: ViewModifier, Animatable {
    var position: CGFloat
    let tab: CGFloat

    nonisolated var animatableData: CGFloat {
        get { position }
        set { position = newValue }
    }

    func body(content: Content) -> some View {
        let emphasis = max(0, 1 - abs(position - tab))
        content
            .foregroundStyle(YoshShellPalette.secondaryInk)
            .overlay {
                content
                    .foregroundStyle(YoshShellPalette.activeInk)
                    .opacity(emphasis)
                    .accessibilityHidden(true)
            }
    }
}
