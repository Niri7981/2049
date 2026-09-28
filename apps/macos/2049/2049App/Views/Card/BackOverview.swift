import SwiftUI

struct BackOverview: View {
    let overviewClient: OverviewClient

    @State private var state: LoadState = .loading
    @State private var writeState: WriteState = .idle
    @State private var selectedDetail: Detail?

    private enum Detail {
        case daily, grant, connection
    }

    private enum LoadState {
        case loading
        case loaded(AppOverview)
        case failed(OverviewLoadError)
    }

    private enum SettingsChange {
        case paused(Bool)
        case dailyLimit(String)
        case createGrant(totalLimit: String, singleLimit: String, expiresAt: Int64)
        case revokeGrant
        case connection(Bool)
    }

    private enum WriteState {
        case idle
        case saving
        case success(String)
        case failure(String)

        var isSaving: Bool {
            if case .saving = self { return true }
            return false
        }

        var message: String? {
            switch self {
            case .success(let message), .failure(let message): message
            case .idle, .saving: nil
            }
        }

        var isFailure: Bool {
            if case .failure = self { return true }
            return false
        }
    }

    private var overview: AppOverview? {
        if case .loaded(let overview) = state { return overview }
        return nil
    }

    private var presentation: AuthorityOverviewPresentation? {
        overview.map { AuthorityOverviewPresentation($0) }
    }

    var body: some View {
        ZStack(alignment: .top) {
            if let overview, let selectedDetail {
                switch selectedDetail {
                case .daily:
                    AuthoritySettingsDetail(
                        overview: overview,
                        overviewClient: overviewClient,
                        isSaving: writeState.isSaving,
                        writeMessage: writeState.message,
                        writeFailed: writeState.isFailure,
                        onBack: { self.selectedDetail = nil },
                        onSave: { limit in await write(.dailyLimit(limit)) }
                    )
                case .grant:
                    SpendGrantDetail(
                        overview: overview,
                        isSaving: writeState.isSaving,
                        writeMessage: writeState.message,
                        writeFailed: writeState.isFailure,
                        onBack: { self.selectedDetail = nil },
                        onConnection: { open(.connection) },
                        onCreate: { total, single, expiration in
                            await write(.createGrant(totalLimit: total, singleLimit: single, expiresAt: expiration))
                        },
                        onRevoke: { await write(.revokeGrant) }
                    )
                case .connection:
                    AgentConnectionDetail(
                        connection: overview.connection,
                        isSaving: writeState.isSaving,
                        writeMessage: writeState.message,
                        writeFailed: writeState.isFailure,
                        onBack: { self.selectedDetail = nil },
                        onSetEnabled: { enabled in await write(.connection(enabled)) }
                    )
                }
            } else {
                overviewContent
            }
        }
        .task { await reload() }
        .onReceive(NotificationCenter.default.publisher(for: .nativeServiceExited)) { _ in
            selectedDetail = nil
            writeState = .idle
            state = .failed(.serviceExited)
        }
    }

    private var overviewContent: some View {
        VStack(spacing: 0) {
            dailyAuthority
                .padding(.top, 34)

            grantLimits
                .padding(.top, 18)

            BackControls(
                payments: presentation?.payments ?? "—",
                paymentsEnabled: overview?.service.status == .running ? overview.map { !$0.budget.paused } : nil,
                paymentsUpdating: writeState.isSaving,
                onPaymentsChange: { enabled in Task { await write(.paused(!enabled)) } },
                execution: presentation?.execution ?? "—"
            )
            .padding(.top, 9)

            BackLatestPurchase(
                title: presentation?.latest?.title ?? (presentation == nil ? "—" : "No activity yet"),
                detail: presentation?.latest?.detail ?? "",
                amount: presentation?.latest?.amount ?? "—",
                connectionEnabled: overview?.connection.enabled,
                onConnection: { open(.connection) }
            )
            .padding(.top, 16)

            Spacer(minLength: 0)

            loadStatus
                .frame(minHeight: 28)
        }
        .padding(.horizontal, 26)
    }

