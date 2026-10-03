import AppKit
import SwiftUI
import Synchronization

/// Own offscreen native fixtures only; no installed App, real Keychain or backend launch.
@main
struct YoshAppLockViewTest {
    @MainActor
    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        var completed = false
        var failure: Error?
        Task { @MainActor in
            do {
                try await validateFirstSetup()
                try await validateLockedWindowAndSettings()
            } catch {
                failure = error
            }
            completed = true
        }
        while !completed { RunLoop.current.run(until: .now.addingTimeInterval(0.02)) }
        if let failure { throw failure }
        print("Yosh App Lock native views: locked account gate, native PIN editing, inline light Change PIN under darkAqua, fixed window geometry, Cancel and 4/6-digit confirmed changes passed")
    }

    @MainActor
    private static func validateFirstSetup() async throws {
        let store = FixtureStore()
        let model = YoshAppLock(store: store)
        await model.load()
        var flips = 0
        let host = NSHostingView(rootView: AgentCardFront(identity: nil, onFlip: { flips += 1 }, appLock: model)
            .environment(\.scenePhase, .inactive))
        let window = fixtureWindow(host, size: CardMetrics.cardSize)
        defer { window.close() }
        try await waitUntil("First setup must expose the existing native PIN field") {
            secureFields(in: host).count == 1
        }
        click(window, at: CGPoint(x: CardMetrics.cardSize.width - 53, y: CardMetrics.cardSize.height - 67))
        try await pause()
        precondition(flips == 0 && model.state == .locked,
            "The front flip must not expose the back before PIN setup is confirmed")
        try enterPIN("1357", into: secureFields(in: host)[0], window: window)
        try await waitUntil("Setup must ask for a second entry rather than unlocking immediately") {
            model.entryStep == .confirm && !model.isBusy
        }
        precondition(model.state == .locked && !model.pinConfigured)
        let unconfirmedSaves = await store.saveCount()
        precondition(unconfirmedSaves == 0, "The first unconfirmed PIN must not be persisted")
        precondition(secureFields(in: host)[0].stringValue.isEmpty,
            "Moving to confirmation must clear the previous native secure editor")
        try enterPIN("1357", into: secureFields(in: host)[0], window: window)
        try await waitUntil("The matching second entry must complete setup") { model.isUnlocked }
        let confirmedSaves = await store.saveCount()
        precondition(confirmedSaves == 1)
        click(window, at: CGPoint(x: CardMetrics.cardSize.width - 53, y: CardMetrics.cardSize.height - 67))
        try await pause()
        precondition(flips == 1, "The existing flip becomes available after successful setup")
    }

    @MainActor
    private static func validateLockedWindowAndSettings() async throws {
        let credential = try YoshPINVerifier.create(pin: "2468", digitCount: 4)
        let store = FixtureStore(credential: credential)
        let model = YoshAppLock(store: store)
        let backendRequests = Mutex(0)
        // The fake loader throws before real Keychain access, token creation, network or Node launch.
        // Its call count proves native account loading cannot start behind the locked front.
        let runtime = NativeServiceRuntime(allowsLaunch: true,
            environment: ["APP2049_REPOSITORY_ROOT": "/Users/irin/Desktop/2049"],
            managementTokenLoader: {
                backendRequests.withLock { $0 += 1 }
                throw ServiceRuntimeError.unavailable
            })
        let host = NSHostingView(rootView: CardWindow(overviewClient: OverviewClient(runtime: runtime), appLock: model)
            .environment(\.scenePhase, .inactive))
        let window = fixtureWindow(host, size: CardMetrics.windowSize)
        defer { window.close() }
        try await waitUntil("Cold launch must load the PIN and remain locked") {
            model.loadSucceeded && !model.isBusy && secureFields(in: host).count == 1
        }
        precondition(model.state == .locked)
        precondition(backendRequests.withLock { $0 } == 0)
        click(window, at: CGPoint(x: CardMetrics.cardSize.width - 53, y: CardMetrics.cardSize.height - 67))
        try await pause()
        precondition(model.state == .locked)
        precondition(backendRequests.withLock { $0 } == 0,
            "Trying the locked flip must not load native account surfaces")

        try enterPIN("0000", into: secureFields(in: host)[0], window: window)
        try await waitUntil("Incorrect PIN must remain locked with inline feedback") {
            !model.isBusy && model.error != nil
        }
        precondition(model.state == .locked && secureFields(in: host)[0].stringValue.isEmpty,
            "Rejected native PIN editing must clear the digits")
        precondition(backendRequests.withLock { $0 } == 0,
            "An incorrect PIN must not start any native account request")
        try enterPIN("2468", into: secureFields(in: host)[0], window: window)
        try await waitUntil("Correct PIN must unlock the native CardWindow") { model.isUnlocked }
        try await waitUntil("Native account loading may begin only after successful unlock") {
            backendRequests.withLock { $0 } > 0
        }
        try await pause()
        window.orderOut(nil)

        // Match the real SECURITY section's vertical scroll context, without loading backend data.
        let settingsSize = CGSize(width: 368, height: 500)
        let settingsHost = NSHostingView(rootView:
            ScrollView(.vertical) {
                SettingsSection(title: "SECURITY", symbol: "lock") {
                    YoshAppLockSettings(appLock: model)
                }
                .padding(20)
            }
            .frame(width: settingsSize.width, height: settingsSize.height)
            .background(Color(red: 0.95, green: 0.97, blue: 0.985))
            .environment(\.colorScheme, .light))
        let settingsWindow = fixtureWindow(settingsHost, size: settingsSize)
        settingsWindow.appearance = NSAppearance(named: .darkAqua)
        defer { settingsWindow.close() }
        try await pause()
        try press("yosh.lock.enabled", in: settingsHost, window: settingsWindow)
        try await waitUntil("The native switch must disable the persisted App Lock") { !model.enabled && !model.isBusy }
        precondition(model.isUnlocked, "Disabling the lock must preserve the current session")
        let disabledRecord = await store.current()
        precondition(disabledRecord?.enabled == false)
        try press("yosh.lock.enabled", in: settingsHost, window: settingsWindow)
        try await waitUntil("The native switch must re-enable the configured lock") { model.enabled && !model.isBusy }

        let initialFrame = settingsWindow.frame
        let initialWindows = Set(NSApplication.shared.windows.map(ObjectIdentifier.init))
        let initialSaves = await store.saveCount()
        try press("yosh.lock.change", in: settingsHost, window: settingsWindow)
        try await waitUntil("Change PIN must reveal its secure editor") {
            settingsWindow.attachedSheet != nil || secureFields(in: settingsHost).count == 2
        }
        precondition(settingsWindow.attachedSheet == nil,
            "Change PIN must expand inside SECURITY, not create the dark native sheet")
        precondition(Set(NSApplication.shared.windows.map(ObjectIdentifier.init)) == initialWindows,
            "Opening the editor must not create another window or modal surface")
        precondition(settingsWindow.frame == initialFrame && settingsHost.frame.size == settingsSize,
            "Inline editing must preserve the Settings card and window geometry")
        let entries = secureFields(in: settingsHost)
        precondition(entries.count == 2 && entries.allSatisfy { $0.window === settingsWindow },
            "Both secure editors must belong to the original card window")
        for field in entries {
            let frame = field.convert(field.bounds, to: settingsHost)
            precondition(frame.minX >= 0 && frame.maxX <= settingsHost.bounds.maxX,
                "The inline secure inputs must fit the card width")
        }
        try validateLightEditor(settingsHost, entries: entries)
        try enterPIN("9876", into: entries[0], window: settingsWindow)
        try press("yosh.lock.change.cancel", in: settingsHost, window: settingsWindow)
        try await waitUntil("Cancel must fold the editor back into the existing row") {
            secureFields(in: settingsHost).isEmpty
        }
        let savesAfterCancel = await store.saveCount()
        precondition(savesAfterCancel == initialSaves && model.digitCount == 4,
            "Cancel must discard the entered PIN without updating storage")

        try press("yosh.lock.change", in: settingsHost, window: settingsWindow)
        try await waitUntil("The inline editor must reopen with two empty native fields") {
            secureFields(in: settingsHost).count == 2
        }
        precondition(secureFields(in: settingsHost).allSatisfy { $0.stringValue.isEmpty },
            "Reopening after Cancel must not retain plaintext PIN input")
        try await chooseLength(6, in: settingsHost, window: settingsWindow)
        try await chooseLength(4, in: settingsHost, window: settingsWindow)
        let fourDigitEntries = secureFields(in: settingsHost)
        try enterPIN("9876", into: fourDigitEntries[0], window: settingsWindow)
        try enterPIN("9876", into: fourDigitEntries[1], window: settingsWindow)
        try await pause()
        try press("yosh.lock.change.save", in: settingsHost, window: settingsWindow)
        try await waitUntil("Matching four-digit entries must save and fold the editor") {
            secureFields(in: settingsHost).isEmpty && !model.isBusy
        }
        guard let updated = await store.current() else { throw FixtureError.missingCredential }
        let newPINMatches = try YoshPINVerifier.matches(pin: "9876", credential: updated)
        let oldPINMatches = try YoshPINVerifier.matches(pin: "2468", credential: updated)
        precondition(newPINMatches && !oldPINMatches)
        precondition(model.isUnlocked && model.enabled && model.digitCount == 4)

        try press("yosh.lock.change", in: settingsHost, window: settingsWindow)
        try await waitUntil("The next edit must open in the same card") { secureFields(in: settingsHost).count == 2 }
        try await chooseLength(6, in: settingsHost, window: settingsWindow)
        let sixDigitEntries = secureFields(in: settingsHost)
        try enterPIN("987654", into: sixDigitEntries[0], window: settingsWindow)
        try enterPIN("987654", into: sixDigitEntries[1], window: settingsWindow)
        try await pause()
        try press("yosh.lock.change.save", in: settingsHost, window: settingsWindow)
        try await waitUntil("Matching six-digit entries must save and fold the editor") {
            model.digitCount == 6 && secureFields(in: settingsHost).isEmpty && !model.isBusy
        }
        guard let sixDigitRecord = await store.current() else { throw FixtureError.missingCredential }
        let sixDigitPINMatches = try YoshPINVerifier.matches(pin: "987654", credential: sixDigitRecord)
        precondition(sixDigitPINMatches && sixDigitRecord.digitCount == 6 && model.isUnlocked && model.enabled)
        precondition(settingsWindow.frame == initialFrame && settingsWindow.attachedSheet == nil,
            "Saving either PIN length must preserve the original card geometry and session")
    }

    @MainActor
    private static func fixtureWindow(_ host: NSView, size: CGSize) -> NSWindow {
        let window = FixtureWindow(contentRect: CGRect(origin: .zero, size: size),
            styleMask: .borderless, backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.alphaValue = 0
        window.makeKeyAndOrderFront(nil)
        host.layoutSubtreeIfNeeded()
        return window
    }

    @MainActor
    private static func enterPIN(_ pin: String, into field: NSSecureTextField, window: NSWindow) throws {
        let point = field.convert(CGPoint(x: field.bounds.midX, y: field.bounds.midY), to: nil)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1) else { throw FixtureError.missingEditor }
            window.sendEvent(event)
        }
        guard let editor = window.firstResponder as? NSTextView else { throw FixtureError.missingEditor }
        editor.insertText(pin, replacementRange: NSRange(location: NSNotFound, length: 0))
    }

    @MainActor
    private static func secureFields(in view: NSView) -> [NSSecureTextField] {
        if let field = view as? NSSecureTextField { return [field] }
        return view.subviews.flatMap { secureFields(in: $0) }
    }

    @MainActor
    private static func nativeViews(in root: NSView) -> [NSView] {
        [root] + root.subviews.flatMap { nativeViews(in: $0) }
    }

    @MainActor
    private static func press(_ identifier: String, in host: NSView, window: NSWindow) throws {
        if identifier == "yosh.lock.enabled" {
            if let control = nativeViews(in: host).compactMap({ $0 as? NSSwitch }).first {
                click(window, at: control.convert(CGPoint(x: control.bounds.midX, y: control.bounds.midY), to: nil))
            } else {
                click(window, at: CGPoint(x: 330, y: 433))
            }
            return
        }
        if identifier == "yosh.lock.change" {
            // SECURITY starts at 20pt + its 28pt title; the native disclosure follows a 39pt lock row.
            click(window, at: CGPoint(x: 184, y: 394))
            return
        }
        let title = identifier == "yosh.lock.change.cancel" ? "Cancel" : "Change PIN"
        if let button = nativeViews(in: host).compactMap({ $0 as? NSButton }).first(where: { $0.title == title }) {
            button.performClick(nil)
            return
        }
        guard let lastField = secureFields(in: host).last else { throw FixtureError.missingControl(identifier) }
        let lastCenter = lastField.convert(CGPoint(x: lastField.bounds.midX, y: lastField.bounds.midY), to: nil)
        // The compact 40pt capsule ends 20pt below its editor; the 16pt form gap leads to a small button row.
        click(window, at: CGPoint(x: title == "Cancel" ? 54 : 298, y: lastCenter.y - 47))
    }

    @MainActor
    private static func chooseLength(_ count: Int, in host: NSView, window: NSWindow) async throws {
        guard let picker = nativeViews(in: host).compactMap({ $0 as? NSSegmentedControl })
            .first(where: { $0.segmentCount == 2 && $0.label(forSegment: 0) == "4 digits" }) else {
            throw FixtureError.missingControl("PIN length")
        }
        let segment = count == 4 ? 0 : 1
        let point = picker.convert(CGPoint(x: picker.bounds.width * (CGFloat(segment) + 0.5) / 2,
            y: picker.bounds.midY), to: nil)
        click(window, at: point)
        try await pause()
        precondition(picker.selectedSegment == segment, "The native picker must select the requested PIN length")
    }

    @MainActor
    private static func validateLightEditor(_ host: NSView, entries: [NSSecureTextField]) throws {
        guard let bitmap = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw FixtureError.renderUnavailable }
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let directory = URL(filePath: "/Users/irin/Desktop/2049/build.noindex/yosh-pin-ui-fix", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try bitmap.representation(using: .png, properties: [:])?.write(to: directory.appending(path: "settings-expanded.png"))

        let fieldArea = entries.map { $0.convert($0.bounds, to: host) }.reduce(CGRect.null) { $0.union($1) }
            .insetBy(dx: -26, dy: -40).intersection(host.bounds)
        let scale = CGFloat(bitmap.pixelsWide) / host.bounds.width
        let imageArea = host.isFlipped ? fieldArea : CGRect(x: fieldArea.minX,
            y: host.bounds.maxY - fieldArea.maxY, width: fieldArea.width, height: fieldArea.height)
        var lightPixels = 0, darkPixels = 0, sampled = 0
        for y in Int(imageArea.minY * scale)..<Int(imageArea.maxY * scale) {
            for x in Int(imageArea.minX * scale)..<Int(imageArea.maxX * scale) {
                guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
                sampled += 1
                if min(color.redComponent, color.greenComponent, color.blueComponent) > 0.83 { lightPixels += 1 }
                if max(color.redComponent, color.greenComponent, color.blueComponent) < 0.35 { darkPixels += 1 }
            }
        }
        let lightFraction = sampled == 0 ? 0 : Double(lightPixels) / Double(sampled)
        print("PIN editor fixture contrast: lightFraction=\(lightFraction), darkPixels=\(darkPixels), scale=\(scale)")
        precondition(sampled > 0 && lightFraction > 0.8
            && CGFloat(darkPixels) > 40 * scale * scale,
            "The in-card PIN area must keep a light surface and legible dark text under a darkAqua host")
    }

    @MainActor
    private static func click(_ window: NSWindow, at point: CGPoint) {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                context: nil, eventNumber: 1, clickCount: 1, pressure: 1)!
            window.sendEvent(event)
        }
    }

    @MainActor
    private static func waitUntil(_ message: String, timeout: Double = 5,
                                  condition: @MainActor () -> Bool) async throws {
        let deadline = Date.now.addingTimeInterval(timeout)
        while !condition() {
            guard Date.now < deadline else { throw FixtureError.timeout(message) }
            try await pause()
        }
    }

    private static func pause() async throws { try await Task.sleep(for: .milliseconds(20)) }

    private enum FixtureError: Error {
        case missingEditor, missingCredential, renderUnavailable
        case missingControl(String)
        case timeout(String)
    }

    private final class FixtureWindow: NSWindow {
        override var canBecomeKey: Bool { true }
        override var canBecomeMain: Bool { true }
    }

    private actor FixtureStore: YoshAppLockStoring {
        private var credential: YoshAppLockCredential?
        private var saves = 0

        init(credential: YoshAppLockCredential? = nil) { self.credential = credential }
        func load() async throws -> YoshAppLockCredential? { credential }
        func save(_ credential: YoshAppLockCredential) async throws {
            self.credential = credential
            saves += 1
        }
        func saveCount() -> Int { saves }
        func current() -> YoshAppLockCredential? { credential }
    }
}
