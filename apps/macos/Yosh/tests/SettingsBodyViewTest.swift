import AppKit
import SwiftUI

/// Native fixture controls only: no running app, backend, wallet secrets, or filesystem mutations.
@main
struct SettingsBodyViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let address = "FixturePublicAddress1234567890"
        let payload: [String: Any] = [
            "service": ["status": "running", "purchaseMode": "simulated", "network": "Fixture"],
            "wallet": ["address": address],
            "budget": ["dailyLimit": NSNull(), "dailyLimitDisplay": "Not set", "paid": "0", "reserved": "0",
                "remaining": NSNull(), "remainingDisplay": "Not set", "paused": false],
            "grant": NSNull(), "connection": ["enabled": false, "lastSeen": NSNull(), "access": "read_only"],
            "purchases": [],
        ]
        let overview = try JSONDecoder().decode(AppOverview.self, from: JSONSerialization.data(withJSONObject: payload))
        let directory = URL(fileURLWithPath: "/tmp/yosh-settings-fixture", isDirectory: true)
        let mainnetAddress = "MainnetFixturePublicAddress1234567890"
        let information = CardSettingsPresentation(wallets: [
            .init(id: "mainnet", label: "Mainnet", address: mainnetAddress, status: .available),
            .init(id: "devnet", label: "Devnet · Test", address: overview.wallet.address, status: .available),
        ], dataDirectory: directory)
        var copied: [String] = [], opened: [URL] = [], repositories = 0, reloads = 0
        let body = CardSettingsBody(information: information, appVersion: "Fixture version", isLoading: false, error: nil,
            onCopyWallet: { copied.append($0) }, onOpenDataFolder: { opened.append($0) },
            onOpenRepository: { repositories += 1 }, onReload: { reloads += 1 })
            .frame(width: CardMetrics.cardSize.width, height: 526)
            .background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light)
        let host = NSHostingView(rootView: body)
        let window = fixtureWindow(host)
        guard let scroll = scrollView(in: host), let document = scroll.documentView else {
            fatalError("Settings must expose a native vertical scroll view")
        }
        precondition(CardMetrics.cardSize == CGSize(width: 420, height: 684))
        precondition(CardMetrics.windowSize == CGSize(width: 444, height: 708))
        precondition(host.frame.size == NSSize(width: 420, height: 526))
        precondition(document.bounds.height > scroll.contentView.bounds.height)
        precondition(document.bounds.width <= scroll.contentView.bounds.width + 1)
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-top.png") }

        click(window, at: NSPoint(x: 340, y: 324))
        click(window, at: NSPoint(x: 340, y: 285))
        precondition(copied == [mainnetAddress, address], "Each wallet must copy its own full backend public address")
        precondition(opened.isEmpty && repositories == 0 && reloads == 0)

        scrollTo(scroll, y: document.bounds.height - scroll.contentView.bounds.height)
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-bottom.png") }
        click(window, at: NSPoint(x: 340, y: 218))
        click(window, at: NSPoint(x: 340, y: 84))
        precondition(opened == [directory] && repositories == 1 && copied == [mainnetAddress, address] && reloads == 0,
            "Settings actions must stay independent and use the resolved directory")
        if CommandLine.arguments.count == 2 { try render(host, to: CommandLine.arguments[1] + "-bottom.png") }
        window.close()

        let emptyWallets = CardSettingsPresentation(wallets: [
            .init(id: "mainnet", label: "Mainnet", address: nil, status: .missing),
            .init(id: "devnet", label: "Devnet · Test", address: nil, status: .unavailable),
        ])
        let unavailable = NSHostingView(rootView: CardSettingsBody(information: emptyWallets, appVersion: "Unavailable",
            isLoading: false, error: "Fixture unavailable", onCopyWallet: { copied.append($0) },
            onOpenDataFolder: { opened.append($0) }, onOpenRepository: { repositories += 1 }, onReload: { reloads += 1 })
            .frame(width: 420, height: 526))
        let failedWindow = fixtureWindow(unavailable)
        click(failedWindow, at: NSPoint(x: 340, y: 324))
        click(failedWindow, at: NSPoint(x: 340, y: 285))
        precondition(copied == [mainnetAddress, address] && opened == [directory] && repositories == 1,
            "Unavailable wallet/storage must not expose active actions")
        failedWindow.close()
        print("Settings native body: frozen window geometry, vertical scrolling, full-address copy, resolved-folder action, independent GitHub, and unavailable states passed")
    }

    @MainActor
    private static func fixtureWindow(_ host: NSView) -> NSWindow {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 526),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = host
        window.alphaValue = 0
        window.orderFront(nil)
        host.layoutSubtreeIfNeeded()
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
        return window
    }

    @MainActor
    private static func click(_ window: NSWindow, at point: NSPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
            window.sendEvent(event)
        }
    }

    @MainActor
    private static func scrollTo(_ scroll: NSScrollView, y: CGFloat) {
        scroll.contentView.scroll(to: NSPoint(x: 0, y: y))
        scroll.reflectScrolledClipView(scroll.contentView)
        RunLoop.current.run(until: .now.addingTimeInterval(0.1))
    }

    @MainActor
    private static func scrollView(in view: NSView) -> NSScrollView? {
        if let scroll = view as? NSScrollView { return scroll }
        return view.subviews.compactMap { scrollView(in: $0) }.first
    }

    @MainActor
    private static func render(_ host: NSView, to path: String) throws {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { fatalError("Fixture rendering unavailable") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])?.write(to: URL(filePath: path))
    }
}
