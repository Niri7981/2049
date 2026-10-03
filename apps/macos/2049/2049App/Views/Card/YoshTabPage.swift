import SwiftUI

/// A persistent neighboring surface: retarget its render properties instead of replacing its state.
struct YoshTabPage<Content: View>: View {
    let section: BackSection
    let selection: BackSection
    @ViewBuilder let content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        content()
            .modifier(YoshTabSurface(section: section, selection: selection, reduceMotion: reduceMotion))
    }
}

/// Separates the native accessibility preference from the surface behavior so both modes
/// can be exercised in fixture windows without changing the user's system preference.
struct YoshTabSurface: ViewModifier {
    let section: BackSection
    let selection: BackSection
    let reduceMotion: Bool

    private var isActive: Bool { section == selection }

    func body(content: Content) -> some View {
        ZStack(alignment: .top) {
            // Keep a render surface even before a lazily visited page creates its content.
            Color.clear
            content
        }
            // Do not pass the tab transaction into fields, loading states or detail routes.
            // Other transactions originating inside a page keep their original behavior.
            .transaction(value: selection) { $0.animation = nil }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .geometryGroup()
            .scaleEffect(reduceMotion || isActive ? 1 : YoshTabMotion.recededScale)
            .offset(x: reduceMotion ? 0
                : YoshTabMotion.side(of: section, relativeTo: selection) * YoshTabMotion.travel)
            .animation(reduceMotion ? nil : YoshTabMotion.pageSpring(isActive: isActive), value: selection)
            .opacity(isActive ? 1 : 0)
            .animation(YoshTabMotion.opacityAnimation(isActive: isActive, reduceMotion: reduceMotion), value: selection)
            // These gates use selection immediately; they never wait for a spring completion.
            .disabled(!isActive)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
            .zIndex(isActive ? 1 : 0)
    }
}
