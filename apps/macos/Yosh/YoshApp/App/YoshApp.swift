import SwiftUI

@main
struct YoshApp: App {
    @NSApplicationDelegateAdaptor(CardApplicationDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