    private var dailyAuthority: some View {
        Button {
            open(.daily)
        } label: {
            VStack(spacing: 0) {
                Text(presentation?.remaining ?? "—")
                    .font(.system(size: 56, weight: .regular))
                    .tracking(-1.5)
                    .monospacedDigit()
                    .frame(height: 66)

                Text("remaining today")
                    .font(.system(size: 17))
                    .foregroundStyle(.secondary)
                    .frame(height: 22)

                ProgressView(value: presentation?.progress ?? 0, total: 1)
                    .progressViewStyle(.linear)
                    .tint(Color(nsColor: .darkGray))
                    .frame(width: 298)
                    .padding(.top, 14)
                    .accessibilityLabel("Daily authority remaining")

                HStack(spacing: 6) {
                    Text(presentation?.dailyLimit ?? "of — daily")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                        .accessibilityHidden(true)
                }
                .font(.system(size: 15))
                .foregroundStyle(.secondary)
                .padding(.top, 10)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
        .disabled(overview == nil || writeState.isSaving)
        .accessibilityLabel("Daily Authority, \(presentation?.remaining ?? "unavailable") remaining. Change daily limit")
    }

    private var grantLimits: some View {
        Button {
            open(.grant)
        } label: {
            HStack(spacing: 0) {
                limit(label: "Grant", amount: presentation?.grantRemaining ?? "—", detail: presentation?.grantDetail ?? "unavailable")

                Rectangle()
                    .fill(Color.primary.opacity(0.09))
                    .frame(width: 1, height: 54)

                limit(label: "Per transaction", amount: presentation?.perTransaction ?? "—", detail: "max")
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
        .buttonStyle(.plain)
        .disabled(overview == nil || writeState.isSaving)
        .accessibilityLabel("Spend grant, \(presentation?.grantRemaining ?? "unavailable") remaining; per transaction \(presentation?.perTransaction ?? "unavailable"). Manage grant")
    }

    private func limit(label: String, amount: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            HStack(spacing: 4) {
                Text(label)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .medium))
                    .accessibilityHidden(true)
            }
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

    private func open(_ detail: Detail) {
        guard overview != nil, !writeState.isSaving else { return }
        writeState = .idle
        selectedDetail = detail
    }

    @ViewBuilder
    private var loadStatus: some View {
        switch writeState {
        case .saving:
            ProgressView("Saving settings")
                .controlSize(.small)
        case .success(let message):
            Text(message)
                .foregroundStyle(.secondary)
        case .failure(let message):
            HStack(spacing: 8) {
                Text(message)
                if case .failed = state {
                    Button("Retry") { Task { await reload(retry: true) } }
                        .buttonStyle(.link)
                }
            }
            .foregroundStyle(.red)
        case .idle:
            switch state {
            case .loading:
                ProgressView("Loading authority")
                    .controlSize(.small)
            case .loaded:
                EmptyView()
            case .failed(let error):
                HStack(spacing: 8) {
                    Text(error.message)
                    Button("Retry") { Task { await reload(retry: true) } }
                        .buttonStyle(.link)
                }
                .foregroundStyle(.secondary)
            }
        }
    }

    @MainActor
    private func reload(retry: Bool = false) async {
        writeState = .idle
        state = .loading
        do {
            let result = try await overviewClient.load(retry: retry)
            guard !Task.isCancelled else { return }
            state = .loaded(result)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
        }
    }

    @MainActor
    private func write(_ change: SettingsChange) async {
        guard overview != nil, !writeState.isSaving else { return }
        writeState = .saving
        let success: String
        do {
            switch change {
            case .paused(let paused):
                try await overviewClient.setPaused(paused)
                success = paused ? "Payments paused" : "Payments resumed"
            case .dailyLimit(let limit):
                try await overviewClient.setDailyLimit(limit)
                success = "Daily limit saved"
            case .createGrant(let total, let single, let expiration):
                try await overviewClient.createGrant(totalLimit: total, singleLimit: single, expiresAt: expiration)
                success = "Grant saved. Reconnect the MCP host."
            case .revokeGrant:
                try await overviewClient.revokeGrant()
                success = "Grant revoked. Reconnect the MCP host."
            case .connection(let enabled):
                try await overviewClient.setConnection(enabled)
                success = enabled ? "Connection enabled. Reconnect the MCP host." : "Connection revoked. Active grant revoked."
            }
        } catch {
            let failure = (error as? OverviewLoadError)?.message ?? "Setting change failed"
            // A lost response does not prove the write was rejected; re-read the source of truth.
            do {
                state = .loaded(try await overviewClient.load())
            } catch {
                selectedDetail = nil
                state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
            }
            writeState = .failure(failure)
            return
        }

        do {
            state = .loaded(try await overviewClient.load())
            writeState = .success(success)
        } catch {
            selectedDetail = nil
            state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
            writeState = .failure("Saved, but current status could not be loaded")
        }
    }
}
