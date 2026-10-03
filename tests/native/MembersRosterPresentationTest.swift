import Foundation

@main
struct MembersRosterPresentationTest {
    static func member(_ id: UUID, label: String, isDefault: Bool = false, enabled: Bool = false,
                       configured: Bool = false, live: Bool = false, status: String = "ACTIVE") throws -> CardMemberSummary {
        var connection: [String: Any] = ["enabled": enabled, "lastSeen": 1_800_000_000_000 as Int64,
                                        "access": enabled ? "purchase_intent" : "read_only"]
        if isDefault {
            connection["integration"] = ["provider": "codex", "configured": configured, "connected": live,
                "state": live ? "connected" : "reconnect_required",
                "lastHandshake": live ? 1_800_000_001_000 as Int64 as Any : NSNull(),
                "lastHeartbeat": live ? 1_800_000_011_000 as Int64 as Any : NSNull()]
        }
        let data = try JSONSerialization.data(withJSONObject: [
            "member": ["id": id.uuidString, "label": label, "status": status, "isDefault": isDefault,
                       "createdAt": 1, "updatedAt": 1], "connection": connection,
        ])
        return try JSONDecoder().decode(CardMemberSummary.self, from: data)
    }

    static func main() throws {
        let id = UUID(), customID = UUID(), revokedID = UUID()
        let actual = try member(id, label: "Research", isDefault: true, enabled: true, configured: true)
        let custom = try member(customID, label: "Claude Code")
        let revoked = try member(revokedID, label: "Retired", status: "REVOKED")
        let roster = MembersRosterPresentation([actual, custom, revoked])
        precondition(roster.sections.map(\.group) == [.setUp, .available, .custom])
        let first = roster.sections[0].rows[0]
        precondition(first.name == "Research" && first.memberID == id && first.provider == "OpenAI")
        precondition(first.status == .waiting && first.action == nil && first.explanation.contains("Codex chat"))
        precondition(roster.sections[1].rows.map(\.name) == ["Claude Code", "Gemini CLI", "Grok", "Cursor Agent", "GitHub Copilot", "Windsurf"])
        precondition(roster.sections[1].rows.allSatisfy { $0.status == .comingSoon && $0.action == nil && $0.memberID == nil })
        let realCustom = roster.rows.first { $0.memberID == customID }!
        precondition(realCustom.provider == "Custom agent" && realCustom.isCustom && realCustom.status == .notSetUp && realCustom.action == .connect)
        let retired = roster.rows.first { $0.memberID == revokedID }!
        precondition(retired.status == .revoked && retired.action == nil && !retired.canSelect)

        let pending = MembersRosterPresentation([actual, custom], connectingMemberID: customID)
        precondition(pending.rows.first { $0.memberID == customID }?.status == .settingUp)
        let live = try member(id, label: "Codex", isDefault: true, enabled: true, configured: true, live: true)
        precondition(MembersRosterPresentation([live]).rows[0].status == .connected)
        let fresh = try member(id, label: "Codex", isDefault: true)
        let available = MembersRosterPresentation([fresh])
        precondition(available.sections[0].rows.isEmpty && available.sections[1].rows[0].action == .connect)
        let restarted = try member(id, label: "Codex", isDefault: true, configured: true)
        let savedSetup = MembersRosterPresentation([restarted]).sections[0].rows[0]
        precondition(savedSetup.status == .notConnected && savedSetup.action == .connect,
            "Saved provider setup cannot imply enabled access after restart")
        let allowed = try member(customID, label: "Codex", enabled: true)
        precondition(MembersRosterPresentation([allowed]).sections[2].rows[0].status == .accessAllowed)
        precondition(!MembersRosterPresentation([allowed]).rows.contains { $0.status == .connected })

        let failed = MembersRosterPresentation([actual, revoked], connectionIssueMemberID: id)
        precondition(failed.rows[0].status == .connectionIssue && failed.rows[0].action == .retrySetup)
        precondition(failed.sections[1].rows.allSatisfy { $0.status == .comingSoon })
        precondition(MembersRosterPresentation([revoked], connectionIssueMemberID: revokedID).sections[2].rows[0].status == .revoked)
        let empty = MembersRosterPresentation([])
        precondition(empty.rows.count == 7 && empty.sections[2].rows.isEmpty)
        precondition(empty.sections[1].rows[0].status == .loading && empty.sections[1].rows[0].action == nil)
        let unreadable = MembersRosterPresentation([], hasLoadError: true)
        precondition(unreadable.sections[1].rows[0].status == .connectionIssue)
        precondition(unreadable.sections[1].rows.dropFirst().allSatisfy { $0.status == .comingSoon })
        precondition(Set(roster.rows.map(\.id)).count == roster.rows.count)
        print("Members presentation: SET UP / AVAILABLE / CUSTOM, actions versus statuses, and truthful custom access passed")
    }
}
