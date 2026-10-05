import AppKit
import SwiftUI

private enum Route: Hashable {
    case daily, grant, activity, purchase(String), member(UUID)
    var parent: Route? {
        if case .purchase = self { return .activity }
        return nil
    }
    var label: String {
        switch self {
        case .daily: "Daily"
        case .grant: "Grant"
        case .activity: "Activity"
        case .purchase(let id): id
        case .member(let id): id.uuidString
        }
    }
}

@MainActor @Observable
private final class Probe {
    var navigation = YoshDetailNavigation<Route>()
    var mounts: [String: Int] = [:]
    var drafts: [String: String] = [:]
    var actions: [String: Int] = [:]
    var markerWidth: CGFloat = 140
    func show(_ route: Route?, animated: Bool = true) {
        navigation.show(route, parent: { $0.parent }, animated: animated)
    }
}

private struct Page: View {
    let route: Route?
    let probe: Probe
    @State private var draft = ""
    private var label: String { route?.label ?? "Authority" }
    private var color: Color {
        switch route {
        case nil: .red
        case .activity: .green
        case .purchase: .blue
        default: .purple
        }
    }
    private var topInset: CGFloat {
        if case .purchase = route { return 12 }
        return route == nil ? 68 : 40
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Rectangle().fill(color).frame(width: probe.markerWidth, height: 24)
                .padding(.leading, route == nil ? 8 : 80)
                .accessibilityHidden(true)
            TextField("Draft", text: $draft).textFieldStyle(.roundedBorder)
                .frame(width: 200).padding(.leading, 40).accessibilityLabel("Draft \(label)")
            Button("Action \(label)") { probe.actions[label, default: 0] += 1 }
                .buttonStyle(.plain).frame(width: 100, height: 32)
                .padding(.leading, 40).accessibilityLabel("Action \(label)")
        }
        .padding(.top, topInset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task { probe.mounts[label, default: 0] += 1 }
        .onChange(of: draft) { _, value in probe.drafts[label] = value }
    }
}

private struct Fixture: View {
    let probe: Probe
    let reduceMotion: Bool
    var body: some View {
        VStack(spacing: 0) {
            Color.orange.frame(width: 80, height: 20)
            YoshDetailStack(navigation: probe.navigation, reduceMotion: reduceMotion, parent: { $0.parent }) {
                Page(route: nil, probe: probe)
            } destination: { route in
                Page(route: route, probe: probe)
            }
        }
        .frame(width: 420, height: 320)
        .background(Color(white: 0.95)).environment(\.colorScheme, .light)
    }
}

