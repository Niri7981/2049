import Foundation

enum CardMemberSelection {
    static func choose(current: UUID?, from members: [CardMemberSummary]) -> UUID? {
        let active = members.filter { $0.member.status == .active }
        if let current, active.contains(where: { $0.member.id == current }) { return current }
        return active.first(where: { $0.member.isDefault })?.member.id
            ?? active.sorted {
                if $0.member.createdAt != $1.member.createdAt { return $0.member.createdAt < $1.member.createdAt }
                return $0.member.id.uuidString < $1.member.id.uuidString
            }.first?.member.id
    }
}
