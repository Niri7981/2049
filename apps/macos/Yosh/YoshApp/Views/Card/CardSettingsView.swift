import AppKit
import SwiftUI

struct CardSettingsView: View {
    let overviewClient: OverviewClient
    var isActive = true

    @Environment(YoshAppLock.self) private var appLock: YoshAppLock?

    @State private var state: LoadState = .loading
    @State private var actionError: String?
    @State private var loadRevision = 0

    private enum LoadState {
        case loading
        case loaded(CardSettingsPresentation)
        case failed(String)
    }

    private var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "Unavailable"
    }

    private var information: CardSettingsPresentation? {
        if case .loaded(let value) = state { return value }
        return nil
    }

    private var error: String? {
        if case .failed(let message) = state { return message }
        return actionError
    }

    private var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }

    var body: some View {
        CardSettingsBody(information: information, appVersion: appVersion, isLoading: isLoading, error: error,
            onCopyWallet: copyWallet, onOpenDataFolder: openDataFolder, onOpenRepository: openRepository,
            onReload: { Task { await reload(retry: true) } }, appLock: appLock)
            .task(id: isActive) { if isActive { await reload() } }
            .onReceive(NotificationCenter.default.publisher(for: .nativeServiceExited)) { _ in
                loadRevision += 1
                state = .failed(OverviewLoadError.serviceExited.message)
            }
    }

    private func copyWallet(_ address: String) {
        NSPasteboard.general.clearContents()
        if NSPasteboard.general.setString(address, forType: .string) {
            actionError = nil
        } else {
            actionError = "The wallet address could not be copied."
        }
    }

    private func openDataFolder(_ directory: URL) {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue,
              NSWorkspace.shared.open(directory) else {
            actionError = "The data folder could not be opened."
            return
        }
        actionError = nil
    }

    private func openRepository() {
        actionError = NSWorkspace.shared.open(CardSettingsPresentation.repositoryURL)
            ? nil : "GitHub could not be opened."
    }

    @MainActor
    private func reload(retry: Bool = false) async {
        loadRevision += 1
        let revision = loadRevision
        state = .loading
        actionError = nil
        do {
            let overview = try await overviewClient.load(retry: retry)
            // Reuse the secured management transport and the backend's resolved directory.
            // Health data stays local; only the storage URL reaches the Settings body.
            var directory: URL?
            if let configuration = try? await overviewClient.runtime.ready(),
               let (data, response) = try? await configuration.request(.health), response.statusCode == 200 {
                directory = CardSettingsPresentation.dataDirectory(from: data)
            }
            guard !Task.isCancelled, revision == loadRevision else { return }
            state = .loaded(CardSettingsPresentation(overview, dataDirectory: directory))
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, revision == loadRevision else { return }
            state = .failed((error as? OverviewLoadError)?.message ?? "App information unavailable")
        }
    }
}
