import SwiftUI

/// Native NavigationTransition on macOS cannot customize paired ancestor/destination
/// transforms. Retain SwiftUI surfaces and animate only their rendering properties.
struct YoshDetailStack<Route: Hashable, Root: View, Destination: View>: View {
    let navigation: YoshDetailNavigation<Route>
    let reduceMotion: Bool
    var parent: (Route) -> Route? = { _ in nil }
    @ViewBuilder let root: () -> Root
    @ViewBuilder let destination: (Route) -> Destination

    var body: some View {
        GeometryReader { viewport in
            ZStack(alignment: .top) {
                YoshDetailPage(isActive: navigation.selection == nil,
                    isAncestor: navigation.selection != nil, isRoot: true,
                    entering: navigation.entering, animated: navigation.animated, reduceMotion: reduceMotion) {
                    root()
                }
                ForEach(navigation.visited, id: \.self) { route in
                    YoshDetailPage(isActive: navigation.selection == route,
                        isAncestor: navigation.selection.flatMap(parent) == route, isRoot: false,
                        entering: navigation.entering, animated: navigation.animated, reduceMotion: reduceMotion) {
                        destination(route)
                    }
                    // Depth order stays fixed on Back so the departing surface remains in front.
                    .zIndex(parent(route) == nil ? 1 : 2)
                }
            }
            .frame(width: viewport.size.width, height: viewport.size.height, alignment: .top)
            // Clip the composed moving planes at the actual detail viewport. Clipping
            // only their layout bounds does not contain transformed backing layers.
            .compositingGroup()
            .clipped()
        }
    }
}
