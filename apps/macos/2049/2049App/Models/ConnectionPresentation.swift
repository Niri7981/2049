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

    init(agentName: String, state: State, network: String, backendAvailable: Bool) {
        self.agentName = agentName
        self.state = state
        self.network = network == "Solana Devnet" ? "Devnet" : (network.isEmpty ? "—" : network)
        self.backendAvailable = backendAvailable
    }

    init(connection: AppOverview.Connection, service: AppOverview.Service, agentName: String) {
        // The API reports credentials and authenticated requests, not a live MCP
        // session or handshake. Neither enabled nor lastSeen certifies Connected.
        self.init(
            agentName: agentName,
            state: connection.enabled
                ? .reconnectRequired(lastRequest: connection.lastSeen.map {
                    Date(timeIntervalSince1970: TimeInterval($0) / 1_000)
                })
                : .notConnected,
            network: service.network,
            backendAvailable: service.status == .running
        )
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
        case .notConnected: "\(agentName) is not connected to 2049.\nConnect to enable agent purchases."
        case .reconnectRequired: "Access is enabled for \(agentName).\nReconnect the MCP host to use 2049."
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