/// Render the production stack and use real native input; no installed app/backend access.
@main
struct DetailNavigationMotionTest {
    @MainActor static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let poseProbe = Probe()
        let poseHost = NSHostingView(rootView: YoshDetailPage(isActive: false, isAncestor: true,
            isRoot: true, entering: true, animated: false, reduceMotion: false) {
            Page(route: .activity, probe: poseProbe)
        }.frame(width: 420, height: 320))
        let poseWindow = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 320),
            styleMask: .borderless, backing: .buffered, defer: false)
        poseWindow.isReleasedWhenClosed = false
        poseWindow.contentView = poseHost
        poseWindow.alphaValue = 0
        poseWindow.orderFront(nil)
        pause(0.2)
        let ancestor = try marker(.green, in: capture(poseHost))
        try require(ancestor.minX < 74 && ancestor.width < 140,
            "The previous surface must move left and recede without changing the window")
        poseWindow.close()
        for reduceMotion in [false, true] { try validate(reduceMotion: reduceMotion) }
        print("Detail motion: depth/inverse direction, interruptible Back, retained route drafts, immediate pointer/keyboard isolation, scoped updates and Reduce Motion passed")
    }

    @MainActor private static func validate(reduceMotion: Bool) throws {
        let probe = Probe()
        let host = NSHostingView(rootView: Fixture(probe: probe, reduceMotion: reduceMotion))
        let window = KeyWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 320),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        defer { window.close() }
        pause(0.35)
        let shell = try marker(.orange, in: capture(host))
        let rootBounds = try marker(.red, in: capture(host))
        let frame = window.frame
        guard let rootField = fields(host).first else { throw Failure("Missing native root editor") }
        let sourceAction = NSPoint(x: 90, y: rootField.convert(rootField.bounds, to: nil).minY - 36)
        window.makeFirstResponder(rootField)
        guard let editor = window.firstResponder as? NSTextView else { throw Failure("Missing field editor") }
        editor.insertText("source draft", replacementRange: NSRange(location: NSNotFound, length: 0))
        pause(0.02)

        probe.show(.activity)
        pause(0.07)
        // Capture before native mouse tracking runs its own nested event loop.
        let entering = try marker(.green, in: capture(host))
        try require(!rootField.isEnabled, "Outgoing native fields must disable before the transition settles")
        typeZ(window)
        try require(rootField.stringValue == "source draft", "Outgoing first responder must stop receiving keyboard edits")
        click(window, at: sourceAction)
        try require(probe.actions["Authority", default: 0] == 0, "Outgoing pointer actions must stop immediately")
        pause(0.35)
        let activityBounds = try marker(.green, in: capture(host))
        try require(reduceMotion ? abs(entering.minX - activityBounds.minX) < 1 : entering.minX > activityBounds.minX + 2,
            "Detail must enter from the right; Reduce Motion removes spatial travel: moving=\(entering), rest=\(activityBounds), reduced=\(reduceMotion)")
        try require(try marker(.orange, in: capture(host)) == shell && window.frame == frame,
            "Detail motion must leave the shell and window stationary: shell=\(try marker(.orange, in: capture(host))) expected=\(shell), window=\(window.frame) expected=\(frame)")
        guard let activityField = fields(host).first(where: { $0.isEnabled }) else { throw Failure("Missing Activity editor") }
        let actionsBefore = probe.actions["Activity", default: 0]
        let actionPoint = NSPoint(x: 90, y: activityField.convert(activityField.bounds, to: nil).minY - 36)
        click(window, at: actionPoint)
        try require(probe.actions["Activity"] == actionsBefore + 1,
            "Current detail must accept native pointer input: point=\(actionPoint), field=\(activityField.convert(activityField.bounds, to: nil)), actions=\(probe.actions), reduced=\(reduceMotion)")
        window.makeFirstResponder(activityField)
        (window.firstResponder as? NSTextView)?.insertText("activity draft", replacementRange: NSRange(location: NSNotFound, length: 0))
        pause(0.02)

        probe.show(.purchase("receipt-A"))
        pause(0.035)
        try require(!activityField.isEnabled, "Nested Purchase must immediately isolate Activity")
        pause(0.35)
        let purchaseBounds = try marker(.blue, in: capture(host))
        probe.show(.activity)
        pause(reduceMotion ? 0.06 : 0.035)
        let leaving = try marker(.blue, in: capture(host))
        try require(reduceMotion ? abs(leaving.minX - purchaseBounds.minX) < 1 : leaving.minX > purchaseBounds.minX + 2,
            "Back must send the departing detail right along the inverse path: moving=\(leaving), rest=\(purchaseBounds), reduced=\(reduceMotion)")
        pause(0.35)
        try require(try marker(.green, in: capture(host)) == activityBounds && activityField.stringValue == "activity draft",
            "Nested Back must restore Activity geometry and its local state")

        // Redirect a moving presentation before either endpoint, including first-visit cancellation.
        probe.show(.purchase("receipt-B"))
        pause(0.02)
        probe.show(.activity)
        pause(0.02)
        probe.show(nil)
        pause(0.02)
        probe.show(.daily)
        pause(0.02)
        probe.show(nil)
        pause(0.35)
        try require(try marker(.red, in: capture(host)) == rootBounds && rootField.stringValue == "source draft",
            "Rapid enter/Back must settle at the requested source without remounting or resetting it")

        let memberID = UUID()
        for route in [Route.grant, .member(memberID), .purchase("receipt-A")] {
            probe.show(route)
            pause(0.025)
            probe.show(nil)
            pause(0.025)
        }
        pause(0.35)
        try require(probe.mounts.values.allSatisfy { $0 == 1 }, "Retargeting must preserve every visited route's mount identity")
        try require(probe.navigation.visited.contains(.member(memberID)) && probe.navigation.visited.contains(.purchase("receipt-A")),
            "Member and purchase identities must survive interruptions")

        // A child update in the same frame must not inherit the surface's spring.
        probe.markerWidth = 200
        probe.show(.activity)
        pause(0.08)
        let updatedChild = try marker(.green, in: capture(host))
        try require(updatedChild.width > 195, "Navigation must not animate child layout changes: \(updatedChild)")
        pause(0.35)
        probe.show(nil, animated: false)
        pause(0.02)
        try require(try marker(.red, in: capture(host)).minX == rootBounds.minX,
            "Excluded/immediate routes must not inherit detail motion")
        try require(YoshTabMotion.Detail.exitDuration < YoshTabMotion.Detail.entryDuration,
            "Back must be faster than entry")
    }

    @MainActor private static func fields(_ view: NSView) -> [NSTextField] {
        if let field = view as? NSTextField { return [field] }
        return view.subviews.flatMap(fields)
    }
    @MainActor private static func capture(_ host: NSView) throws -> NSBitmapImageRep {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw Failure("Cannot render native fixture") }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        return bitmap
    }
    private enum Marker { case red, green, blue, orange }
    private static func marker(_ marker: Marker, in bitmap: NSBitmapImageRep) throws -> CGRect {
        let scale = CGFloat(bitmap.pixelsWide) / 420
        var minX = bitmap.pixelsWide, minY = bitmap.pixelsHigh, maxX = -1, maxY = -1
        // Separate source/destination marker bands so crossfading colors cannot
        // conceal the departing layer's transform.
        let band: Range<Int> = switch marker {
        case .orange: 0..<Int(20 * scale)
        case .blue: Int(25 * scale)..<Int(58 * scale)
        case .red: Int(80 * scale)..<Int(118 * scale)
        case .green: Int(50 * scale)..<Int(90 * scale)
        }
        for y in band {
            for x in 0..<bitmap.pixelsWide {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                let r = color.redComponent, g = color.greenComponent, b = color.blueComponent
                let matches: Bool
                switch marker {
                case .red: matches = r - max(g, b) > 0.04 && abs(g - b) < 0.08
                case .green: matches = g - max(r, b) > 0.04
                case .blue: matches = b - max(r, g) > 0.012
                case .orange: matches = r > 0.8 && g > 0.3 && g < 0.8 && b < 0.35
                }
                if matches { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
            }
        }
        guard maxX >= minX else { throw Failure("Missing \(marker) marker") }
        return CGRect(x: CGFloat(minX) / scale, y: CGFloat(minY) / scale,
            width: CGFloat(maxX - minX + 1) / scale, height: CGFloat(maxY - minY + 1) / scale)
    }
    @MainActor private static func click(_ window: NSWindow, at point: NSPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            window.sendEvent(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!)
        }
    }
    @MainActor private static func typeZ(_ window: NSWindow) {
        window.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil,
            characters: "z", charactersIgnoringModifiers: "z", isARepeat: false, keyCode: 6)!)
        pause(0.01)
    }
    @MainActor private static func pause(_ duration: TimeInterval) { RunLoop.current.run(until: .now.addingTimeInterval(duration)) }
    private static func require(_ condition: Bool, _ message: String) throws { if !condition { throw Failure(message) } }
    private struct Failure: Error, CustomStringConvertible {
        let description: String
        init(_ description: String) { self.description = description }
    }
}

private final class KeyWindow: NSWindow { override var canBecomeKey: Bool { true } }
