import AppKit
import SwiftUI

@MainActor @Observable
private final class MotionProbe {
    var selection: BackSection = .connection
    var visited: Set<BackSection> = [.connection]
    var mounts: [BackSection: Int] = [:]
    var drafts: [BackSection: String] = [:]
    var presses: [BackSection: Int] = [:]
    var markerWidth: CGFloat = 40

    func select(_ section: BackSection) {
        visited.insert(section)
        selection = section
    }
}

private struct FixturePage: View {
    let section: BackSection
    let probe: MotionProbe
    @State private var draft = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            Rectangle().fill(markerColor).frame(width: probe.markerWidth, height: 24)
                .padding(.leading, 80)
            TextField("Draft", text: $draft).textFieldStyle(.roundedBorder)
                .frame(width: 200).padding(.leading, 40)
            Button("Action \(section.rawValue)") { probe.presses[section, default: 0] += 1 }
                .frame(width: 60).padding(.leading, CGFloat(20 + section.rawValue * 80))
        }
        .padding(.top, 60)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task { probe.mounts[section, default: 0] += 1 }
        .onChange(of: draft) { _, value in probe.drafts[section] = value }
    }

    private var markerColor: Color {
        switch section {
        case .connection: .red
        case .authority: .green
        case .members: .blue
        case .settings: .purple
        }
    }
}

private struct MotionFixture: View {
    let probe: MotionProbe
    let reduceMotion: Bool
    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color.orange).frame(width: 80, height: 20)
            ZStack {
                ForEach(BackSection.allCases, id: \.self) { section in
                    Group {
                        if probe.visited.contains(section) { FixturePage(section: section, probe: probe) }
                    }
                    .modifier(YoshTabSurface(section: section, selection: probe.selection, reduceMotion: reduceMotion))
                }
            }
            .frame(height: 300).clipped()
            BackNavigation(selection: Binding(get: { probe.selection }, set: probe.select))
                .frame(width: 380, height: 76)
        }
        .frame(width: 420, height: 396)
        .background(Color(white: 0.35))
        .environment(\.colorScheme, .light)
    }
}

