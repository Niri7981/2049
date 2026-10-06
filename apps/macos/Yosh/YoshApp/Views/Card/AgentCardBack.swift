import SwiftUI

struct AgentCardBack: View {
    let onFlip: () -> Void
    let overviewClient: OverviewClient
    let memberSession: CardMemberSession

    @State private var selectedSection: BackSection
    @State private var visitedSections: Set<BackSection>

    init(onFlip: @escaping () -> Void, overviewClient: OverviewClient, memberSession: CardMemberSession, initialSection: BackSection = .connection) {
        self.onFlip = onFlip
        self.overviewClient = overviewClient
        self.memberSession = memberSession
        _selectedSection = State(initialValue: initialSection)
        _visitedSections = State(initialValue: [initialSection])
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
                // Connection and Authority share the same selected-member snapshot and
                // management writes. Keep it alive while visiting Members or Settings.
                if let memberID = memberSession.selectedMemberID {
                    BackOverview(
                        overviewClient: overviewClient,
                        memberID: memberID,
                        agentName: memberSession.selectedMember?.label ?? "Agent",
                        section: selectedSection,
                        onMemberChanged: { await memberSession.refresh() },
                        visitedSections: visitedSections
                    )
                    .id(memberID)
                    .zIndex(showsOverview ? 1 : 0)
                    .allowsHitTesting(showsOverview)
                    .accessibilityHidden(!showsOverview)
                } else {
                    YoshTabPage(section: .connection, selection: selectedSection) {
                        if visitedSections.contains(.connection) { connectionUnavailable }
                    }
                    YoshTabPage(section: .authority, selection: selectedSection) {
                        if visitedSections.contains(.authority) {
                            ContentUnavailableView(
                                memberSession.loadError == nil ? "No active agent" : "Agents unavailable",
                                systemImage: "person.crop.circle.badge.questionmark",
                                description: Text(memberSession.loadError
                                    ?? (memberSession.isLoading ? "Waiting for the local service." : "Add an agent in Agents to continue.")))
                        }
                    }
                }

                YoshTabPage(section: .members, selection: selectedSection) {
                    if visitedSections.contains(.members) {
                        MembersView(session: memberSession, isActive: selectedSection == .members)
                    }
                }
                YoshTabPage(section: .settings, selection: selectedSection) {
                    if visitedSections.contains(.settings) {
                        CardSettingsView(overviewClient: overviewClient, isActive: selectedSection == .settings)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .clipped()

            BackNavigation(selection: Binding(get: { selectedSection }, set: selectSection))
                .padding(.horizontal, 20)
                .padding(.bottom, 16)
        }
        .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
        .foregroundStyle(Color(nsColor: .labelColor))
        .accessibilityElement(children: .contain)
    }

    private func selectSection(_ section: BackSection) {
        visitedSections.insert(section)
        selectedSection = section
    }

    private var connectionUnavailable: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardPageHeader(title: memberSession.loadError == nil ? "Connection" : "Connection Issue",
                style: .hero(eyebrow: "CONNECTION"))
            Text(memberSession.loadError ?? (memberSession.isLoading
                ? "Loading connection…" : "Choose an active agent in Agents to connect."))
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if memberSession.loadError != nil {
                Button("Retry") { Task { await memberSession.refresh(retry: true) } }
                    .buttonStyle(.link)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, CardPageHeader.Layout.contentInset)
        .padding(.top, CardPageHeader.Layout.topSpacing)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var showsOverview: Bool {
        selectedSection == .connection || selectedSection == .authority
    }
}

#Preview("Back · Connection") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), memberSession: CardMemberSession(client: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false))))
        .background(CardMaterial())
        .environment(\.colorScheme, .light)
}

#Preview("Back · Authority") {
    AgentCardBack(onFlip: {}, overviewClient: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false)), memberSession: CardMemberSession(client: OverviewClient(runtime: NativeServiceRuntime(allowsLaunch: false))), initialSection: .authority)
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
