import SwiftUI

struct AgentCardBack: View {
    let onFlip: () -> Void
    let overviewClient: OverviewClient
    let memberSession: CardMemberSession

    @State private var selectedSection: BackSection

    init(onFlip: @escaping () -> Void, overviewClient: OverviewClient, memberSession: CardMemberSession, initialSection: BackSection = .authority) {
        self.onFlip = onFlip
        self.overviewClient = overviewClient
        self.memberSession = memberSession
        _selectedSection = State(initialValue: initialSection)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                AgentsMenu(session: memberSession)

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
                    if let memberID = memberSession.selectedMemberID {
                        BackOverview(overviewClient: overviewClient, memberID: memberID, onMemberChanged: { await memberSession.refresh() })
                            .id(memberID)
                    } else {
                        ContentUnavailableView(memberSession.loadError == nil ? "No active agent" : "Agents unavailable", systemImage: "person.crop.circle.badge.questionmark",
                            description: Text(memberSession.loadError ?? "Add an agent in Members to continue."))
                    }
                case .members:
                    MembersView(session: memberSession)
                case .settings:
                    CardSettingsView(overviewClient: overviewClient)
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
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), memberSession: CardMemberSession(client: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false))))
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}

#Preview("Back · Members") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), memberSession: CardMemberSession(client: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false))), initialSection: .members)
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}

#Preview("Back · Settings") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), memberSession: CardMemberSession(client: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false))), initialSection: .settings)
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}
