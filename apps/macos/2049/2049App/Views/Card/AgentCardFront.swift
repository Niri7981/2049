import SwiftUI

struct AgentCardFront: View {
    let identity: AgentIdentity
    let onFlip: () -> Void

    var body: some View {
        Color.clear
            .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
            .allowsHitTesting(false)
            .overlay(alignment: .topLeading) {
                Text("2049")
                    .font(.system(size: 38, weight: .ultraLight, design: .default))
                    .tracking(-0.8)
                    .padding(.leading, 36)
                    .padding(.top, 38)
            }
            .overlay(alignment: .topTrailing) {
                CardFlipButton(action: onFlip)
                    .padding(.trailing, 36)
                    .padding(.top, 38)
            }
            .overlay(alignment: .bottomLeading) {
                AgentIdentityBlock(identity: identity)
                    .padding(.leading, 36)
                    .padding(.bottom, 42)
            }
            .foregroundStyle(Color(nsColor: .labelColor).opacity(0.88))
            .accessibilityElement(children: .contain)
    }
}

private struct AgentIdentityBlock: View {
    let identity: AgentIdentity

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(identity.name)
                .font(.system(size: 27, weight: .medium))
                .tracking(2.4)

            Text(identity.label)
                .font(.system(size: 13, weight: .medium))
                .tracking(3.2)
                .foregroundStyle(.secondary)
        }
    }
}

struct CardFlipButton: View {
    let action: () -> Void

    var body: some View {
        Button("Flip Agent Card", systemImage: "arrow.triangle.2.circlepath", action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 25, weight: .light))
            .frame(width: 34, height: 34)
            .contentShape(Rectangle())
            .buttonStyle(CardIconButtonStyle())
    }
}

struct CardIconButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color(nsColor: configuration.isPressed ? .labelColor : .secondaryLabelColor))
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? 0.98 : 1))
            .animation(
                reduceMotion
                    ? nil
                    : (configuration.isPressed
                        ? .easeOut(duration: 0.075)
                        : .interactiveSpring(response: 0.25, dampingFraction: 0.85)),
                value: configuration.isPressed
            )
    }
}
