import SwiftUI

struct AgentCardBack: View {
    let onFlip: () -> Void
    let overviewClient: OverviewClient

    @State private var selectedSection: BackSection

    init(onFlip: @escaping () -> Void, overviewClient: OverviewClient, initialSection: BackSection = .authority) {
        self.onFlip = onFlip
        self.overviewClient = overviewClient
        _selectedSection = State(initialValue: initialSection)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AgentsMenu()

                Spacer()

                BackFlipButton(action: onFlip)
                    .frame(width: 42, height: 42)
            }
            .padding(.horizontal, 26)
            .frame(height: 44)
            .padding(.top, 22)

            Group {
                switch selectedSection {
                case .authority:
                    BackOverview(overviewClient: overviewClient)
                case .members, .settings:
                    BackPlaceholder(section: selectedSection)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)

            BackNavigation(selection: $selectedSection)
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
        }
        .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
        .foregroundStyle(Color(nsColor: .labelColor))
        .accessibilityElement(children: .contain)
    }
}

#Preview("Back · Authority") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)))
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}

#Preview("Back · Members") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), initialSection: .members)
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}

#Preview("Back · Settings") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), initialSection: .settings)
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}
