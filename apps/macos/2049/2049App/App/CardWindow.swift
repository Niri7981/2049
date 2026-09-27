import SwiftUI

struct CardWindow: View {
    let identity: AgentIdentity
    let overviewClient: OverviewClient

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingBack = false

    var body: some View {
        ZStack {
            if reduceMotion {
                ZStack {
                    CardMaterial()
                        .gesture(WindowDragGesture())
                        .allowsWindowActivationEvents()
                    if showingBack {
                        AgentCardBack(onFlip: flip, overviewClient: overviewClient)
                            .transition(.opacity)
                    } else {
                        frontFace
                            .transition(.opacity)
                    }
                }
                .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
            } else {
                ZStack {
                    CardMaterial()
                        .gesture(WindowDragGesture())
                        .allowsWindowActivationEvents()

                    frontFace
                        .modifier(FlipFaceVisibility(angle: showingBack ? 180 : 0, isBack: false))
                        .allowsHitTesting(!showingBack)

                    AgentCardBack(onFlip: flip, overviewClient: overviewClient)
                        .rotation3DEffect(.degrees(180), axis: (x: 0, y: 1, z: 0), perspective: 0)
                        .modifier(FlipFaceVisibility(angle: showingBack ? 180 : 0, isBack: true))
                        .allowsHitTesting(showingBack)
                }
                .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
                .rotation3DEffect(
                    .degrees(showingBack ? 180 : 0),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.35
                )
            }
        }
        .padding(CardMetrics.windowInset)
        .frame(width: CardMetrics.windowSize.width, height: CardMetrics.windowSize.height)
        .environment(\.colorScheme, .light)
    }

    private var frontFace: some View {
        AgentCardFront(identity: identity, onFlip: flip)
            .overlay(alignment: .topLeading) {
                WindowControls()
                    .padding(.leading, 24)
                    .padding(.top, 22)
            }
    }

    private func flip() {
        withAnimation(reduceMotion ? .easeInOut(duration: 0.18) : .spring(response: 0.5, dampingFraction: 0.94)) {
            showingBack.toggle()
        }
    }
}

private struct FlipFaceVisibility: AnimatableModifier {
    var angle: Double
    let isBack: Bool

    nonisolated var animatableData: Double {
        get { angle }
        set { angle = newValue }
    }

    func body(content: Content) -> some View {
        content.opacity(isBack == (angle >= 90) ? 1 : 0)
    }
}
