import SwiftUI

struct BackOverview: View {
    let overviewClient: OverviewClient
    let memberID: UUID
    let agentName: String
    let section: BackSection
    let onMemberChanged: () async -> Void

    @State private var state: LoadState = .loading
    @State private var writeState: WriteState = .idle
    @State private var selectedDetail: Detail?
    @State private var activityRefreshing = false
    @State private var activityRefreshError: String?
    @State private var isRefreshing = false

    private enum Detail {
        case daily, grant, connection, activity, purchase(String)
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

    private var isActive: Bool {
        section == .connection || section == .authority
    }

    var body: some View {
        ZStack(alignment: .top) {
            if section == .connection {
                if let overview {
                    connectionPage(overview, onBack: nil)
                } else {
                    connectionLoadStatus
                }
            } else if let overview, let selectedDetail {
                switch selectedDetail {
                case .daily:
                    AuthoritySettingsDetail(
                        overview: overview,
                        overviewClient: overviewClient,
                        isSaving: writeState.isSaving || isRefreshing,
                        writeMessage: writeState.message,
                        writeFailed: writeState.isFailure,
                        onBack: { self.selectedDetail = nil },
                        onSave: { limit in await write(.dailyLimit(limit)) }
                    )
                case .grant:
                    SpendGrantDetail(
                        overview: overview,
                        isSaving: writeState.isSaving || isRefreshing,
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
                    connectionPage(overview, onBack: { self.selectedDetail = nil })
                case .activity:
                    ActivityDetail(
                        purchases: overview.purchases,
                        agentName: agentName,
                        isRefreshing: activityRefreshing,
                        refreshError: activityRefreshError,
                        onBack: { self.selectedDetail = nil },
                        onRefresh: { await refreshActivity() },
                        onSelect: { self.selectedDetail = .purchase($0) }
                    )
                case .purchase(let id):
                    if let purchase = overview.purchases.first(where: { $0.purchaseId == id }) {
                        PurchaseDetail(purchase: purchase, agentName: agentName, onBack: { self.selectedDetail = .activity })
                    } else {
                        ActivityDetail(
                            purchases: overview.purchases,
                            agentName: agentName,
                            isRefreshing: activityRefreshing,
                            refreshError: activityRefreshError,
                            onBack: { self.selectedDetail = nil },
                            onRefresh: { await refreshActivity() },
                            onSelect: { self.selectedDetail = .purchase($0) }
                        )
                    }
                }
            } else {
                overviewContent
            }
        }
        .task { if isActive { await reload() } }
        .onChange(of: section) { _, _ in
            selectedDetail = nil
            if isActive {
                Task { await reload(preservingContent: true) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeServiceExited)) { _ in
            selectedDetail = nil
            writeState = .idle
            activityRefreshing = false
            activityRefreshError = nil
            state = .failed(.serviceExited)
        }
    }

    private func connectionPage(_ overview: AppOverview, onBack: (() -> Void)?) -> AgentConnectionDetail {
        AgentConnectionDetail(
            presentation: ConnectionPresentation(connection: overview.connection,
                service: overview.service, agentName: agentName),
            isSaving: writeState.isSaving || isRefreshing,
            writeMessage: writeState.message,
            writeFailed: writeState.isFailure,
            onBack: onBack,
            onSetEnabled: { enabled in await write(.connection(enabled)) }
        )
    }

    private var connectionLoadStatus: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("CONNECTION")
                .font(.system(size: 10, weight: .medium))
                .tracking(2.6)
                .foregroundStyle(.secondary)
            Text("Connection")
                .font(.system(size: 56, weight: .regular, design: .serif))
                .accessibilityAddTraits(.isHeader)
            if case .failed(let error) = state {
                Text(error.message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button("Retry") { Task { await reload(retry: true) } }
                    .buttonStyle(.link)
            } else {
                Text("Loading connection…")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.top, 44)
    }

    private var overviewContent: some View {
        VStack(spacing: 0) {
            dailyAuthority
                .padding(.top, 34)

            grantLimits
                .padding(.top, 18)

            BackControls(
                payments: presentation?.payments ?? "—",
                paymentsEnabled: !isRefreshing && overview?.service.status == .running ? overview.map { !$0.budget.paused } : nil,
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
                onConnection: { open(.connection) },
                activityAvailable: overview != nil && !writeState.isSaving && !isRefreshing,
                onActivity: {
                    open(.activity)
                    Task { await refreshActivity() }
                }
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
        .disabled(overview == nil || writeState.isSaving || isRefreshing)
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
        .disabled(overview == nil || writeState.isSaving || isRefreshing)
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
        guard overview != nil, !writeState.isSaving, !isRefreshing else { return }
        writeState = .idle
        activityRefreshError = nil
        selectedDetail = detail
    }

    @MainActor
    private func refreshActivity() async {
        guard overview != nil, !activityRefreshing else { return }
        activityRefreshing = true
        defer { activityRefreshing = false }
        activityRefreshError = nil
        do {
            let refreshed = try await loadSelectedOverview()
            guard case .some(.activity) = selectedDetail else { return }
            state = .loaded(refreshed)
        } catch is CancellationError {
            return
        } catch {
            guard case .some(.activity) = selectedDetail else { return }
            activityRefreshError = (error as? OverviewLoadError)?.message ?? "Activity could not be refreshed"
        }
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
                if isRefreshing {
                    ProgressView("Refreshing authority")
                        .controlSize(.small)
                }
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
    private func reload(retry: Bool = false, preservingContent: Bool = false) async {
        guard !isRefreshing, !writeState.isSaving else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        writeState = .idle
        if !preservingContent || overview == nil { state = .loading }
        do {
            let result = try await loadSelectedOverview(retry: retry)
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
        guard overview != nil, !writeState.isSaving, !isRefreshing else { return }
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
                try await overviewClient.createMemberGrant(memberID, totalLimit: total, singleLimit: single, expiresAt: expiration)
                success = "Grant saved. Reconnect the MCP host."
            case .revokeGrant:
                try await overviewClient.revokeMemberGrant(memberID)
                success = "Grant revoked. Reconnect the MCP host."
            case .connection(let enabled):
                try await overviewClient.setMemberConnection(memberID, enabled: enabled)
                success = enabled ? "Connection enabled. Reconnect the MCP host." : "Connection revoked. Active grant revoked."
            }
        } catch {
            let failure = (error as? OverviewLoadError)?.message ?? "Setting change failed"
            // A lost response does not prove the write was rejected; re-read the source of truth.
            do {
                state = .loaded(try await loadSelectedOverview())
                await onMemberChanged()
            } catch {
                selectedDetail = nil
                state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
            }
            writeState = .failure(failure)
            return
        }

        do {
            state = .loaded(try await loadSelectedOverview())
            await onMemberChanged()
            writeState = .success(success)
        } catch {
            selectedDetail = nil
            state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
            writeState = .failure("Saved, but current status could not be loaded")
        }
    }

    private func loadSelectedOverview(retry: Bool = false) async throws -> AppOverview {
        do {
            async let shared = overviewClient.load(retry: retry)
            async let member = overviewClient.loadMember(memberID, retry: retry)
            let (sharedOverview, snapshot) = try await (shared, member)
            guard snapshot.member.status == .active else {
                await onMemberChanged()
                throw OverviewLoadError.memberInactive
            }
            return AppOverview(shared: sharedOverview, member: snapshot)
        } catch OverviewLoadError.memberNotFound {
            await onMemberChanged()
            throw OverviewLoadError.memberNotFound
        }
    }
}
