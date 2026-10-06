enum BackSection: Int, CaseIterable {
    case connection
    case authority
    case members
    case settings

    var title: String {
        switch self {
        case .connection: "Connection"
        case .authority: "Authority"
        case .members: "Agents"
        case .settings: "Settings"
        }
    }

    var symbol: String {
        switch self {
        case .connection: "circle.dashed"
        case .authority: "person.crop.circle"
        case .members: "person.2"
        case .settings: "gearshape"
        }
    }
}
