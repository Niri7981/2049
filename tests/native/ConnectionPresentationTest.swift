import Foundation

/// Fixtures verify that access and historical requests never certify a live connection.
@main
struct ConnectionPresentationTest {
    static func main() throws {
        let service = AppOverview.Service(status: .running, purchaseMode: .simulated, network: "Solana Devnet")
        let recentRequest: Int64 = 1_800_000_000_000
        let enabled = AppOverview.Connection(enabled: true, lastSeen: recentRequest, access: .purchaseIntent)
        let unverified = ConnectionPresentation(connection: enabled, service: service, agentName: "Research")
        precondition(!unverified.isConnected && unverified.canDisconnect)
        precondition(unverified.activityLabel == "Last request")
        precondition(unverified.activityDate == Date(timeIntervalSince1970: 1_800_000_000))
        precondition(unverified.agentName == "Research" && unverified.network == "Devnet")

        let disabled = AppOverview.Connection(enabled: false, lastSeen: recentRequest, access: .readOnly)
        let disconnected = ConnectionPresentation(connection: disabled, service: service, agentName: "Buyer")
        precondition(disconnected.state == .notConnected && !disconnected.canDisconnect)
        precondition(disconnected.activityDate == nil && disconnected.status == "Disconnected")

        let noRequest = AppOverview.Connection(enabled: true, lastSeen: nil, access: .readOnly)
        let stopping = AppOverview.Service(status: .stopping, purchaseMode: .simulated, network: "Fixture network")
        let pending = ConnectionPresentation(connection: noRequest, service: stopping, agentName: "Codex")
        precondition(!pending.isConnected && pending.activityDate == nil && !pending.backendAvailable)
        precondition(pending.network == "Fixture network" && pending.status == "Backend stopping")

        // Verified connectivity has its own explicit input; the current API adapter
        // cannot reach it by inspecting enabled or lastSeen.
        let handshake = Date(timeIntervalSince1970: 1_800_000_001)
        let connected = ConnectionPresentation(agentName: "Codex", state: .connected(lastHandshake: handshake),
            network: "Solana Devnet", backendAvailable: true)
        precondition(connected.isConnected && connected.canDisconnect)
        precondition(connected.activityLabel == "Last handshake" && connected.activityDate == handshake)
        let unavailable = ConnectionPresentation(agentName: "Codex", state: .notConnected,
            network: "", backendAvailable: false)
        precondition(unavailable.network == "—")
        print("Native Connection presentation tests passed")
    }
}
