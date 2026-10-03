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
    @State private var connectionFailure: ConnectionFailure?

    private struct ConnectionFailure {
        let enabled: Bool
        let message: String
    }

    private enum Detail {
        case daily, grant, connection, activity
        case purchase(String, from: PurchaseOrigin)
    }

    private enum PurchaseOrigin: Equatable {
        case authority, activity
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
                        onSelect: { self.selectedDetail = .purchase($0, from: .activity) }
                    )
                case .purchase(let id, let origin):
                    if let purchase = overview.purchases.first(where: { $0.purchaseId == id }) {
                        PurchaseDetail(purchase: purchase, agentName: agentName,
                            backTitle: origin == .activity ? "Activity" : "Authority",
                            onBack: { self.selectedDetail = origin == .activity ? .activity : nil })
                    } else {
                        ActivityDetail(
                            purchases: overview.purchases,
                            agentName: agentName,
                            isRefreshing: activityRefreshing,
                            refreshError: activityRefreshError,
                            onBack: { self.selectedDetail = nil },
                            onRefresh: { await refreshActivity() },
                            onSelect: { self.selectedDetail = .purchase($0, from: .activity) }
                        )
                    }
                }
            } else {
                overviewContent
            }
        }
        .task { if isActive { await reload() } }
        .task(id: section) {
            guard section == .connection else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                await refreshConnection()
            }
        }
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
                service: overview.service, agentName: agentName, issueMessage: connectionFailure?.message),
            isSaving: writeState.isSaving || isRefreshing,
            writeMessage: connectionFailure?.message,
            writeFailed: connectionFailure != nil,
            onBack: onBack,
            onSetEnabled: { enabled in await write(.connection(enabled)) },
            onRetry: {
                if let connectionFailure {
                    await write(.connection(connectionFailure.enabled))
                } else {
                    await reload(retry: true)
                }
            },
            retryTitle: connectionFailure.map { $0.enabled ? "Retry setup" : "Retry disconnect" } ?? "Retry"
        )
    }

    private var connectionLoadStatus: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardPageHeader(title: overviewLoadFailed ? "Connection Issue" : "Connection",
                style: .hero(eyebrow: "CONNECTION"))
            if case .failed(let error) = state {
                Text(error.connectionMessage)
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
        .padding(.horizontal, CardPageHeader.Layout.contentInset)
        .padding(.top, CardPageHeader.Layout.topSpacing)
    }

    private var overviewLoadFailed: Bool {
        if case .failed(.memberInactive) = state { return false }
        if case .failed(.memberNotFound) = state { return false }
        if case .failed = state { return true }
        return false
    }

    private var overviewContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            dailyAuthority
                .padding(.top, CardPageHeader.Layout.topSpacing)

            grantLimits
                .padding(.top, CardPageHeader.Layout.firstSectionSpacing)

            BackControls(
                payments: presentation?.payments ?? "—",
                paymentsEnabled: !isRefreshing && overview?.service.status == .running ? overview.map { !$0.budget.paused } : nil,
                paymentsUpdating: writeState.isSaving,
                onPaymentsChange: { enabled in Task { await write(.paused(!enabled)) } },
                execution: presentation?.execution ?? "—"
            )
            .padding(.top, 18)

            BackLatestPurchase(
                latest: presentation?.latest,
                agentName: agentName,
                isLoading: presentation == nil,
                activityAvailable: overview != nil && !writeState.isSaving && !isRefreshing,
                onActivity: {
                    open(.activity)
                    Task { await refreshActivity() }
                },
                onPurchase: { id in open(.purchase(id, from: .authority)) }
            )
            .padding(.top, 13)

            Spacer(minLength: 0)

            loadStatus
                .font(.system(size: 12))
                .frame(minHeight: 28)
        }
        .padding(.horizontal, CardPageHeader.Layout.contentInset)
    }

    private var dailyAuthority: some View {
        Button {
            open(.daily)
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                CardPageHeader(title: presentation?.remaining ?? "—",
                    style: .hero(eyebrow: "REMAINING TODAY", isAmount: true))

                authorityLine
                    .padding(.top, 10)

                HStack(spacing: 6) {
                    Text(presentation?.dailyLimit ?? "of — daily")
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .medium))
                        .accessibilityHidden(true)
                }
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(overview == nil || writeState.isSaving || isRefreshing)
        .accessibilityLabel("Shared daily Authority, \(presentation?.remaining ?? "unavailable") remaining. \(presentation?.dailyLimit ?? "Daily limit unavailable"). Change daily limit")
        .accessibilityHint("Shared by all agents. Remaining excludes paid and reserved amounts.")
    }

    private var authorityLine: some View {
        // This is a budget boundary, not a slider or payment-progress control.
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.35))
                    .frame(height: 1.5)

                if let presentation, overview?.budget.remaining != nil {
                    let endpoint = max(0, geometry.size.width - 6) * presentation.progress
                    Rectangle()
                        .fill(Color(red: 0.48, green: 0.64, blue: 0.88).opacity(0.7))
                        .frame(width: endpoint + 3, height: 1.5)
                    Circle()
                        .fill(Color(red: 0.48, green: 0.64, blue: 0.88))
                        .frame(width: 6, height: 6)
                        .offset(x: endpoint)
                }
            }
            .frame(height: 6)
        }
        .frame(height: 6)
        .accessibilityHidden(true)
    }

    private var grantLimits: some View {
        Button {
            open(.grant)
        } label: {
            HStack(spacing: 0) {
                limit(label: "GRANT", amount: presentation?.grantRemaining ?? "—", detail: presentation?.grantDetail ?? "unavailable")

                Rectangle()
                    .fill(Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5))
                    .frame(width: 1, height: 60)

                limit(label: "PER TRANSACTION", amount: presentation?.perTransaction ?? "—", detail: "max")
                    .padding(.leading, 18)
            }
            .frame(height: 64)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(overview == nil || writeState.isSaving || isRefreshing)
        .accessibilityLabel("\(agentName) spend grant, \(presentation?.grantRemaining ?? "unavailable") remaining, \(presentation?.grantDetail ?? "unavailable"); per transaction \(presentation?.perTransaction ?? "unavailable"). Manage grant")
    }

    private func limit(label: String, amount: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(label)
                    .tracking(1.8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 9, weight: .medium))
                    .accessibilityHidden(true)
            }
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.secondary)
            Text(amount)
                .font(.system(size: 26, weight: .regular))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .padding(.top, 8)
            Text(detail)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.top, 2)
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
    private func refreshConnection() async {
        guard section == .connection, !writeState.isSaving, !isRefreshing, let current = overview else { return }
        do {
            let member = try await overviewClient.loadMember(memberID)
            guard !Task.isCancelled, section == .connection, !writeState.isSaving, !isRefreshing else { return }
            state = .loaded(AppOverview(shared: current, member: member))
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, section == .connection, !writeState.isSaving, !isRefreshing else { return }
            state = .failed((error as? OverviewLoadError) ?? .invalidResponse)
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
        if case .connection = change { connectionFailure = nil }
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
                success = enabled ? "Access is ready." : "Disconnected. Current spending authorization revoked."
            }
        } catch {
            let failure: String
            if case .connection(let enabled) = change {
                failure = (error as? OverviewLoadError)?.connectionMessage ?? "2049 couldn't confirm the change. Try again."
                connectionFailure = ConnectionFailure(enabled: enabled, message: failure)
            } else {
                failure = (error as? OverviewLoadError)?.message ?? "Setting change failed"
            }
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
