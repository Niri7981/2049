import SwiftUI

struct AgentConnectionDetail: View {
    let presentation: ConnectionPresentation
    let isSaving: Bool
    let writeMessage: String?
    let writeFailed: Bool
    let onBack: (() -> Void)?
    let onSetEnabled: (Bool) async -> Void
    let onRetry: (() async -> Void)?
    let retryTitle: String

    @State private var showingRevokeConfirmation = false

    private let signal = Color(red: 0.24, green: 0.49, blue: 0.81)
    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let rule = Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5)

    init(presentation: ConnectionPresentation, isSaving: Bool, writeMessage: String?, writeFailed: Bool,
         onBack: (() -> Void)?, onSetEnabled: @escaping (Bool) async -> Void,
         onRetry: (() async -> Void)? = nil, retryTitle: String = "Retry setup") {
        self.presentation = presentation
        self.isSaving = isSaving
        self.writeMessage = writeMessage
        self.writeFailed = writeFailed
        self.onBack = onBack
        self.onSetEnabled = onSetEnabled
        self.onRetry = onRetry
        self.retryTitle = retryTitle
    }

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

            CardPageHeader(title: presentation.title, style: .hero(eyebrow: "CONNECTION"))

            connectionBridge
                .padding(.top, CardPageHeader.Layout.firstSectionSpacing)

            Text(presentation.description)
                .font(.system(size: 15))
                .foregroundStyle(secondaryInk)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 20)

            if presentation.network != "—" {
                hairline.padding(.top, 24)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Test environment")
                        .font(.system(size: 12))
                        .foregroundStyle(secondaryInk)
                    Text(presentation.network)
                        .font(.system(size: 15))
                }
                .padding(.top, 16)
            }

            Spacer(minLength: 24)
            hairline

            if presentation.state == .connectionIssue, let onRetry {
                Button(retryTitle) { Task { await onRetry() } }
                    .buttonStyle(.plain)
                    .font(.system(size: 16))
                    .foregroundStyle(signal)
                    .disabled(isSaving)
                    .padding(.top, 12)
            }
            if presentation.canDisconnect || presentation.state != .connectionIssue {
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
                    ? "Disconnects this agent and revokes its current spending authorization after confirmation."
                    : "Sets up this agent's access to Yosh.")
                .padding(.top, 12)
            }

            if isSaving || (writeMessage != nil && !(writeFailed && presentation.state == .connectionIssue)) {
                Text(isSaving ? "Updating…" : (writeMessage ?? ""))
                    .font(.system(size: 12))
                    .foregroundStyle(writeFailed ? Color.red : secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.updatesFrequently)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, CardPageHeader.Layout.contentInset)
        .padding(.top, onBack == nil ? CardPageHeader.Layout.topSpacing : 18)
        .padding(.bottom, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var disconnectConfirmation: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Disconnect \(presentation.agentName)?")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("Disconnecting \(presentation.agentName) will also revoke its current spending authorization.")
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
                Text("Yosh")
            }
            .font(.system(size: 12))
            .foregroundStyle(secondaryInk)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(presentation.agentName) to Yosh")
        .accessibilityValue(presentation.title)
    }

    private var bridgeNode: some View {
        Circle()
            .fill(presentation.isConnected ? signal : Color.clear)
            .overlay { Circle().strokeBorder(presentation.isConnected ? signal : secondaryInk, lineWidth: 1.5) }
            .frame(width: 10, height: 10)
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
        presentation: ConnectionPresentation(agentName: "Codex", state: .connected,
            network: "Solana Devnet", canDisconnect: true),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}

#Preview("Connection · Not Connected (fixture)") {
    AgentConnectionDetail(
        presentation: ConnectionPresentation(agentName: "Codex", state: .notConnected,
            network: "Solana Devnet", canDisconnect: false),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}

#Preview("Connection · Waiting (fixture)") {
    AgentConnectionDetail(
        presentation: ConnectionPresentation(agentName: "Codex", state: .waitingForCodex,
            network: "Solana Devnet", canDisconnect: true),
        isSaving: false, writeMessage: nil, writeFailed: false, onBack: nil, onSetEnabled: { _ in }
    )
    .frame(width: 420, height: 526)
    .background(CardMaterial())
    .environment(\.colorScheme, .light)
}
