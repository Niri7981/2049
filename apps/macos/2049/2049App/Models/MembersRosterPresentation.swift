import Foundation

/// A curated integration roster alongside real backend members; names never prove provider support.
struct MembersRosterPresentation {
    enum ActionState {
        case connect, connecting, connected, enabled, unavailable

        var title: String {
            switch self {
            case .connect: "Connect"
            case .connecting: "Connecting…"
            case .connected: "Connected"
            case .enabled: "Enabled"
            case .unavailable: "Unavailable"
            }
        }
    }

    enum Icon { case monogram(String), symbol(String) }

    struct Row: Identifiable {
        let id: String
        let memberID: UUID?
        let name: String
        let provider: String
        let icon: Icon
        let action: ActionState
        let canSelect: Bool
        let explanation: String
    }

    let rows: [Row]

    init(_ members: [CardMemberSummary], connectingMemberID: UUID? = nil) {
        var entries: [Row] = []
        if let codex = members.first(where: { $0.member.isDefault }) {
            entries.append(Self.member(codex, provider: "OpenAI", icon: .symbol("command"), connecting: connectingMemberID))
        } else {
            entries.append(Self.unavailable("codex", name: "Codex", provider: "OpenAI", icon: .symbol("command")))
        }
        entries += [
            Self.unavailable("claude", name: "Claude Code", provider: "Anthropic", icon: .monogram("AI")),
            Self.unavailable("gemini", name: "Gemini CLI", provider: "Google", icon: .monogram("G")),
            Self.unavailable("grok", name: "Grok", provider: "xAI", icon: .monogram("xAI")),
            Self.unavailable("cursor", name: "Cursor Agent", provider: "Cursor", icon: .symbol("cursorarrow")),
            Self.unavailable("copilot", name: "GitHub Copilot", provider: "GitHub", icon: .monogram("GH")),
            Self.unavailable("windsurf", name: "Windsurf", provider: "Windsurf", icon: .monogram("W")),
        ]
        let custom = members.filter { !$0.member.isDefault }
        if custom.isEmpty {
            entries.append(Self.unavailable("custom", name: "Custom Agent", provider: "2049", icon: .symbol("sparkle")))
        } else {
            entries += custom.map { Self.member($0, provider: "2049", icon: .symbol("sparkle"), connecting: connectingMemberID) }
        }
        rows = entries
    }

    private static func member(_ entry: CardMemberSummary, provider: String, icon: Icon, connecting: UUID?) -> Row {
        let active = entry.member.status == .active
        let state: ActionState = if !active { .unavailable }
            else if entry.member.id == connecting { .connecting }
            else if entry.connection.enabled { .enabled }
            else { .connect }
        // Access enablement and historical authenticated requests are not live connectivity.
        let explanation = switch state {
        case .connect: "Enable connection access. Reconnect the MCP host to use 2049."
        case .connecting: "Saving connection access."
        case .enabled: "Access is enabled. Reconnect the MCP host to use 2049."
        case .unavailable: "This member has been revoked."
        case .connected: "The host connection has been verified."
        }
        return Row(id: entry.member.id.uuidString, memberID: entry.member.id, name: entry.member.label,
            provider: provider, icon: icon, action: state, canSelect: active, explanation: explanation)
    }

    private static func unavailable(_ id: String, name: String, provider: String, icon: Icon) -> Row {
        Row(id: "integration-\(id)", memberID: nil, name: name, provider: provider, icon: icon,
            action: .unavailable, canSelect: false, explanation: "This integration is not available in 2049 yet.")
    }
}
