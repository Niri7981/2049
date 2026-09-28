import AppKit
import SwiftUI

final class CardApplicationDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var cardWindow: AgentCardNSWindow?
    private let serviceRuntime = NativeServiceRuntime()
    private var terminationRequested = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let windowRect = NSRect(origin: .zero, size: CardMetrics.windowSize)
        let window = AgentCardNSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "2049"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.contentView = NSHostingView(rootView: CardWindow(overviewClient: OverviewClient(runtime: serviceRuntime)))
        window.setFrame(windowRect, display: false)
        for button in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            window.standardWindowButton(button)?.isHidden = true
        }
        window.isOpaque = false
        // Give the transparent window a mouse target even where SwiftUI draws material.
        window.backgroundColor = NSColor(white: 1, alpha: 0.01)
        window.ignoresMouseEvents = false
        window.isMovableByWindowBackground = true
        window.hasShadow = false
        window.level = .normal
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        cardWindow = window
        Task { _ = try? await serviceRuntime.ready() }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if cardWindow?.isMiniaturized == true { cardWindow?.deminiaturize(nil) }
        cardWindow?.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationRequested { return .terminateLater }
        terminationRequested = true
        Task {
            await serviceRuntime.shutdown()
            sender.reply(toApplicationShouldTerminate: true)
        }
        return .terminateLater
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.hide(nil)
        return false
    }
}
