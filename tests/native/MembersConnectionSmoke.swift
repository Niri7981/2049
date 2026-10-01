import Foundation

/// Uses only the test runner's authenticated local fixture on an ephemeral port.
@main
struct MembersConnectionSmoke {
    @MainActor
    static func main() async throws {
        let environment = ProcessInfo.processInfo.environment
        let runtime = NativeServiceRuntime(allowsLaunch: false, environment: [
            "APP2049_PORT": environment["APP2049_PORT"]!, "APP2049_DATA_DIR": environment["APP2049_DATA_DIR"]!,
            "APP2049_REPOSITORY_ROOT": environment["APP2049_REPOSITORY_ROOT"]!,
        ], managementTokenOverride: environment["APP2049_MANAGEMENT_TOKEN"]!)
        let session = CardMemberSession(client: OverviewClient(runtime: runtime))
        let defaultID = UUID(uuidString: "11111111-1111-4111-8111-111111111111")!
        let customID = UUID(uuidString: "22222222-2222-4222-8222-222222222222")!
        let failureID = UUID(uuidString: "33333333-3333-4333-8333-333333333333")!
        let revokedID = UUID(uuidString: "44444444-4444-4444-8444-444444444444")!
        await session.refresh()
        precondition(session.members.count == 4 && session.selectedMemberID == defaultID)
        session.select(customID)
        let first = Task { await session.connect(defaultID) }
        for _ in 0..<50 {
            if session.connectingMemberID == defaultID { break }
            try await Task.sleep(for: .milliseconds(10))
        }
        precondition(session.connectingMemberID == defaultID)
        precondition(MembersRosterPresentation(session.members, connectingMemberID: session.connectingMemberID).rows[0].action == .connecting)
        await session.connect(defaultID) // Duplicate and other-row clicks must not rotate credentials twice.
        await session.connect(customID)
        await first.value
        precondition(session.connectingMemberID == nil && session.connectionError == nil)
        precondition(session.members.first { $0.member.id == defaultID }?.connection.enabled == true)
        precondition(session.selectedMemberID == customID, "Quick connect must not change the current member")
        await session.connect(defaultID) // Already enabled: no extra write or grant invalidation.
        await session.connect(revokedID)

        await session.connect(failureID)
        precondition(session.connectionError != nil && session.connectingMemberID == nil)
        precondition(session.members.first { $0.member.id == failureID }?.connection.enabled == false)
        await session.connect(failureID)
        precondition(session.connectionError == nil && session.members.first { $0.member.id == failureID }?.connection.enabled == true)

        await session.connect(customID) // The fixture rejects the following read once.
        precondition(session.loadError != nil && session.members.isEmpty && session.selectedMemberID == nil,
            "A successful write without a readable snapshot must not fabricate a connected roster")
        precondition(session.connectingMemberID == nil)
        await session.refresh(retry: true)
        precondition(session.loadError == nil && session.members.first { $0.member.id == customID }?.connection.enabled == true)
        precondition(!MembersRosterPresentation(session.members).rows.contains { $0.action == .connected })
        print("Members quick connect: member-scoped API, duplicate guard, stable selection, failure/retry, and unverified refresh passed")
    }
}