/// Native rendered surfaces and real input only; no backend, Keychain or installed App.
/// Compile with BackSection, BackNavigation, YoshTabMotion and YoshTabPage.
@main
struct TopLevelTabMotionTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        try validate(reduceMotion: false)
        try validate(reduceMotion: true)
        print("Top-level tab motion: directional surfaces, interruptible selection, immediate input isolation, retained drafts/mounts, scoped child updates and Reduce Motion passed")
    }

    @MainActor
    private static func validate(reduceMotion: Bool) throws {
        let probe = MotionProbe()
        let host = NSHostingView(rootView: MotionFixture(probe: probe, reduceMotion: reduceMotion))
        let window = FixtureWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 396),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        pause(0.4)
        let baseline = try capture(host)
        if CommandLine.arguments.count == 2 {
            try baseline.representation(using: .png, properties: [:])?.write(to: URL(filePath: CommandLine.arguments[1] + "-baseline.png"))
        }
        let initial = try bounds(.connection, in: baseline)
        let initialIndicator = try indicatorCenter(in: baseline)
        let shell = try orangeBounds(in: baseline)
        let initialFrame = window.frame

        guard let field = fields(in: host).first(where: { $0.isEnabled }) else { throw Failure("Missing native draft field") }
        window.makeFirstResponder(field)
        guard let editor = window.firstResponder as? NSTextView else { throw Failure("Missing native editor") }
        editor.insertText("retained draft", replacementRange: NSRange(location: NSNotFound, length: 0))
        pause(0.02)
        try require(probe.drafts[.connection] == "retained draft", "Native editing must update the page draft")

        click(window, at: NSPoint(x: 150, y: 38))
        pause(reduceMotion ? 0.075 : 0.025)
        try require(probe.selection == .authority, "Tab input must take effect before its animation finishes")
        try require(!field.isEnabled, "Outgoing native editors must immediately disable")
        click(window, at: NSPoint(x: 50, y: 196))
        try require(probe.presses[.connection, default: 0] == 0, "Outgoing actions must stop immediately")
        let moving = try capture(host)
        let incoming = try bounds(.authority, in: moving)
        if CommandLine.arguments.count == 2 {
            try moving.representation(using: .png, properties: [:])?.write(to: URL(filePath: CommandLine.arguments[1] + "-moving.png"))
        }
        if reduceMotion {
            try require(abs(incoming.midX - initial.midX) < 1 && abs(incoming.width - initial.width) < 1,
                "Reduce Motion must eliminate translation and depth")
        } else {
            try require(incoming.midX > initial.midX + 2, "The next surface must enter from the right")
            let indicator = try indicatorCenter(in: moving)
            try require(indicator > initialIndicator + 1 && indicator < initialIndicator + 90,
                "The shared selection surface must move through intermediate positions")
            if let outgoing = colorBounds(.connection, in: moving) {
                try require(outgoing.midX < initial.midX, "The previous surface must recede to the left")
            }
        }
        try require(try orangeBounds(in: moving) == shell && window.frame == initialFrame,
            "The shell must stay stationary during page motion")
        pause(0.4)
        let settled = try capture(host)
        try require(try bounds(.authority, in: settled) == initial,
            "Settled page layout must preserve original size and position")
        click(window, at: NSPoint(x: 130, y: 196))
        try require(probe.presses[.authority] == 1, "The active page's real action must remain usable")

        if !reduceMotion {
            probe.select(.settings)
            pause(0.025)
            let beforeReverse = try indicatorCenter(in: capture(host))
            probe.select(.connection)
            pause(0.025)
            let afterReverse = try indicatorCenter(in: capture(host))
            try require(abs(afterReverse - beforeReverse) < 75 && afterReverse > initialIndicator + 5,
                "A rapid reversal must redirect the moving surface instead of snapping to either endpoint")
            pause(0.4)
            try require(abs(try indicatorCenter(in: capture(host)) - initialIndicator) < 1,
                "The interrupted surface must settle at the final requested tab")
        }

        // A child's own update must be immediate even when the page starts its motion.
        probe.markerWidth = 140
        probe.select(.members)
        // Wait for the outgoing color to clear; overlapping markers hide part of the
        // incoming width. The page spring is still moving when this is measured.
        pause(reduceMotion ? YoshTabMotion.reducedDuration + 0.02 : YoshTabMotion.exitOpacityDuration + 0.02)
        let childUpdate = try bounds(.members, in: capture(host))
        try require(childUpdate.width > 135, "Surface animation must not animate page internals")
        probe.markerWidth = 40
        probe.select(.settings)
        pause(0.02)
        probe.select(.connection)
        pause(0.02)
        probe.select(.members)
        pause(0.02)
        probe.select(.settings)
        pause(0.5)
        try require(probe.selection == .settings, "Rapid presses must settle on the last request without a queue")
        try require(probe.mounts.values.allSatisfy { $0 == 1 } && probe.mounts.count == 4,
            "Motion must not remount pages or restart their initial tasks")
        try require(fields(in: host).contains { $0.stringValue == "retained draft" },
            "Switching away must preserve the native editor's local state")

        probe.select(.connection)
        pause(reduceMotion ? 0.09 : 0.025)
        let reverse = try bounds(.connection, in: capture(host))
        try require(reduceMotion ? abs(reverse.midX - initial.midX) < 1 : reverse.midX < initial.midX - 2,
            "Leftward navigation must mirror the spatial direction")
        pause(0.4)
        window.makeFirstResponder(field)
        probe.select(.authority)
        pause(0.01)
        window.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, characters: "z", charactersIgnoringModifiers: "z", isARepeat: false, keyCode: 6)!)
        pause(0.01)
        try require(field.stringValue == "retained draft", "An outgoing first responder must stop accepting keyboard edits")
        pause(0.4)
        // Non-adjacent moves may pass other positions, but must not reveal those pages.
        probe.select(.connection)
        pause(0.4)
        probe.select(.settings)
        pause(0.025)
        let jump = try capture(host)
        try require(colorBounds(.authority, in: jump) == nil && colorBounds(.members, in: jump) == nil,
            "Skipping tabs must not flash intermediate surfaces")
        pause(0.4)
        if CommandLine.arguments.count == 2 {
            try capture(host).representation(using: .png, properties: [:])?.write(
                to: URL(filePath: CommandLine.arguments[1] + (reduceMotion ? "-reduced.png" : "-normal.png")))
        }
    }

    @MainActor private static func pause(_ duration: TimeInterval) {
        RunLoop.current.run(until: .now.addingTimeInterval(duration))
    }
    @MainActor private static func click(_ window: NSWindow, at point: NSPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!)
        }
    }
    @MainActor private static func fields(in view: NSView) -> [NSTextField] {
        if let field = view as? NSTextField { return [field] }
        return view.subviews.flatMap { fields(in: $0) }
    }
    @MainActor private static func capture(_ host: NSView) throws -> NSBitmapImageRep {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw Failure("Cannot render fixture") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
    }
    private static func colorBounds(_ section: BackSection, in bitmap: NSBitmapImageRep) -> CGRect? {
        pixelBounds(in: bitmap) { r, g, b in
            switch section {
            case .connection: r - max(g, b) > 0.04 && abs(g - b) < 0.08
            case .authority: g - max(r, b) > 0.04
            case .members: b - max(r, g) > 0.04
            case .settings: min(r, b) - g > 0.04 && abs(r - b) < 0.3
            }
        }
    }
    private static func orangeBounds(in bitmap: NSBitmapImageRep) throws -> CGRect {
        guard let bounds = pixelBounds(in: bitmap, height: 20, matches: { r, g, b in r > 0.8 && g > 0.3 && g < 0.8 && b < 0.35 }) else {
            throw Failure("Missing stationary shell marker")
        }
        return bounds
    }
    private static func pixelBounds(in bitmap: NSBitmapImageRep, height: CGFloat = 115, matches: (Double, Double, Double) -> Bool) -> CGRect? {
        var minX = bitmap.pixelsWide, minY = bitmap.pixelsHigh, maxX = -1, maxY = -1
        let scale = CGFloat(bitmap.pixelsWide) / 420
        // Page markers and shell only; exclude controls and navigation below this band.
        for y in 0..<min(bitmap.pixelsHigh, Int(height * scale)) {
            for x in 0..<bitmap.pixelsWide {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                    matches(color.redComponent, color.greenComponent, color.blueComponent) else { continue }
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            }
        }
        guard maxX >= minX else { return nil }
        return CGRect(x: CGFloat(minX) / scale, y: CGFloat(minY) / scale,
            width: CGFloat(maxX - minX + 1) / scale, height: CGFloat(maxY - minY + 1) / scale)
    }
    private static func bounds(_ section: BackSection, in bitmap: NSBitmapImageRep) throws -> CGRect {
        guard let value = colorBounds(section, in: bitmap) else { throw Failure("Missing \(section.title) surface marker") }
        return value
    }
    private static func indicatorCenter(in bitmap: NSBitmapImageRep) throws -> CGFloat {
        let scale = CGFloat(bitmap.pixelsWide) / 420
        let y = Int(355 * scale)
        var start: Int?, longest: Range<Int> = 0..<0
        for x in Int(30 * scale)..<Int(390 * scale) {
            let color = bitmap.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
            let selectedTint = color.blueComponent - color.redComponent > 0.012
            if selectedTint && start == nil { start = x }
            if !selectedTint, let beginning = start {
                if x - beginning > longest.count { longest = beginning..<x }
                start = nil
            }
        }
        guard longest.count > Int(20 * scale) else { throw Failure("Missing travelling selection tint") }
        return CGFloat(longest.lowerBound + longest.upperBound) / (2 * scale)
    }
    private static func require(_ condition: Bool, _ message: String) throws {
        if !condition { throw Failure(message) }
    }
    private struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
}

private final class FixtureWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}
