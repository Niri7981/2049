import SwiftUI

struct AuthoritySettingsDetail: View {
    let overview: AppOverview
    let overviewClient: OverviewClient
    let isSaving: Bool
    let writeMessage: String?
    let writeFailed: Bool
    let onBack: () -> Void
    let onSave: (String) async -> Void

    @State private var dailyLimitInput: String
    @State private var inputError: String?
    @State private var balanceState: BalanceState = .loading

    private enum BalanceState {
        case loading
        case loaded(AppBalance)
        case failed(String)
    }

    init(
        overview: AppOverview,
        overviewClient: OverviewClient,
        isSaving: Bool,
        writeMessage: String?,
        writeFailed: Bool,
        onBack: @escaping () -> Void,
        onSave: @escaping (String) async -> Void
    ) {
        self.overview = overview
        self.overviewClient = overviewClient
        self.isSaving = isSaving
        self.writeMessage = writeMessage
        self.writeFailed = writeFailed
        self.onBack = onBack
        self.onSave = onSave
        _dailyLimitInput = State(initialValue: DailyAuthorityPresentation.editableLimit(overview.budget.dailyLimit?.value))
    }

    private var presentation: DailyAuthorityPresentation {
        DailyAuthorityPresentation(network: overview.service.network)
    }

    private var balanceDisplay: String? {
        if case .loaded(let balance) = balanceState { return presentation.balanceDisplay(balance) }
        return nil
    }

    private var balanceIsLoading: Bool {
        if case .loading = balanceState { return true }
        return false
    }

    private var balanceMessage: String? {
        switch balanceState {
        case .failed(let message): message
        case .loaded(let balance):
            balance.available ? (balanceDisplay == nil ? "Wallet balance currency unavailable" : nil) : balance.display
        case .loading: nil
        }
    }

    private var canRetryBalance: Bool {
        !balanceIsLoading && balanceDisplay == nil
    }

    var body: some View {
        DailyAuthorityContent(currency: presentation.currency, dailyLimitInput: $dailyLimitInput,
            isSaving: isSaving, message: inputError ?? writeMessage,
            messageFailed: inputError != nil || writeFailed, balanceDisplay: balanceDisplay,
            balanceIsLoading: balanceIsLoading, balanceMessage: balanceMessage, canRetryBalance: canRetryBalance,
            onBack: onBack, onSave: saveLimit, onRetryBalance: { Task { await readBalance() } })
            .task(id: overview.service.network) { await readBalance() }
            .onChange(of: overview.budget.dailyLimit?.value) { _, newValue in
                dailyLimitInput = DailyAuthorityPresentation.editableLimit(newValue)
                inputError = nil
            }
    }

    private func saveLimit() {
        guard !isSaving, let currency = presentation.currency else { return }
        guard let amount = DailyAuthorityPresentation.minorUnits(dailyLimitInput) else {
            inputError = "Enter a nonnegative \(currency) amount with up to 6 decimal places."
            return
        }
        inputError = nil
        Task { await onSave(amount) }
    }

    @MainActor
    private func readBalance() async {
        balanceState = .loading
        do {
            let balance = try await overviewClient.loadBalance()
            guard !Task.isCancelled else { return }
            balanceState = .loaded(balance)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            balanceState = .failed((error as? OverviewLoadError)?.message ?? "Wallet balance unavailable")
        }
    }
}
