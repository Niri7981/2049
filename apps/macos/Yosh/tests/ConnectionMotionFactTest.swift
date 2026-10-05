import Foundation

@main
struct ConnectionMotionFactTest {
    static func main() {
        let member = UUID()
        var observation = ConnectionMotionObservation()
        observation.observe(fact(member, enabled: false, configured: false))
        precondition(observation.transition == nil && observation.fact?.isPrepared == false)
        observation.beginPreparation(memberID: UUID())
        precondition(!observation.isPreparing, "Another member cannot start preparation")
        observation.beginPreparation(memberID: member)
        let preparation = observation.transition
        precondition(preparation?.direction == .prepare && observation.isPreparing)
        precondition(observation.fact?.isPrepared == false && observation.fact?.isConnected == false,
            "Connect feedback is not backend readiness or host success")
        observation.beginPreparation(memberID: member)
        precondition(observation.transition == preparation, "Duplicate Connect cannot replay preparation")

        let pending = connection(enabled: false, configured: false)
        precondition(ConnectionPresentation(connection: pending, service: service, agentName: "Codex").state == .notConnected,
            "A pending Connect must not show waiting copy before confirmation")
        observation.observe(fact(member))
        precondition(observation.fact?.isPrepared == true && observation.fact?.isConnected == false)
        precondition(observation.transition == preparation, "Confirmed readiness must not restart preparation")
        precondition(ConnectionPresentation(connection: connection(), service: service, agentName: "Codex").state == .waitingForCodex)
        observation.endPreparation(memberID: member)
        precondition(!observation.isPreparing && observation.transition == preparation,
            "Ending a confirmed preparation must leave its animation event unchanged")
        observation.observe(fact(member))
        precondition(observation.transition == preparation)

        observation.observe(fact(member, handshake: 100))
        let connected = observation.transition
        precondition(connected?.direction == .connect && connected != preparation)
        for heartbeat in 101...110 {
            observation.observe(fact(member, handshake: 100, heartbeat: Int64(heartbeat)))
            precondition(observation.transition == connected, "Polling/heartbeats cannot replay completion")
        }
        observation.observe(fact(member))
        let waiting = observation.transition
        precondition(waiting?.direction == .waiting && observation.fact?.isPrepared == true,
            "Losing the host leaves an enabled path waiting rather than disconnecting it")
        observation.observe(fact(member))
        precondition(observation.transition == waiting)
        observation.observe(fact(member, handshake: 100))
        precondition(observation.transition == waiting, "An old handshake is not a new completion")
        observation.observe(fact(member))
        observation.observe(fact(member, handshake: 200))
        precondition(observation.transition?.direction == .connect && observation.transition != connected)
        observation.observe(fact(member, enabled: false, configured: false))
        let disconnected = observation.transition
        precondition(disconnected?.direction == .disconnect)
        observation.observe(fact(member, enabled: false, configured: false))
        precondition(observation.transition == disconnected)

        observation.beginPreparation(memberID: member)
        observation.endPreparation(memberID: member)
        precondition(!observation.isPreparing && observation.transition?.direction == .disconnect,
            "An unsuccessful request withdraws preparation without inventing readiness")

        for handshake: Int64? in [nil, 200] {
            var launch = ConnectionMotionObservation()
            launch.observe(fact(member, handshake: handshake))
            precondition(launch.transition == nil, "Existing Waiting/Connected at launch is a resting baseline")
            launch.beginPreparation(memberID: member)
            precondition(!launch.isPreparing && launch.transition == nil,
                "An already available path cannot replay preparation")
            let baseline = launch
            let live = connection(handshake: handshake)
            precondition(ConnectionPresentation(connection: live, service: service, agentName: "Codex",
                issueMessage: "Setup failed").state == .connectionIssue)
            launch.observe(fact(member, handshake: handshake))
            precondition(launch == baseline, "Retry clearing Issue cannot fabricate a preparation or completion event")
        }
        var retry = ConnectionMotionObservation()
        retry.observe(fact(member, enabled: false, configured: false))
        retry.observe(fact(member))
        precondition(retry.transition == nil && retry.fact?.isPrepared == true,
            "Backend readiness from Retry/refresh alone does not play Connect preparation")

        observation.beginPreparation(memberID: member)
        let otherMember = UUID()
        observation.observe(fact(otherMember))
        precondition(!observation.isPreparing && observation.transition == nil,
            "Switching Agent cancels outgoing request motion")
        let otherBaseline = observation
        observation.endPreparation(memberID: member)
        precondition(observation == otherBaseline, "An old member's request completion cannot affect the new member")
        observation.observe(fact(member, handshake: 200))
        precondition(observation.transition == nil)

        for invalid in [connection(enabled: false), connection(configured: false), connection(provider: "custom")] {
            precondition(!ConnectionMotionFact(memberID: member, connection: invalid, service: service).isPrepared)
        }
        for invalid in [connection(), connection(handshake: 400, enabled: false),
                        connection(handshake: 400, provider: "custom"), connection(handshake: 400, heartbeat: nil)] {
            precondition(!ConnectionMotionFact(memberID: member, connection: invalid, service: service).isConnected)
        }
        let stopping = AppOverview.Service(status: .stopping, purchaseMode: .simulated, network: "Solana Devnet")
        let stoppedFact = ConnectionMotionFact(memberID: member, connection: connection(handshake: 400), service: stopping)
        precondition(!stoppedFact.isPrepared && !stoppedFact.isConnected)
        var custom = ConnectionMotionObservation()
        custom.observe(ConnectionMotionFact(memberID: member, connection: connection(enabled: false, provider: "custom"), service: service))
        custom.beginPreparation(memberID: member)
        precondition(!custom.isPreparing && custom.transition == nil)
        print("Connection facts: explicit preparation, confirmed Waiting, quiet completion, failed requests, duplicate/Retry/stale suppression and member isolation passed")
    }

    static let service = AppOverview.Service(status: .running, purchaseMode: .simulated, network: "Solana Devnet")

    static func fact(_ member: UUID, handshake: Int64? = nil, enabled: Bool = true,
        configured: Bool = true, heartbeat: Int64? = 500) -> ConnectionMotionFact {
        ConnectionMotionFact(memberID: member, connection: connection(handshake: handshake,
            enabled: enabled, configured: configured, heartbeat: heartbeat), service: service)
    }

    static func connection(handshake: Int64? = nil, enabled: Bool = true, configured: Bool = true,
        provider: String = "codex", heartbeat: Int64? = 500) -> AppOverview.Connection {
        AppOverview.Connection(enabled: enabled, lastSeen: nil, access: .purchaseIntent,
            integration: .init(provider: provider, configured: configured, connected: handshake != nil,
                state: !enabled ? "disconnected" : handshake == nil ? "reconnect_required" : "connected",
                lastHandshake: handshake, lastHeartbeat: heartbeat))
    }
}
