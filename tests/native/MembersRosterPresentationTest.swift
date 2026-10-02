import Foundation

@main
struct MembersRosterPresentationTest {
    static func member(_ id: UUID, label: String, isDefault: Bool = false, enabled: Bool = false,
                       status: String = "ACTIVE") throws -> CardMemberSummary {
        let data = try JSONSerialization.data(withJSONObject: [
            "member": ["id": id.uuidString, "label": label, "status": status, "isDefault": isDefault,
                       "createdAt": 1, "updatedAt": 1],
            "connection": ["enabled": enabled, "lastSeen": 1_800_000_000_000 as Int64,
                           "access": enabled ? "purchase_intent" : "read_only"],
        ])
        return try JSONDecoder().decode(CardMemberSummary.self, from: data)
    }

    static func main() throws {
        let id = UUID(), customID = UUID(), revokedID = UUID()
        let actual = try member(id, label: "Research", isDefault: true, enabled: true)
        let custom = try member(customID, label: "Claude Code")
        let revoked = try member(revokedID, label: "Retired", status: "REVOKED")
        let roster = MembersRosterPresentation([actual, custom, revoked])
        let first = roster.rows[0]
        precondition(first.name == "Research" && first.memberID == id && first.provider == "OpenAI")
        precondition(first.action == .enabled && first.explanation.contains("Reconnect"))
        precondition(!roster.rows.contains { $0.action == .connected }, "Enabled and historical requests do not verify a live host")
        precondition(roster.rows[1...6].map(\.name) == ["Claude Code", "Gemini CLI", "Grok", "Cursor Agent", "GitHub Copilot", "Windsurf"])
        precondition(roster.rows[1...6].allSatisfy { $0.action == .unavailable && $0.memberID == nil && !$0.canSelect })
        let realCustom = roster.rows.first { $0.memberID == customID }!
        precondition(realCustom.name == "Claude Code" && realCustom.provider == "2049" && realCustom.action == .connect,
            "A member label cannot infer an Anthropic integration")
        let retired = roster.rows.first { $0.memberID == revokedID }!
        precondition(retired.action == .unavailable && !retired.canSelect)
        let pending = MembersRosterPresentation([actual, custom], connectingMemberID: customID)
        precondition(pending.rows.first { $0.memberID == customID }?.action == .connecting)
        precondition(pending.rows[0].action == .enabled)
        let empty = MembersRosterPresentation([])
        precondition(empty.rows.count == 8 && empty.rows.allSatisfy { $0.action == .unavailable && $0.memberID == nil })
        precondition(empty.rows.last?.name == "Custom Agent")
        precondition(Set(roster.rows.map(\.id)).count == roster.rows.count)
        precondition(MembersRosterPresentation.ActionState.connected.title == "Connected")
        let integratedJSON = #"{"member":{"id":"11111111-1111-4111-8111-111111111111","label":"Codex","status":"ACTIVE","isDefault":true,"createdAt":1,"updatedAt":1},"connection":{"enabled":true,"lastSeen":null,"access":"purchase_intent","integration":{"provider":"codex","configured":true,"connected":true,"state":"connected","lastHandshake":1800000001000,"lastHeartbeat":1800000011000}}}"#
        let integrated = try JSONDecoder().decode(CardMemberSummary.self, from: Data(integratedJSON.utf8))
        precondition(MembersRosterPresentation([integrated]).rows[0].action == .connected)
        let staleJSON = integratedJSON.replacingOccurrences(of: #""connected":true"#, with: #""connected":false"#)
            .replacingOccurrences(of: #""state":"connected""#, with: #""state":"reconnect_required""#)
        let stale = try JSONDecoder().decode(CardMemberSummary.self, from: Data(staleJSON.utf8))
        precondition(MembersRosterPresentation([stale]).rows[0].action == .reconnect)
        print("Members roster: real identities, curated order, unsupported providers, revoked members, and honest access states passed")
    }
}
