import SwiftUI

struct AgentConnectionDetail: View {
    let presentation: ConnectionPresentation
    let isSaving: Bool
    let writeMessage: String?
    let writeFailed: Bool
    let onBack: (() -> Void)?
    let onSetEnabled: (Bool) async -> Void

    @State private var showingRevokeConfirmation = false

    private let signal = Color(red: 0.24, green: 0.49, blue: 0.81)
    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let rule = Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let onBack {
                Button("Authority", systemImage: "chevron.left", action: onBack)
                    .font(.system(size: 12))
                    .foregroundStyle(secondaryInk)
                    .buttonStyle(.plain)
                    .disabled(isSaving)
                    .padding(.bottom, 20)
            }

            Text("CONNECTION")
                .font(.system(size: 10, weight: .medium))
                .tracking(2.6)
                .foregroundStyle(secondaryInk)

            Text(presentation.title)
                .font(.system(size: 56, weight: .regular, design: .serif))
                .tracking(-1.8)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .frame(height: 66, alignment: .leading)
                .padding(.top, 8)
                .accessibilityAddTraits(.isHeader)

            connectionBridge
                .padding(.top, 22)

            Text(presentation.description)
                .font(.system(size: 15))
                .foregroundStyle(secondaryInk)
                .lineSpacing(3)
                .lineLimit(2)
                .frame(height: 42, alignment: .topLeading)
                .padding(.top, 20)

            hairline
                .padding(.top, 16)

            metadata
                .padding(.vertical, 20)

            hairline

            statusLine
                .padding(.top, 22)

            Spacer(minLength: 24)

            hairline

            Button(action: setConnection) {
                HStack(spacing: 16) {
                    Text(presentation.canDisconnect ? "Disconnect" : "Connect")
                        .foregroundStyle(signal)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(secondaryInk)
                        .accessibilityHidden(true)
                }
                .font(.system(size: 16))
                .frame(minHeight: 34, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isSaving)
            .popover(isPresented: $showingRevokeConfirmation, attachmentAnchor: .rect(.bounds), arrowEdge: .bottom) {
                disconnectConfirmation
            }
            .accessibilityHint(presentation.canDisconnect
                ? "Revokes connection access and the active Spend Grant after confirmation."
                : "Enables connection access. Reconnect the external MCP host to use it.")
            .padding(.top, 12)

            if isSaving || writeMessage != nil {
                Text(isSaving ? "Saving…" : (writeMessage ?? ""))
                    .font(.system(size: 12))
                    .foregroundStyle(writeFailed ? Color.red : secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.updatesFrequently)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, onBack == nil ? 44 : 18)
        .padding(.bottom, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var disconnectConfirmation: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Disconnect this Agent?")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("This also revokes the active Spend Grant. The external MCP session will need to reconnect.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button("Cancel") { showingRevokeConfirmation = false }
                    .keyboardShortcut(.cancelAction)
                Button("Disconnect", role: .destructive, action: confirmDisconnect)
                    .disabled(isSaving || !presentation.canDisconnect)
            }
            .buttonStyle(.bordered)
            .padding(.top, 4)
        }
        .frame(width: 264, alignment: .leading)
        .padding(18)
    }

    private func confirmDisconnect() {
        showingRevokeConfirmation = false
        guard !isSaving, presentation.canDisconnect else { return }
        Task { await onSetEnabled(false) }
    }

    private var connectionBridge: some View {
        VStack(spacing: 10) {
            // This is a static relationship diagram, not a connection test or control.
            GeometryReader { geometry in
                ZStack(alignment: .topLeading) {
                    Path { path in
                        path.move(to: CGPoint(x: 5, y: 5))
                        path.addLine(to: CGPoint(x: geometry.size.width - 5, y: 5))
                    }
                    .stroke(
                        presentation.isConnected ? signal.opacity(0.45) : rule,
                        style: StrokeStyle(lineWidth: 1.5, dash: presentation.isConnected ? [] : [3, 3])
                    )

                    bridgeNode
                    bridgeNode
                        .offset(x: geometry.size.width - 10)

                    if presentation.isConnected {
                        Circle()
                            .fill(signal)
                            .frame(width: 6, height: 6)
                            .offset(x: geometry.size.width / 2 - 3, y: 2)
                    }
                }
            }
            .frame(height: 10)

            HStack {
                Text(presentation.agentName)
                    .lineLimit(1)
                Spacer(minLength: 12)
                Text("2049")
            }
            .font(.system(size: 12))
            .foregroundStyle(secondaryInk)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(presentation.agentName) to 2049")
        .accessibilityValue(presentation.title)
    }

    private var bridgeNode: some View {
        Circle()
            .fill(presentation.isConnected ? signal : Color.clear)
            .overlay { Circle().strokeBorder(presentation.isConnected ? signal : secondaryInk, lineWidth: 1.5) }
            .frame(width: 10, height: 10)
    }

    private var metadata: some View {
        HStack(spacing: 0) {
            specification("AGENT", presentation.agentName)
            metadataSeparator
            specification("TRANSPORT", "MCP")
                .padding(.leading, 18)
            metadataSeparator
            specification("BACKEND", "Local")
                .padding(.leading, 18)
            metadataSeparator
            specification("NETWORK", presentation.network)
                .padding(.leading, 18)
        }
    }

    private func specification(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label)
                .font(.system(size: 9, weight: .medium))
                .tracking(1.7)
                .foregroundStyle(secondaryInk)
            Text(value)
                .font(.system(size: 15))
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var metadataSeparator: some View {
        Rectangle().fill(rule).frame(width: 1, height: 46)
            .accessibilityHidden(true)
    }

    private var statusLine: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Text(presentation.activityLabel)
                Text("·")
                if let date = presentation.activityDate {
                    Text(date, style: .relative)
                } else {
                    Text("—")
                }
            }
            Spacer(minLength: 0)
            HStack(spacing: 7) {
                Circle()
                    .fill(presentation.canDisconnect && presentation.backendAvailable
                        ? Color(red: 0.34, green: 0.68, blue: 0.65) : secondaryInk)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)
                Text(presentation.status)
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var hairline: some View {
        Rectangle().fill(rule).frame(height: 1)
            .accessibilityHidden(true)
    }

    private func setConnection() {
        if presentation.canDisconnect {
            showingRevokeConfirmation = true
        } else {
            Task { await onSetEnabled(true) }
        }
    }
}

#Preview("Connection · Connected (fixture)") {
    AgentConnectionDetail(
        presentation: ConnectionPresentation(agentName: "Codex", state: .connected(lastHandshake: .now),
            network: "Solana Devnet", backendAvailable: true),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}

#Preview("Connection · Not Connected (fixture)") {
    AgentConnectionDetail(
        presentation: ConnectionPresentation(agentName: "Codex", state: .notConnected,
            network: "Solana Devnet", backendAvailable: true),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}

#Preview("Connection · Access Enabled (fixture)") {
    AgentConnectionDetail(
        presentation: ConnectionPresentation(agentName: "Codex", state: .reconnectRequired(lastRequest: nil),
            network: "Solana Devnet", backendAvailable: true),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}
