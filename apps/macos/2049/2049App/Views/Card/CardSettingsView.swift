import SwiftUI

struct CardSettingsView: View {
    let overviewClient: OverviewClient

    @State private var state: LoadState = .loading

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

    private var unavailableValue: String { isLoading ? "Checking…" : "Unavailable" }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text("Settings")
                    .font(.title2)
                Spacer()
                Button("Refresh status", systemImage: "arrow.clockwise") {
                    Task { await reload() }
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.plain)
                .disabled(isLoading)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("APP")
                        fact("Version", appVersion)
                        fact("Local service", information?.serviceStatus ?? unavailableValue)
                        if isLoading {
                            ProgressView("Checking local service")
                                .controlSize(.small)
                        } else if case .failed(let message) = state {
                            Text(message)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Button("Retry local service") { Task { await reload(retry: true) } }
                        }
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("RUNTIME")
                        fact("Execution", information?.executionMode ?? unavailableValue)
                        fact("Network", information?.network ?? unavailableValue)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("WALLET")
                        Text("Public address")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if let address = information?.walletAddress {
                            Text(address)
                                .font(.system(size: 12, design: .monospaced))
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        } else {
                            Text(unavailableValue)
                                .font(.system(size: 12, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                        Text("2049 keeps the private key in macOS Keychain. The local service handles signing.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        sectionTitle("DATA")
                        Text("Card settings and purchase records are stored locally. The service listens on this Mac only.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .nativeServiceExited)) { _ in
            state = .failed(OverviewLoadError.serviceExited.message)
        }
    }

    private var isLoading: Bool {
        if case .loading = state { return true }
        return false
    }

    private func sectionTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(.secondary)
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
    }

    @MainActor
    private func reload(retry: Bool = false) async {
        state = .loading
        do {
            let overview = try await overviewClient.load(retry: retry)
            guard !Task.isCancelled else { return }
            state = .loaded(CardSettingsPresentation(overview))
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed((error as? OverviewLoadError)?.message ?? "App information unavailable")
        }
    }
}
