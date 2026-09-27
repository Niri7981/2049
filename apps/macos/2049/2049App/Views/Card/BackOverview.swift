import SwiftUI

struct BackOverview: View {
    let overviewClient: OverviewClient

    @State private var state: LoadState = .loading

    private enum LoadState {
        case loading
        case loaded(AuthorityOverviewPresentation)
        case failed(OverviewLoadError)
    }

    private var overview: AuthorityOverviewPresentation? {
        if case .loaded(let overview) = state { return overview }
        return nil
    }

    var body: some View {
        VStack(spacing: 0) {
            dailyAuthority
                .padding(.top, 34)

            grantLimits
                .padding(.top, 18)

            BackControls(payments: overview?.payments ?? "—", execution: overview?.execution ?? "—")
                .padding(.top, 9)

            BackLatestPurchase(
                title: overview?.latest?.title ?? (overview == nil ? "—" : "No activity yet"),
                detail: overview?.latest?.detail ?? "",
                amount: overview?.latest?.amount ?? "—"
            )
                .padding(.top, 16)

            Spacer(minLength: 0)

            loadStatus
                .frame(height: 28)
        }
        .padding(.horizontal, 26)
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .nativeServiceExited)) { _ in
            state = .failed(.serviceExited)
        }
    }

    private var dailyAuthority: some View {
        VStack(spacing: 0) {
            Text(overview?.remaining ?? "—")
                .font(.system(size: 56, weight: .regular))
                .tracking(-1.5)
                .monospacedDigit()
                .frame(height: 66)

            Text("remaining today")
                .font(.system(size: 17))
                .foregroundStyle(.secondary)
                .frame(height: 22)

            ProgressView(value: overview?.progress ?? 0, total: 1)
                .progressViewStyle(.linear)
                .tint(Color(nsColor: .darkGray))
                .frame(width: 298)
                .padding(.top, 14)
                .accessibilityLabel("Daily authority remaining")

            Text(overview?.dailyLimit ?? "of — daily")
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .padding(.top, 10)
        }
        .frame(maxWidth: .infinity)
    }

    private var grantLimits: some View {
        HStack(spacing: 0) {
            limit(label: "Grant", amount: overview?.grantRemaining ?? "—", detail: "remaining")

            Rectangle()
                .fill(Color.primary.opacity(0.09))
                .frame(width: 1, height: 54)

            limit(label: "Per transaction", amount: overview?.perTransaction ?? "—", detail: "max")
                .padding(.leading, 20)
        }
        .padding(.horizontal, 20)
        .frame(height: 94)
        .background(Color.white.opacity(0.38), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.07), lineWidth: 1)
        }
    }

    private func limit(label: String, amount: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
            Text(amount)
                .font(.system(size: 25, weight: .regular))
                .monospacedDigit()
            Text(detail)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var loadStatus: some View {
        switch state {
        case .loading:
            ProgressView("Loading authority")
                .controlSize(.small)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        case .loaded:
            EmptyView()
        case .failed(let error):
            HStack(spacing: 8) {
                Text(error.message)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                Button("Retry") { Task { await reload(retry: true) } }
                    .buttonStyle(.link)
                    .font(.system(size: 12))
            }
        }
    }

    @MainActor
    private func reload(retry: Bool = false) async {
        state = .loading
        do {
            let result = try await overviewClient.load(retry: retry)
            guard !Task.isCancelled else { return }
            state = .loaded(AuthorityOverviewPresentation(result))
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
        }
    }
}

private extension OverviewLoadError {
    var message: String {
        switch self {
        case .configuration: "Local service setup unavailable"
        case .unavailable: "Local service unavailable"
        case .unauthorized: "Management access denied"
        case .invalidResponse: "Authority data unavailable"
        case .portConflict: "Local service port in use"
        case .startupFailed: "Local service could not start"
        case .readinessTimedOut: "Local service did not become ready"
        case .serviceExited: "Local service stopped"
        case .dataDirectoryInUse: "2049 data is open in another service"
        }
    }
}
