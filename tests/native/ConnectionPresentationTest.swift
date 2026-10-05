import Foundation

/// Existing access and liveness facts map to product language, without implying permission to spend.
@main
struct ConnectionPresentationTest {
    static func main() throws {
        let service = AppOverview.Service(status: .running, purchaseMode: .simulated, network: "Solana Devnet")
        let liveJSON = #"{"enabled":true,"lastSeen":1800000000000,"access":"purchase_intent","integration":{"provider":"codex","configured":true,"connected":true,"state":"connected","lastHandshake":1800000001000,"lastHeartbeat":1800000011000}}"#
        func decode(_ json: String) throws -> AppOverview.Connection {
            try JSONDecoder().decode(AppOverview.Connection.self, from: Data(json.utf8))
        }
        let live = try decode(liveJSON)
        let connected = ConnectionPresentation(connection: live, service: service, agentName: "Research")
        precondition(connected.state == .connected && connected.isConnected && connected.canDisconnect)
        precondition(connected.description == "Research is ready to use Yosh.")
        precondition(connected.network == "Solana Devnet")

        let staleJSON = liveJSON.replacingOccurrences(of: #""connected":true"#, with: #""connected":false"#)
            .replacingOccurrences(of: #""state":"connected""#, with: #""state":"reconnect_required""#)
        let waiting = ConnectionPresentation(connection: try decode(staleJSON), service: service, agentName: "Research")
        precondition(waiting.state == .waitingForCodex && !waiting.isConnected && waiting.canDisconnect)
        precondition(waiting.title == "Waiting for Codex")
        precondition(waiting.description == "Yosh is ready.\nOpen or continue a Codex chat to finish connecting.")

        let disabledJSON = staleJSON.replacingOccurrences(of: #""enabled":true"#, with: #""enabled":false"#)
        let disabled = ConnectionPresentation(connection: try decode(disabledJSON), service: service, agentName: "Research")
        precondition(disabled.state == .notConnected && !disabled.canDisconnect)
        precondition(disabled.description == "Connect Codex to Yosh.")

        // Removing any existing live-evidence condition must still prevent Connected.
        for json in [liveJSON.replacingOccurrences(of: #""configured":true"#, with: #""configured":false"#),
                     liveJSON.replacingOccurrences(of: #""lastHandshake":1800000001000"#, with: #""lastHandshake":null"#),
                     liveJSON.replacingOccurrences(of: #""lastHeartbeat":1800000011000"#, with: #""lastHeartbeat":null"#)] {
            let incomplete = try decode(json)
            precondition(!ConnectionPresentation(connection: incomplete, service: service, agentName: "Codex").isConnected)
        }
        let stopping = AppOverview.Service(status: .stopping, purchaseMode: .simulated, network: "Solana Devnet")
        let stopped = ConnectionPresentation(connection: live, service: stopping, agentName: "Research")
        precondition(stopped.state == .connectionIssue && !stopped.isConnected && stopped.canDisconnect)
        let failed = ConnectionPresentation(connection: live, service: service, agentName: "Research", issueMessage: "Setup failed.")
        precondition(failed.state == .connectionIssue && !failed.isConnected && failed.canDisconnect)
        precondition(failed.description == "Setup failed.")
        let failedDisabled = ConnectionPresentation(connection: try decode(disabledJSON), service: service,
            agentName: "Codex", issueMessage: "Setup failed.")
        precondition(!failedDisabled.canDisconnect, "An error cannot fabricate enabled access")

        let custom = AppOverview.Connection(enabled: true, lastSeen: 1_800_000_000_000, access: .purchaseIntent)
        let allowed = ConnectionPresentation(connection: custom, service: service, agentName: "Codex")
        precondition(allowed.state == .accessAllowed && !allowed.isConnected && allowed.canDisconnect,
            "A custom member name never selects a provider integration")
        let unset = ConnectionPresentation(connection: AppOverview.Connection(enabled: false, lastSeen: nil, access: .readOnly),
            service: service, agentName: "Buyer")
        precondition(unset.state == .notSetUp && !unset.canDisconnect)
        for presentation in [connected, waiting, disabled, allowed, unset] {
            for term in ["MCP", "handshake", "heartbeat", "lease", "credential", "Reconnect", "configured", "Backend"] {
                precondition(!presentation.title.contains(term) && !presentation.description.contains(term))
            }
        }
        print("Connection presentation: confirmed liveness, waiting, setup, custom access, and real issues passed")
    }
}
