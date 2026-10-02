import Foundation

/// Connection facts for the page, separate from access enablement and local service health.
struct ConnectionPresentation {
    enum State: Equatable {
        case connected(lastHandshake: Date?)
        case notConnected
        case reconnectRequired(lastRequest: Date?)
    }

    let agentName: String
    let state: State
    let network: String
    let backendAvailable: Bool
    private var codexConfigured = false

    init(agentName: String, state: State, network: String, backendAvailable: Bool) {
        self.agentName = agentName
        self.state = state
        self.network = network == "Solana Devnet" ? "Devnet" : (network.isEmpty ? "—" : network)
        self.backendAvailable = backendAvailable
    }

    init(connection: AppOverview.Connection, service: AppOverview.Service, agentName: String) {
        let integration = connection.integration
        let verified = connection.hasLiveMCPSession && service.status == .running
        self.init(
            agentName: agentName,
            state: verified
                ? .connected(lastHandshake: integration?.lastHandshake.map {
                    Date(timeIntervalSince1970: TimeInterval($0) / 1_000)
                })
                : connection.enabled
                ? .reconnectRequired(lastRequest: connection.lastSeen.map {
                    Date(timeIntervalSince1970: TimeInterval($0) / 1_000)
                })
                : .notConnected,
            network: service.network,
            backendAvailable: service.status == .running
        )
        codexConfigured = integration?.provider == "codex" && integration?.configured == true
    }

    var isConnected: Bool {
        if case .connected = state { return true }
        return false
    }

    var canDisconnect: Bool {
        if case .notConnected = state { return false }
        return true
    }

    var title: String {
        switch state {
        case .connected: "Connected"
        case .notConnected: "Not Connected"
        case .reconnectRequired: "Reconnect Required"
        }
    }

    var description: String {
        switch state {
        case .connected: "\(agentName) is ready to use 2049."
        case .notConnected: "\(agentName) is not connected to 2049.\nConnect to set up MCP access."
        case .reconnectRequired: codexConfigured
            ? "Codex MCP is configured. Start a new Codex chat\nor reload MCP to verify the connection."
            : "Access is enabled for \(agentName).\nReconnect the MCP host to use 2049."
        }
    }

    var activityLabel: String {
        if case .reconnectRequired(let lastRequest) = state, lastRequest != nil { return "Last request" }
        return "Last handshake"
    }

    var activityDate: Date? {
        switch state {
        case .connected(let lastHandshake): lastHandshake
        case .notConnected: nil
        case .reconnectRequired(let lastRequest): lastRequest
        }
    }

    var status: String {
        if case .notConnected = state { return "Disconnected" }
        return backendAvailable ? "Backend available" : "Backend stopping"
    }
}
