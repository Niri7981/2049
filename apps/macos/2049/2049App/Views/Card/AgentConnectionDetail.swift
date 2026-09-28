import SwiftUI

struct AgentConnectionDetail: View {
    let connection: AppOverview.Connection
    let isSaving: Bool
    let writeMessage: String?
    let writeFailed: Bool
    let onBack: () -> Void
    let onSetEnabled: (Bool) async -> Void

    @State private var showingRevokeConfirmation = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Button("Authority", systemImage: "chevron.left", action: onBack)
                .buttonStyle(.plain)
                .disabled(isSaving)

            VStack(alignment: .leading, spacing: 6) {
                Text("Agent Connection")
                    .font(.title2)
                Text(connection.enabled ? "Enabled" : "Not connected")
                    .font(.largeTitle)
                Text("Agent connection · Solana Devnet")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            Divider()

            VStack(alignment: .leading, spacing: 10) {
                fact("Access", connection.enabled ? (connection.access == .purchaseIntent ? "Purchase requests" : "Read only") : "None")
                fact("Last seen", connection.lastSeen.map {
                    Date(timeIntervalSince1970: TimeInterval($0) / 1_000).formatted(date: .abbreviated, time: .shortened)
                } ?? "Never in this session")
            }

            Text("The local service manages the connection credential. After enabling the connection or changing a grant, restart the external MCP session so it reads the current credential.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            HStack(spacing: 12) {
                if connection.enabled {
                    Button("Revoke connection", role: .destructive) { showingRevokeConfirmation = true }
                        .disabled(isSaving)
                } else {
                    Button("Enable connection") { Task { await onSetEnabled(true) } }
                        .disabled(isSaving)
                }
                if isSaving { ProgressView("Saving").controlSize(.small) }
            }

            if let writeMessage {
                Text(writeMessage)
                    .font(.subheadline)
                    .foregroundStyle(writeFailed ? Color.red : Color.secondary)
                    .accessibilityAddTraits(.updatesFrequently)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .confirmationDialog("Revoke this Agent connection?", isPresented: $showingRevokeConfirmation) {
            Button("Revoke connection", role: .destructive) { Task { await onSetEnabled(false) } }
        } message: {
            Text("This also revokes the active Spend Grant. The external MCP session will need to reconnect.")
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer(minLength: 8)
            Text(value)
        }
        .font(.subheadline)
    }
}
