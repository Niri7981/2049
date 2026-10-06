import Foundation

/// Official integrations and custom identities have different setup and liveness evidence.
struct MembersRosterPresentation {
    enum Status: Equatable {
        case notConnected, notSetUp, settingUp, connected, waiting, comingSoon, accessAllowed, revoked, connectionIssue, loading

        var title: String {
            switch self {
            case .notConnected: "Not Connected"
            case .notSetUp: "Not set up"
            case .settingUp: "Setting up…"
            case .connected: "Connected"
            case .waiting: "Waiting"
            case .comingSoon: "Coming soon"
            case .accessAllowed: "Access allowed"
            case .revoked: "Revoked"
            case .connectionIssue: "Connection issue"
            case .loading: "Loading…"
            }
        }
    }

    enum Action {
        case connect, retrySetup

        var title: String {
            switch self {
            case .connect: "Connect"
            case .retrySetup: "Retry setup"
            }
        }
    }

    enum Brand: String {
        case openAI = "ProviderOpenAI"
        case claude = "ProviderClaude"
        case gemini = "ProviderGemini"
        case grok = "ProviderGrok"
        case cursor = "ProviderCursor"
        case github = "ProviderGitHub"

        // Account for the official assets' clear space and different silhouettes.
        var opticalSize: CGFloat {
            switch self {
            case .openAI: 44
            case .claude: 28
            case .gemini: 32
            case .grok: 28
            case .cursor: 32
            case .github: 30
            }
        }
    }

    enum Icon { case brand(Brand), monogram(String), symbol(String) }
    enum Group: String, CaseIterable { case setUp = "SET UP", available = "AVAILABLE", custom = "CUSTOM" }

    struct Row: Identifiable {
        let id: String
        let memberID: UUID?
        let name: String
        let provider: String
        let icon: Icon
        let group: Group
        let status: Status
        let action: Action?
        let canSelect: Bool
        let explanation: String

        var isCustom: Bool { group == .custom }
    }

    struct Section: Identifiable {
        let group: Group
        let rows: [Row]
        var id: Group { group }
    }

    let sections: [Section]
    var rows: [Row] { sections.flatMap(\.rows) }

    init(_ members: [CardMemberSummary], connectingMemberID: UUID? = nil,
         connectionIssueMemberID: UUID? = nil, hasLoadError: Bool = false) {
        var entries: [Row] = []
        if let codex = members.first(where: { $0.member.isDefault }) {
            entries.append(Self.member(codex, connecting: connectingMemberID, issue: connectionIssueMemberID))
        } else {
            entries.append(Row(id: "integration-codex", memberID: nil, name: "Codex", provider: "OpenAI",
                icon: .brand(.openAI), group: .available, status: hasLoadError ? .connectionIssue : .loading,
                action: nil, canSelect: false, explanation: "Yosh hasn't loaded this agent's connection status yet."))
        }
        entries += [
            Self.comingSoon("claude", name: "Claude Code", provider: "Anthropic", icon: .brand(.claude)),
            Self.comingSoon("gemini", name: "Gemini CLI", provider: "Google", icon: .brand(.gemini)),
            Self.comingSoon("grok", name: "Grok", provider: "xAI", icon: .brand(.grok)),
            Self.comingSoon("cursor", name: "Cursor Agent", provider: "Cursor", icon: .brand(.cursor)),
            Self.comingSoon("copilot", name: "GitHub Copilot", provider: "GitHub", icon: .brand(.github)),
            Self.comingSoon("windsurf", name: "Windsurf", provider: "Windsurf", icon: .monogram("W")),
        ]
        entries += members.filter { !$0.member.isDefault }.map {
            Self.member($0, connecting: connectingMemberID, issue: connectionIssueMemberID)
        }
        sections = Group.allCases.map { group in Section(group: group, rows: entries.filter { $0.group == group }) }
    }

    private static func member(_ entry: CardMemberSummary, connecting: UUID?, issue: UUID?) -> Row {
        let official = entry.member.isDefault
        let active = entry.member.status == .active
        let group: Group = official
            ? (entry.connection.enabled || entry.connection.integration?.configured == true ? .setUp : .available)
            : .custom
        let status: Status = if !active { .revoked }
            else if entry.member.id == connecting { .settingUp }
            else if entry.member.id == issue && (official ? !entry.connection.hasLiveMCPSession : !entry.connection.enabled) { .connectionIssue }
            else if official && entry.connection.hasLiveMCPSession { .connected }
            else if entry.connection.enabled { official ? .waiting : .accessAllowed }
            else { official ? .notConnected : .notSetUp }
        let action: Action? = switch status {
        case .notConnected, .notSetUp: .connect
        case .connectionIssue: .retrySetup
        default: nil
        }
        let explanation = switch status {
        case .notConnected: "Connect Codex to Yosh."
        case .notSetUp: "Allow this custom agent to use Yosh."
        case .settingUp: "Setting up access to Yosh."
        case .waiting: "Open or continue a Codex chat to finish connecting."
        case .accessAllowed: "This custom agent is allowed to use Yosh. Its online status cannot be confirmed."
        case .revoked: "This Agent's access has been revoked."
        case .connected: "Codex is ready to use Yosh."
        case .connectionIssue: "Connection setup wasn't confirmed. Retry setup after resolving the problem."
        case .comingSoon: "Support for this integration is coming soon."
        case .loading: "Loading connection status."
        }
        return Row(id: entry.member.id.uuidString, memberID: entry.member.id, name: entry.member.label,
            provider: official ? "OpenAI" : "Custom agent", icon: official ? .brand(.openAI) : .symbol("person"),
            group: group, status: status, action: action, canSelect: active, explanation: explanation)
    }

    private static func comingSoon(_ id: String, name: String, provider: String, icon: Icon) -> Row {
        Row(id: "integration-\(id)", memberID: nil, name: name, provider: provider, icon: icon,
            group: .available, status: .comingSoon, action: nil, canSelect: false,
            explanation: "This integration isn't supported yet.")
    }
}
