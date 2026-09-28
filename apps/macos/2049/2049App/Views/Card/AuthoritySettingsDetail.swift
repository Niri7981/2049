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
        _dailyLimitInput = State(initialValue: Self.editableLimit(overview.budget.dailyLimit?.value))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Button("Authority", systemImage: "chevron.left", action: onBack)
                .buttonStyle(.plain)
                .disabled(isSaving)

            VStack(alignment: .leading, spacing: 6) {
                Text("Daily Authority")
                    .font(.title2)
                Text(overview.budget.remainingDisplay)
                    .font(.largeTitle)
                    .monospacedDigit()
                Text("remaining today · Solana Devnet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text("Current limit: \(overview.budget.dailyLimitDisplay)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                Text("Daily limit")
                    .font(.headline)
                HStack {
                    TextField("Amount", text: $dailyLimitInput)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityLabel("Daily limit in test USDC")
                        .disabled(isSaving)
                    Text("test USDC")
                        .foregroundStyle(.secondary)
                }
                Text("Enter 0 to stop new purchases. The backend applies the limit to future decisions.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                HStack(spacing: 12) {
                    Button("Save daily limit") { saveLimit() }
                        .disabled(isSaving)
                    if isSaving {
                        ProgressView("Saving")
                            .controlSize(.small)
                    }
                }

                if let inputError {
                    Text(inputError)
                        .font(.subheadline)
                        .foregroundStyle(.red)
                        .accessibilityAddTraits(.updatesFrequently)
                } else if let writeMessage {
                    Text(writeMessage)
                        .font(.subheadline)
                        .foregroundStyle(writeFailed ? Color.red : Color.secondary)
                        .accessibilityAddTraits(.updatesFrequently)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Devnet wallet balance")
                    .font(.headline)
                switch balanceState {
                case .loading:
                    ProgressView("Reading balance")
                        .controlSize(.small)
                case .loaded(let balance):
                    Text(balance.display)
                        .font(.title3)
                        .monospacedDigit()
                    if !balance.available {
                        Button("Retry balance") { Task { await readBalance() } }
                            .buttonStyle(.link)
                    }
                case .failed(let message):
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Retry balance") { Task { await readBalance() } }
                        .buttonStyle(.link)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .task { await readBalance() }
        .onChange(of: overview.budget.dailyLimit?.value) { _, newValue in
            dailyLimitInput = Self.editableLimit(newValue)
            inputError = nil
        }
    }

    private func saveLimit() {
        guard let amount = Self.minorUnits(dailyLimitInput) else {
            inputError = "Enter a nonnegative test USDC amount with up to 6 decimal places."
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

    // Input conversion is only for the editor; the backend validates and owns the limit.
    private static func minorUnits(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$"#, options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        let fraction = parts.count == 2 ? String(parts[1]) : ""
        let raw = String(parts[0]) + fraction.padding(toLength: 6, withPad: "0", startingAt: 0)
        let normalized = String(raw.drop(while: { $0 == "0" }))
        let amount = normalized.isEmpty ? "0" : normalized
        return amount.count <= 15 ? amount : nil
    }

    private static func editableLimit(_ amount: Int64?) -> String {
        guard let amount else { return "" }
        let padded = String(repeating: "0", count: max(0, 7 - String(amount).count)) + String(amount)
        let whole = String(padded.dropLast(6))
        let fractional = String(padded.suffix(6)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        return fractional.isEmpty ? whole : "\(whole).\(fractional)"
    }
}
