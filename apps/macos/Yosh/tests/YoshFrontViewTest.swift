import AppKit
import SwiftUI

/// Isolated native front fixtures. No runtime, credentials, network, or authentication.
@main
struct YoshFrontViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        validateAutonomousIdleRange()
        validateReadablePosture()
        try validateReducedDrawing()
        try validateEqualBodyMotionInBothEyeStates()
        validateGestureChoreography()
        precondition(YoshPINEntry.normalizedPIN("12a34 567", digitCount: 4) == "1234")
        precondition(YoshPINEntry.normalizedPIN("12a34 567", digitCount: 6) == "123456")
        precondition(YoshPINEntry.normalizedPIN("１２٣😀", digitCount: 4).isEmpty)

        let bounds = CGRect(x: 0, y: 0, width: 244, height: 350)
        let open = YoshClothShape().path(in: bounds).boundingRect
        let closed = YoshClothShape(protection: 1).path(in: bounds).boundingRect
        precondition(closed.width / open.width > 0.93 && closed.height / open.height > 0.95,
            "Protective posture must retain the approved tall footprint")

        let probe = PINProbe()
        let host = NSHostingView(rootView: PINFixture(probe: probe))
        let window = TestWindow(contentRect: CGRect(origin: .zero, size: CardMetrics.cardSize),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.setFrame(CGRect(origin: .zero, size: CardMetrics.cardSize), display: false)
        window.contentView = host
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        settle()
        precondition(!probe.focused, "The front must start idle, without automatic PIN focus")
        let idleFrame = try pixels(host)
        RunLoop.current.run(until: .now.addingTimeInterval(0.15))
        let nextIdleFrame = try pixels(host)
        precondition(nextIdleFrame == idleFrame,
            "Idle choreography must include a real stationary pause instead of continuous drifting")
        let openEyeWidth = try leftEyeWidth(nextIdleFrame)
        precondition(openEyeWidth > 0, "The default open eye must render clearly")
        precondition(tryObserveGesture(host, after: nextIdleFrame,
            timeout: YoshIdleGesture.Timing.idlePause.upperBound + 1.2),
            "An intermittent gesture must occur after the idle pause in an AppKit-hosted view")

        // Verify the full capsule, including its padding, forwards focus to native secure editing.
        click(window, at: CGPoint(x: 85, y: 63))
        settle()
        precondition(probe.focused, "Clicking the password area must focus the secure input")
        RunLoop.current.run(until: .now.addingTimeInterval(0.8))
        let focusedFrame = try pixels(host)
        let closedEyeWidth = try leftEyeWidth(focusedFrame)
        precondition(closedEyeWidth > openEyeWidth * 2,
            "Focus alone must close the eyes before any typing")
        let envelope = try restingBodyEnvelope()
        let focusedEpisodes = try observeBodyEpisodes(host, duration: 5.6, envelope: envelope) { frame in
            precondition(probe.focused && probe.pin.isEmpty,
                "Focused motion must continue without typing or another interaction")
            let eyeWidth = try leftEyeWidth(frame)
            precondition(eyeWidth > openEyeWidth * 2,
                "Every focused gesture must keep the eyes closed")
        }
        precondition(focusedEpisodes >= 2,
            "Password focus must preserve multiple visible body gestures, not just one transition")
        try validateFocusDoesNotRestartGestures(window, host: host, probe: probe, envelope: envelope)
        click(window, at: CGPoint(x: 85, y: 63))
        settle()
        precondition(probe.focused && probe.pin.isEmpty)
        guard let editor = window.firstResponder as? NSTextView else {
            preconditionFailure("PIN input must use a native secure field editor")
        }
        editor.insertText("12a3456", replacementRange: NSRange(location: NSNotFound, length: 0))
        settle()
        precondition(probe.pin == "1234", "Native paste must filter and limit a four-digit PIN")
        editor.deleteBackward(nil)
        settle()
        precondition(probe.pin == "123", "Native deletion must update the dot slots")
        sendKey(window, characters: "\u{1b}", keyCode: 53)
        settle()
        precondition(!probe.focused, "Escape must release password focus")
        let observedOpenEye = try observeOpenEye(host, closedWidth: closedEyeWidth, timeout: 1.6)
        precondition(observedOpenEye,
            "Releasing password focus must reopen the eyes")

        click(window, at: CGPoint(x: 330, y: 63))
        settle()
        precondition(probe.focused, "The opposite capsule edge must also focus input")
        sendKey(window, characters: "\r", keyCode: 36)
        settle()
        precondition(!probe.focused, "Return must finish UI editing without authentication")
        window.close()

        var flips = 0
        let front = NSHostingView(rootView: AgentCardFront(identity: AgentIdentity(name: "Codex"),
            onFlip: { flips += 1 }).environment(\.scenePhase, .inactive))
        let frontWindow = TestWindow(contentRect: CGRect(origin: .zero, size: CardMetrics.cardSize),
            styleMask: .borderless, backing: .buffered, defer: false)
        frontWindow.setFrame(CGRect(origin: .zero, size: CardMetrics.cardSize), display: false)
        frontWindow.contentView = front
        frontWindow.alphaValue = 0
        frontWindow.makeKeyAndOrderFront(nil)
        settle()
        precondition(front.frame.size == CardMetrics.cardSize, "Front must preserve the existing card dimensions")
        click(frontWindow, at: CGPoint(x: 367, y: 617))
        settle()
        precondition(flips == 1, "The existing front flip control must remain functional")
        frontWindow.close()

        if CommandLine.arguments.count == 2 {
            let directory = URL(filePath: CommandLine.arguments[1], directoryHint: .isDirectory)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            for posture in [YoshSpiritView.Posture.idle, .protective] {
                let renderer = ImageRenderer(content:
                    ZStack {
                        CardMaterial()
                        YoshSpiritView(posture: posture)
                    }
                    .frame(width: 320, height: 410)
                    .environment(\.scenePhase, .inactive)
                    .environment(\.colorScheme, .light)
                )
                renderer.scale = 2
                guard let image = renderer.nsImage,
                      let tiff = image.tiffRepresentation,
                      let bitmap = NSBitmapImageRep(data: tiff),
                      let png = bitmap.representation(using: .png, properties: [:]) else {
                    preconditionFailure("SwiftUI vector preview did not render")
                }
                try png.write(to: directory.appending(path: "yosh-\(posture).png"))
            }
        }
        print("Yosh front: increased gesture frequency, unchanged gesture duration, equal body motion in both eye states, focus continuity, Reduce Motion, real pauses, delayed cloth and PIN editing passed")
    }

    @MainActor private static func tryObserveGesture(_ host: NSView, after resting: Data, timeout: Double) -> Bool {
        let deadline = Date.now.addingTimeInterval(timeout)
        while Date.now < deadline {
            RunLoop.current.run(until: .now.addingTimeInterval(0.08))
            if let next = try? pixels(host), next != resting { return true }
        }
        return false
    }

    @MainActor private static func validateAutonomousIdleRange() {
        var random = TestRandom()
        var previous: YoshIdleGesture.Kind?
        for _ in 0..<30 {
            let idle = YoshIdleGesture.choose(after: previous, using: &random)
            precondition((1.275...1.575).contains(idle.intensity)
                && (0.58...0.86).contains(idle.timeline.duration),
                "More frequent gestures must preserve their existing amplitude and single-gesture duration")
            precondition((0.45...1.0).contains(YoshIdleGesture.pause(using: &random)),
                "The shorter pause must increase autonomous gesture frequency")
            previous = idle.kind
        }
    }

    @MainActor private static func validateEqualBodyMotionInBothEyeStates() throws {
        // Hold the protective contraction constant to isolate what the eye-state flag does.
        // Full focused posture and scheduler continuity are checked by the native host below.
        for kind in YoshIdleGesture.Kind.allCases {
            let gesture = YoshIdleGesture(kind: kind, duration: 0.7, intensity: 1.5, direction: 1)
            let pose = gesture.timeline.value(time: 0.7 * 0.22)
            let open = try bodySize(renderedDrawing(pose, focused: false, reduced: false, protection: 0), pointWidth: 320)
            let closed = try bodySize(renderedDrawing(pose, focused: true, reduced: false, protection: 0), pointWidth: 320)
            precondition(open == closed,
                "Closing the eyes must preserve each gesture's visible body deformation")
        }
    }

    private struct BodyEnvelope {
        let width: ClosedRange<CGFloat>
        let height: ClosedRange<CGFloat>

        func contains(_ size: CGSize) -> Bool {
            // Include the complete focus contraction and native raster rounding, not a gesture.
            (width.lowerBound - 2...width.upperBound + 2).contains(size.width)
                && (height.lowerBound - 2...height.upperBound + 2).contains(size.height)
        }
    }

    @MainActor private static func restingBodyEnvelope() throws -> BodyEnvelope {
        let open = try bodySize(renderedDrawing(.rest, focused: false, reduced: false), pointWidth: 320)
        let closed = try bodySize(renderedDrawing(.rest, focused: true, reduced: false), pointWidth: 320)
        return BodyEnvelope(width: min(open.width, closed.width)...max(open.width, closed.width),
            height: min(open.height, closed.height)...max(open.height, closed.height))
    }

    @MainActor private static func observeBodyEpisodes(_ host: NSView, duration: Double,
        envelope: BodyEnvelope, onFrame: (Data) throws -> Void = { _ in }) throws -> Int {
        let deadline = Date.now.addingTimeInterval(duration)
        var wasMoving = false
        var episodes = 0
        while Date.now < deadline {
            RunLoop.current.run(until: .now.addingTimeInterval(0.06))
            let frame = try pixels(host)
            try onFrame(frame)
            let moving = !envelope.contains(try bodySize(frame, pointWidth: 280))
            if moving && !wasMoving { episodes += 1 }
            wasMoving = moving
        }
        return episodes
    }

    @MainActor private static func validateFocusDoesNotRestartGestures(_ window: NSWindow,
        host: NSView, probe: PINProbe, envelope: BodyEnvelope) throws {
        let started = Date.now
        let deadline = started.addingTimeInterval(7.5)
        var nextSwitch = started
        var wasMoving = false
        var episodes = 0
        while Date.now < deadline {
            if Date.now >= nextSwitch {
                if probe.focused { sendKey(window, characters: "\u{1b}", keyCode: 53) }
                else { click(window, at: CGPoint(x: 85, y: 63)) }
                // This interval is shorter than every idle pause. A focus-dependent task
                // keeps restarting its wait and cannot begin any new body gestures.
                nextSwitch = .now.addingTimeInterval(0.20)
            }
            RunLoop.current.run(until: .now.addingTimeInterval(0.04))
            let moving = !envelope.contains(try bodySize(pixels(host), pointWidth: 280))
            // Exclude any gesture that was already playing when the stress interval began.
            if Date.now.timeIntervalSince(started) > 1.0 && moving && !wasMoving { episodes += 1 }
            wasMoving = moving
        }
        precondition(probe.pin.isEmpty, "Focus changes must not require typing")
        precondition(episodes >= 2,
            "Repeated focus changes must not restart the wait or stop ongoing body choreography")
    }

    @MainActor private static func observeOpenEye(_ host: NSView, closedWidth: Int, timeout: Double) throws -> Bool {
        let deadline = Date.now.addingTimeInterval(timeout)
        while Date.now < deadline {
            RunLoop.current.run(until: .now.addingTimeInterval(0.06))
            let width = try leftEyeWidth(pixels(host))
            if width > 0 && width * 2 < closedWidth { return true }
        }
        return false
    }

    private static func bodySize(_ png: Data, pointWidth: CGFloat) throws -> CGSize {
        guard let bitmap = NSBitmapImageRep(data: png) else { throw RenderFailure.unavailable }
        let scale = CGFloat(bitmap.pixelsWide) / pointWidth
        let step = max(1, Int(scale))
        var minimumX = bitmap.pixelsWide, maximumX = -1
        var minimumY = bitmap.pixelsHigh, maximumY = -1
        for y in stride(from: 0, to: bitmap.pixelsHigh, by: step) {
            for x in stride(from: 0, to: bitmap.pixelsWide, by: step) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                      color.alphaComponent > 0.8,
                      min(color.redComponent, color.greenComponent, color.blueComponent) > 0.97 else { continue }
                minimumX = min(minimumX, x); maximumX = max(maximumX, x)
                minimumY = min(minimumY, y); maximumY = max(maximumY, y)
            }
        }
        guard maximumX >= minimumX && maximumY >= minimumY else { throw RenderFailure.unavailable }
        return CGSize(width: CGFloat(maximumX - minimumX + step) / scale,
            height: CGFloat(maximumY - minimumY + step) / scale)
    }

    @MainActor private static func validateReadablePosture() {
        let values = YoshIdleGesture(kind: .breathe, duration: 0.9, intensity: 1, direction: 1)
            .timeline.value(time: 0.9 * 0.22)
        let rect = CGRect(x: 0, y: 0, width: 244, height: 350)
        let resting = YoshClothShape().path(in: rect).boundingRect
        let active = cloth(for: values).path(in: rect).boundingRect
        // The icon keeps its native aspect ratio inside the unchanged 350pt container.
        precondition(resting.height - active.height >= resting.height * 7 / 350,
            "A breathing posture must visibly gather the vector body relative to its silhouette height")
        let side = YoshClothShape(sideTip: 4.5)
        precondition(side.motionOffset(at: CGPoint(x: 0, y: 190)).height >= 4
            && abs(side.motionOffset(at: CGPoint(x: 95, y: 123)).height) < 0.2,
            "The side cloth tip must visibly follow while its root stays quiet")
    }

    @MainActor private static func validateReducedDrawing() throws {
        for focused in [false, true] {
            let rest = try renderedDrawing(.rest, focused: focused, reduced: true)
            for kind in YoshIdleGesture.Kind.allCases {
                let active = YoshIdleGesture(kind: kind, duration: 0.9, intensity: 1, direction: 1).target
                let reduced = try renderedDrawing(active, focused: focused, reduced: true)
                let difference = try maximumPixelDifference(rest, reduced)
                // Native gradient dithering may vary by one display-channel level.
                precondition(difference <= 2.0 / 255,
                    "Reduce Motion must render the resting vector pose in both eye states")
            }
        }
        let rest = try renderedDrawing(.rest, focused: false, reduced: false)
        let pose = YoshIdleGesture(kind: .breathe, duration: 0.9, intensity: 1, direction: 1)
            .timeline.value(time: 0.9 * 0.22)
        let active = try renderedDrawing(pose, focused: false, reduced: false)
        let restingHeight = try whiteHeight(rest)
        let contraction = restingHeight - (try whiteHeight(active))
        precondition(CGFloat(contraction) >= CGFloat(restingHeight) * 6 / 350,
            "The actual SwiftUI drawing must show a visible posture change at 1x size")
    }

    @MainActor private static func renderedDrawing(_ values: YoshIdleGesture.Values,
                                                  focused: Bool, reduced: Bool,
                                                  protection: CGFloat? = nil) throws -> Data {
        let renderer = ImageRenderer(content:
            YoshSpiritDrawing(protection: protection ?? (focused ? 1 : 0), focused: focused,
                motion: values, reduceMotion: reduced)
                .frame(width: 320, height: 410)
                .background(Color(white: 0.925))
                .environment(\.colorScheme, .light))
        renderer.scale = 1
        guard let image = renderer.cgImage,
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            throw RenderFailure.unavailable
        }
        return png
    }

    private static func maximumPixelDifference(_ first: Data, _ second: Data) throws -> CGFloat {
        guard let a = NSBitmapImageRep(data: first), let b = NSBitmapImageRep(data: second),
              a.pixelsWide == b.pixelsWide, a.pixelsHigh == b.pixelsHigh else {
            throw RenderFailure.unavailable
        }
        var maximum: CGFloat = 0
        for y in 0..<a.pixelsHigh {
            for x in 0..<a.pixelsWide {
                guard let left = a.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB),
                      let right = b.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                maximum = max(maximum, abs(left.redComponent - right.redComponent),
                    abs(left.greenComponent - right.greenComponent), abs(left.blueComponent - right.blueComponent))
            }
        }
        return maximum
    }

    private static func whiteHeight(_ png: Data) throws -> Int {
        guard let bitmap = NSBitmapImageRep(data: png) else { throw RenderFailure.unavailable }
        var rows: [Int] = []
        for y in 0..<bitmap.pixelsHigh {
            for x in 0..<bitmap.pixelsWide {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                if min(color.redComponent, color.greenComponent, color.blueComponent) > 0.97 {
                    rows.append(y)
                    break
                }
            }
        }
        guard let first = rows.first, let last = rows.last else { return 0 }
        return last - first + 1
    }

    private static func cloth(for values: YoshIdleGesture.Values) -> YoshClothShape {
        YoshClothShape(sway: values.clothSway, tailLift: values.clothLift,
            squash: values.squash, hoodLift: values.hoodLift, bodyLean: values.bodyLean, sideTip: values.sideTip)
    }

    @MainActor private static func validateGestureChoreography() {
        for (kind, intensity) in YoshIdleGesture.Kind.allCases.flatMap({ kind in
            [CGFloat(1), YoshIdleGesture.idleIntensity * 1.05].map { (kind, $0) }
        }) {
            let gesture = YoshIdleGesture(kind: kind, duration: 0.7, intensity: intensity, direction: 1)
            let timeline = gesture.timeline
            precondition((0.4...1.2).contains(timeline.duration))
            precondition(timeline.value(time: 0) == .rest && isResting(timeline.value(time: timeline.duration)),
                "Every gesture must start and finish in the approved resting shape")
            for time in stride(from: 0.0, through: timeline.duration, by: 0.02) {
                let value = timeline.value(time: time)
                precondition(abs(value.vertical) < 5.2 && abs(value.horizontal) < 6.3 && abs(value.lean) < 2.6)
                precondition(abs(value.squash) < 0.051 && abs(value.clothLift) < 11.5 && abs(value.clothSway) < 4.6
                    && abs(value.hoodLift) < 14.5 && abs(value.bodyLean) < 10.4 && abs(value.sideTip) < 7.7)
                precondition(value.eyeClosure(focused: true) == 1,
                    "Focus must override every blink keyframe, including interrupted gestures")
            }
        }

        let rise = YoshIdleGesture(kind: .rise, duration: 0.9, intensity: 1, direction: 1).timeline
        precondition(rise.value(time: 0.04).vertical < 0 && rise.value(time: 0.04).clothLift == 0,
            "The cloth must follow after the body's initial gesture")
        precondition(rise.value(time: 0.76).vertical == 0 && rise.value(time: 0.76).clothLift != 0,
            "The cloth must finish after the body settles")

        var random = TestRandom()
        var previous: YoshIdleGesture.Kind?
        var chosen: Set<YoshIdleGesture.Kind> = []
        var pauses: Set<Double> = []
        for _ in 0..<50 {
            let gesture = YoshIdleGesture.choose(after: previous, using: &random)
            precondition(gesture.kind != previous, "Avoid identical consecutive gestures")
            chosen.insert(gesture.kind)
            previous = gesture.kind
            let pause = YoshIdleGesture.pause(using: &random)
            precondition(YoshIdleGesture.Timing.idlePause.contains(pause))
            pauses.insert(pause)
        }
        precondition(chosen.count == YoshIdleGesture.Kind.allCases.count && pauses.count > 10,
            "The schedule must vary gesture kinds and pause durations")
    }

    private static func isResting(_ value: YoshIdleGesture.Values) -> Bool {
        // Native interpolation can leave floating-point residues at a cubic endpoint.
        [value.horizontal, value.vertical, value.lean, value.squash, value.hoodLift,
         value.bodyLean, value.sideTip, value.clothSway, value.clothLift, value.blink, value.glance]
            .allSatisfy { abs($0) < 0.00000001 }
    }

    private struct TestRandom: RandomNumberGenerator {
        var state: UInt64 = 42
        mutating func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1
            return state
        }
    }

    @MainActor private static func pixels(_ host: NSView) throws -> Data {
        // Crop out native PIN editing/caret feedback so only spirit motion can change the frame.
        let spiritArea = CGRect(x: 70, y: 150, width: 280, height: 400)
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: spiritArea) else {
            throw RenderFailure.unavailable
        }
        host.cacheDisplay(in: spiritArea, to: bitmap)
        guard let png = bitmap.representation(using: .png, properties: [:]) else {
            throw RenderFailure.unavailable
        }
        return png
    }

    private enum RenderFailure: Error { case unavailable }

    @MainActor private static func leftEyeWidth(_ png: Data) throws -> Int {
        guard let bitmap = NSBitmapImageRep(data: png) else { throw RenderFailure.unavailable }
        let scale = CGFloat(bitmap.pixelsWide) / 280
        var columns: [Int] = []
        // Include the reference's lower face placement and its full gesture envelope.
        for x in Int(180 * scale)..<Int(222 * scale) {
            for y in Int(100 * scale)..<Int(195 * scale) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                if color.alphaComponent > 0.6 && max(color.redComponent, color.greenComponent, color.blueComponent) < 0.25 {
                    columns.append(x)
                    break
                }
            }
        }
        guard let first = columns.first, let last = columns.last else { return 0 }
        return last - first + 1
    }

    @MainActor private static func settle() {
        RunLoop.current.run(until: .now.addingTimeInterval(0.15))
    }

    @MainActor private static func click(_ window: NSWindow, at point: CGPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
            window.sendEvent(event)
        }
    }

    @MainActor private static func sendKey(_ window: NSWindow, characters: String, keyCode: UInt16) {
        window.sendEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [],
            timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
            context: nil, characters: characters, charactersIgnoringModifiers: characters,
            isARepeat: false, keyCode: keyCode)!)
    }

    @MainActor @Observable final class PINProbe {
        var pin = ""
        var focused = false
    }

    private struct PINFixture: View {
        @Bindable var probe: PINProbe
        @FocusState private var focused: Bool

        var body: some View {
            Color.clear
                .frame(width: CardMetrics.cardSize.width, height: CardMetrics.cardSize.height)
                .overlay {
                    YoshSpiritView(posture: focused ? .protective : .idle)
                        .frame(width: 260, height: 374)
                        .offset(y: 17)
                        .allowsHitTesting(false)
                }
                .overlay(alignment: .bottom) {
                    YoshPINEntry(pin: $probe.pin, isFocused: $focused)
                        .padding(.bottom, 36)
                }
                .onChange(of: focused) { _, value in probe.focused = value }
                .environment(\.scenePhase, .inactive)
        }
    }

    private final class TestWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }
}
