import SwiftUI

@main
struct TwentyFortyNineApp: App {
    @NSApplicationDelegateAdaptor(CardApplicationDelegate.self) private var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
