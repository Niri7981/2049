import Foundation

/// A successful member read, independent of request errors and presentation wording.
struct ConnectionMotionFact: Equatable {
    let memberID: UUID
    let handshake: Int64?
    let isCodex: Bool
    let isPrepared: Bool

    init(memberID: UUID, connection: AppOverview.Connection, service: AppOverview.Service) {
        self.memberID = memberID
        isCodex = connection.integration?.provider == "codex"
        isPrepared = service.status == .running && isCodex && connection.enabled
            && connection.integration?.configured == true
        handshake = service.status == .running && connection.integration?.provider == "codex"
            && connection.hasLiveMCPSession ? connection.integration?.lastHandshake : nil
    }

    var isConnected: Bool { handshake != nil }
}

/// Lives with the selected member, across tabs and Retry. Heartbeats are not revisions.
struct ConnectionMotionObservation: Equatable {
    enum Direction { case prepare, connect, waiting, disconnect }
    struct Transition: Equatable {
        let revision: Int
        let direction: Direction
    }

    private(set) var fact: ConnectionMotionFact?
    private(set) var transition: Transition?
    private(set) var isPreparing = false
    private var newestHandshake: Int64?
    private var revision = 0

    mutating func beginPreparation(memberID: UUID) {
        guard let fact, fact.memberID == memberID, fact.isCodex,
              !fact.isPrepared, !isPreparing else { return }
        // This is request feedback, not evidence of a prepared path or live host.
        isPreparing = true
        emit(.prepare)
    }

    mutating func endPreparation(memberID: UUID) {
        guard fact?.memberID == memberID, isPreparing else { return }
        isPreparing = false
        if fact?.isPrepared != true { emit(.disconnect) }
    }

    mutating func observe(_ incoming: ConnectionMotionFact) {
        guard let previous = fact, previous.memberID == incoming.memberID else {
            // First observation (including switching members) is a resting baseline.
            fact = incoming
            newestHandshake = incoming.handshake
            transition = nil
            isPreparing = false
            return
        }
        fact = incoming
        let newHandshake = incoming.handshake.map { $0 > (newestHandshake ?? Int64.min) } ?? false
        if let handshake = incoming.handshake {
            newestHandshake = max(newestHandshake ?? handshake, handshake)
        }
        if !previous.isConnected && incoming.isConnected && newHandshake {
            isPreparing = false
            emit(.connect)
        } else if previous.isPrepared && !incoming.isPrepared {
            isPreparing = false
            emit(.disconnect)
        } else if previous.isConnected && !incoming.isConnected {
            emit(.waiting)
        }
    }

    private mutating func emit(_ direction: Direction) {
        revision += 1
        transition = Transition(revision: revision, direction: direction)
    }
}
