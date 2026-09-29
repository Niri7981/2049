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

            ZStack {
                // Keep the selected Authority view alive across tab changes so its last
                // confirmed snapshot is available immediately when returning from Members.
                if let memberID = memberSession.selectedMemberID {
                    BackOverview(
                        overviewClient: overviewClient,
                        memberID: memberID,
                        agentName: memberSession.selectedMember?.label ?? "Agent",
                        isActive: selectedSection == .authority,
                        onMemberChanged: { await memberSession.refresh() }
                    )
                    .id(memberID)
                    .opacity(selectedSection == .authority ? 1 : 0)
                    .allowsHitTesting(selectedSection == .authority)
                    .accessibilityHidden(selectedSection != .authority)
                } else if selectedSection == .authority {
                    ContentUnavailableView(memberSession.loadError == nil ? "No active agent" : "Agents unavailable", systemImage: "person.crop.circle.badge.questionmark",
                        description: Text(memberSession.loadError ?? "Add an agent in Members to continue."))
                }

                switch selectedSection {
                case .authority:
                    EmptyView()
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
