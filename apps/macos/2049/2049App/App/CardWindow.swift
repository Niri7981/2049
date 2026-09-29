import SwiftUI

struct CardWindow: View {
    let overviewClient: OverviewClient
    @State private var memberSession: CardMemberSession

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showingBack = false
    @State private var isFlipping = false
    @State private var flipGeneration = 0

    init(overviewClient: OverviewClient) {
        self.overviewClient = overviewClient
        _memberSession = State(initialValue: CardMemberSession(client: overviewClient))
    }

    var body: some View {
        ZStack {
            if reduceMotion {
                ZStack {
                    CardMaterial()
                        .gesture(WindowDragGesture())
                        .allowsWindowActivationEvents()
                    if showingBack {
                        AgentCardBack(onFlip: flip, overviewClient: overviewClient, memberSession: memberSession)
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

                    AgentCardBack(onFlip: flip, overviewClient: overviewClient, memberSession: memberSession)
                        .modifier(CardFaceRotation(angle: 180, perspective: 0, active: isFlipping))
                        .modifier(FlipFaceVisibility(angle: showingBack ? 180 : 0, isBack: true))
                        .allowsHitTesting(showingBack)
                }
                .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
                .modifier(CardFaceRotation(angle: showingBack ? 180 : 0, perspective: 0.35, active: isFlipping))
            }
        }
        .padding(CardMetrics.windowInset)
        .frame(width: CardMetrics.windowSize.width, height: CardMetrics.windowSize.height)
        .environment(\.colorScheme, .light)
        .task { await memberSession.refresh() }
    }

    private var frontFace: some View {
        AgentCardFront(identity: memberSession.selectedMember.map { AgentIdentity(name: $0.label) }, onFlip: flip)
            .overlay(alignment: .topLeading) {
                WindowControls()
                    .padding(.leading, 24)
                    .padding(.top, 22)
            }
    }

    private func flip() {
        if reduceMotion {
            withAnimation(.easeInOut(duration: 0.18)) { showingBack.toggle() }
            return
        }
        flipGeneration += 1
        let generation = flipGeneration
        isFlipping = true
        Task { @MainActor in
            await Task.yield()
            withAnimation(.spring(response: 0.5, dampingFraction: 0.94), completionCriteria: .logicallyComplete) {
                showingBack.toggle()
            } completion: {
                if flipGeneration == generation { isFlipping = false }
            }
        }
    }
}

private struct CardFaceRotation: ViewModifier {
    let angle: Double
    let perspective: CGFloat
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.rotation3DEffect(.degrees(angle), axis: (x: 0, y: 1, z: 0), perspective: perspective)
        } else {
            content
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
