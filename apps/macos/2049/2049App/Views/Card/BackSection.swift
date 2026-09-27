enum BackSection: CaseIterable {
    case authority
    case members
    case settings

    var title: String {
        switch self {
        case .authority: "Authority"
        case .members: "Members"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .authority: "person.crop.circle"
        case .members: "person.2"
        case .settings: "gearshape"
        }
    }
}
