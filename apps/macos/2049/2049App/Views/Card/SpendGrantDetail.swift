import SwiftUI

struct SpendGrantDetail: View {
    let overview: AppOverview
    let isSaving: Bool
    let writeMessage: String?
    let writeFailed: Bool
    let onBack: () -> Void
    let onConnection: () -> Void
    let onCreate: (String, String, Int64) async -> Void
    let onRevoke: () async -> Void

    @State private var totalInput: String
    @State private var singleInput: String
    @State private var expiration: Date
    @State private var inputError: String?
    @State private var showingRevokeConfirmation = false

    init(
        overview: AppOverview,
        isSaving: Bool,
        writeMessage: String?,
        writeFailed: Bool,
        onBack: @escaping () -> Void,
        onConnection: @escaping () -> Void,
        onCreate: @escaping (String, String, Int64) async -> Void,
        onRevoke: @escaping () async -> Void
    ) {
        self.overview = overview
        self.isSaving = isSaving
        self.writeMessage = writeMessage
        self.writeFailed = writeFailed
        self.onBack = onBack
        self.onConnection = onConnection
        self.onCreate = onCreate
        self.onRevoke = onRevoke
        _totalInput = State(initialValue: Self.editable(overview.grant?.totalLimit.value))
        _singleInput = State(initialValue: Self.editable(overview.grant?.singleLimit.value))
        let savedExpiration = overview.grant.map { Date(timeIntervalSince1970: TimeInterval($0.expiresAt) / 1_000) }
        _expiration = State(initialValue: savedExpiration.flatMap { $0 > .now ? $0 : nil } ?? .now.addingTimeInterval(8 * 60 * 60))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Button("Authority", systemImage: "chevron.left", action: onBack)
                    .buttonStyle(.plain)
                    .disabled(isSaving)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Spend Grant")
                        .font(.title2)
                    Text(status)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("One grant for the current Agent · Devnet test USDC")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                if let grant = overview.grant {
                    VStack(alignment: .leading, spacing: 7) {
                        fact("Total authorized", amount(grant.totalLimit, decimals: grant.assetDecimals))
                        fact(grant.status == .active ? "Remaining" : "Unspent, unavailable", amount(grant.remaining, decimals: grant.assetDecimals))
                        fact("Per transaction", amount(grant.singleLimit, decimals: grant.assetDecimals))
                        fact("Expires", Date(timeIntervalSince1970: TimeInterval(grant.expiresAt) / 1_000).formatted(date: .abbreviated, time: .shortened))
                    }
                } else {
                    Text("No grant has been created.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                Divider()

                VStack(alignment: .leading, spacing: 9) {
                    Text(overview.grant?.status == .active ? "Replace grant" : "Create grant")
                        .font(.headline)
                    amountField("Total authorized", text: $totalInput)
                    amountField("Per transaction", text: $singleInput)
                    DatePicker("Expires", selection: $expiration, displayedComponents: [.date, .hourAndMinute])
                        .disabled(isSaving)
                    Text("Per-transaction amount must fit within the total. Expiry must be more than 1 minute and at most 7 days away.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text("Saving a grant rotates the Agent credential. Reconnect the MCP host afterward.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if !overview.connection.enabled {
                        Button("Enable Agent connection first", action: onConnection)
                            .buttonStyle(.link)
                    }
                    HStack(spacing: 12) {
                        Button(overview.grant?.status == .active ? "Replace grant" : "Create grant", action: saveGrant)
                            .disabled(isSaving || !overview.connection.enabled)
                        if overview.grant?.status == .active {
                            Button("Revoke grant", role: .destructive) { showingRevokeConfirmation = true }
                                .disabled(isSaving)
                        }
                        if isSaving { ProgressView("Saving").controlSize(.small) }
                    }
                    if let inputError {
                        Text(inputError)
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    } else if let writeMessage {
                        Text(writeMessage)
                            .font(.subheadline)
                            .foregroundStyle(writeFailed ? Color.red : Color.secondary)
                    }
                }
            }
            .padding(.horizontal, 26)
            .padding(.top, 24)
            .padding(.bottom, 16)
        }
        .onChange(of: overview.grant?.id) { _, _ in
            totalInput = Self.editable(overview.grant?.totalLimit.value)
            singleInput = Self.editable(overview.grant?.singleLimit.value)
            if let expiresAt = overview.grant?.expiresAt {
                expiration = Date(timeIntervalSince1970: TimeInterval(expiresAt) / 1_000)
            }
            inputError = nil
        }
        .confirmationDialog("Revoke this Spend Grant?", isPresented: $showingRevokeConfirmation) {
            Button("Revoke grant", role: .destructive) { Task { await onRevoke() } }
        } message: {
            Text("New purchases will lose this grant. The MCP host must reconnect afterward.")
        }
    }

    private var status: String {
        switch overview.grant?.status {
        case .active: "Active"
        case .revoked: "Revoked"
        case .expired: "Expired"
        case nil: "Not set"
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value).monospacedDigit()
        }
        .font(.subheadline)
    }

    private func amountField(_ label: String, text: Binding<String>) -> some View {
        HStack {
            Text(label)
                .frame(width: 112, alignment: .leading)
            TextField("Amount", text: text)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("\(label) in test USDC")
                .disabled(isSaving)
            Text("USDC")
                .foregroundStyle(.secondary)
        }
        .font(.subheadline)
    }

    private func saveGrant() {
        guard let total = Self.minorUnits(totalInput), total != "0",
              let single = Self.minorUnits(singleInput), single != "0",
              expiration > .now else {
            inputError = "Enter positive test USDC amounts and a future expiration."
            return
        }
        inputError = nil
        let expiresAt = Int64(expiration.timeIntervalSince1970 * 1_000)
        Task { await onCreate(total, single, expiresAt) }
    }

    // This only converts editor text. Grant validity and spending policy stay in the backend.
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

    private static func editable(_ amount: Int64?) -> String {
        guard let amount else { return "" }
        return decimalString(amount, decimals: 6) ?? ""
    }

    private func amount(_ value: MinorUnits, decimals: Int) -> String {
        guard let exact = Self.decimalString(value.value, decimals: decimals) else { return "—" }
        return "\(exact) test USDC"
    }

    private static func decimalString(_ amount: Int64, decimals: Int) -> String? {
        guard (0...18).contains(decimals) else { return nil }
        let digits = String(amount)
        if decimals == 0 { return digits }
        let padded = String(repeating: "0", count: max(0, decimals + 1 - digits.count)) + digits
        let whole = String(padded.dropLast(decimals))
        let fractional = String(padded.suffix(decimals)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        return fractional.isEmpty ? whole : "\(whole).\(fractional)"
    }
}
