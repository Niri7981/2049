import Foundation

/// Product language for existing backend facts. Access alone never proves host liveness.
struct ConnectionPresentation {
    enum State: Equatable {
        case connected, notConnected, waitingForCodex, accessAllowed, notSetUp, connectionIssue
    }

    let agentName: String
    let state: State
    let network: String
    let canDisconnect: Bool
    private let issueMessage: String?

    init(agentName: String, state: State, network: String, canDisconnect: Bool, issueMessage: String? = nil) {
        self.agentName = agentName
        self.state = state
        self.network = network.isEmpty ? "—" : network
        self.canDisconnect = canDisconnect
        self.issueMessage = issueMessage
    }

    init(connection: AppOverview.Connection, service: AppOverview.Service, agentName: String, issueMessage: String? = nil) {
        let integrated = connection.integration?.provider == "codex"
        let state: State
        let problem: String?
        if let issueMessage {
            state = .connectionIssue
            problem = issueMessage
        } else if service.status != .running {
            state = .connectionIssue
            problem = "Yosh is stopping. Open Yosh again to connect."
        } else if integrated {
            state = connection.hasLiveMCPSession ? .connected : connection.enabled ? .waitingForCodex : .notConnected
            problem = nil
        } else {
            // Custom members have access control, but no verified provider-session detector.
            state = connection.enabled ? .accessAllowed : .notSetUp
            problem = nil
        }
        self.init(agentName: agentName, state: state, network: service.network,
            canDisconnect: connection.enabled, issueMessage: problem)
    }

    var isConnected: Bool { state == .connected }

    var title: String {
        switch state {
        case .connected: "Connected"
        case .notConnected: "Not Connected"
        case .waitingForCodex: "Waiting for Codex"
        case .accessAllowed: "Access allowed"
        case .notSetUp: "Not set up"
        case .connectionIssue: "Connection Issue"
        }
    }

    var description: String {
        switch state {
        case .connected: "\(agentName) is ready to use Yosh."
        case .notConnected: "Connect Codex to Yosh."
        case .waitingForCodex: "Yosh is ready.\nOpen or continue a Codex chat to finish connecting."
        case .accessAllowed: "\(agentName) is allowed to use Yosh.\nIts online status cannot be confirmed."
        case .notSetUp: "Allow \(agentName) to use Yosh."
        case .connectionIssue: issueMessage ?? "Yosh couldn't confirm the connection. Try again."
        }
    }
}
