import Foundation
import Observation

/// The card's single selection. List order comes from the backend, with its default member first.
@MainActor @Observable
final class CardMemberSession {
    private(set) var members: [CardMemberSummary] = []
    private(set) var selectedMemberID: UUID?
    private(set) var loadError: String?
    private(set) var isLoading = false
    private(set) var connectingMemberID: UUID?
    private(set) var connectionError: String?

    private let client: OverviewClient
    private var loadRevision = 0

    init(client: OverviewClient) {
        self.client = client
    }

    var selectedMember: CardMemberSnapshot.Member? {
        members.first { $0.member.id == selectedMemberID && $0.member.status == .active }?.member
    }

    var activeMembers: [CardMemberSummary] {
        members.filter { $0.member.status == .active }
    }

    func select(_ id: UUID) {
        guard activeMembers.contains(where: { $0.member.id == id }) else { return }
        selectedMemberID = id
    }

    func refresh(retry: Bool = false) async {
        loadRevision += 1
        let revision = loadRevision
        isLoading = true
        defer { if revision == loadRevision { isLoading = false } }
        do {
            let loaded = try await client.loadMembers(retry: retry)
            guard revision == loadRevision, !Task.isCancelled else { return }
            applyMembers(loaded)
            loadError = nil
        } catch is CancellationError {
            return
        } catch {
            guard revision == loadRevision else { return }
            // An unavailable member list cannot certify that the previous selection is still active.
            members = []
            selectedMemberID = nil
            loadError = (error as? OverviewLoadError)?.message ?? "Agents could not be loaded"
        }
    }

    func create(label: String) async throws {
        let snapshot = try await client.createMember(label: label)
        members.append(CardMemberSummary(snapshot: snapshot))
        reconcileSelection()
        await refresh()
    }

    /// Enables only the requested member's access; it does not certify a live host connection.
    func connect(_ id: UUID) async {
        guard connectingMemberID == nil, !isLoading,
              let member = activeMembers.first(where: { $0.member.id == id }),
              !member.connection.enabled else { return }
        connectingMemberID = id
        connectionError = nil
        defer { connectingMemberID = nil }
        do {
            try await client.setMemberConnection(id, enabled: true)
            // Read the backend's resulting state; a 200 write response alone is not the roster snapshot.
            await refresh()
        } catch {
            let explanation = (error as? OverviewLoadError)?.message ?? "Connection access could not be enabled"
            connectionError = "\(member.member.label): \(explanation)"
        }
    }

    func rename(_ id: UUID, label: String) async throws {
        let snapshot = try await client.renameMember(id, label: label)
        replace(snapshot)
        await refresh()
    }

    func revoke(_ id: UUID) async throws {
        let snapshot = try await client.revokeMember(id)
        replace(snapshot)
        await refresh()
    }

    private func replace(_ snapshot: CardMemberSnapshot) {
        guard let index = members.firstIndex(where: { $0.member.id == snapshot.member.id }) else { return }
        members[index] = CardMemberSummary(snapshot: snapshot)
        reconcileSelection()
    }

    /// Keeps a valid current member; on startup or revoke, prefers the backend default.
    func applyMembers(_ loaded: [CardMemberSummary]) {
        members = loaded
        reconcileSelection()
    }

    private func reconcileSelection() {
        selectedMemberID = CardMemberSelection.choose(current: selectedMemberID, from: members)
    }
}
