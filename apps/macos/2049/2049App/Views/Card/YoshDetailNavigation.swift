/// Keeps route identity and visited surfaces independent of their animated presentation.
struct YoshDetailNavigation<Route: Hashable> {
    private(set) var selection: Route?
    private(set) var visited: [Route] = []
    private(set) var entering = true
    private(set) var animated = true

    mutating func show(_ route: Route?, parent: (Route) -> Route? = { _ in nil }, animated: Bool = true) {
        func depth(_ route: Route?) -> Int {
            guard let route else { return 0 }
            return parent(route) == nil ? 1 : 2
        }
        entering = depth(route) > depth(selection)
        self.animated = animated
        selection = route
        if let route {
            if let ancestor = parent(route), !visited.contains(ancestor) { visited.append(ancestor) }
            if !visited.contains(route) { visited.append(route) }
        }
    }
}
