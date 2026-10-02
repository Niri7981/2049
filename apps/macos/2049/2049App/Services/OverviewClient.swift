import Foundation

enum OverviewLoadError: Error {
    case configuration
    case unavailable
    case unauthorized
    case invalidResponse
    case portConflict
    case authenticatedShutdownFailed
    case authenticatedShutdownTimedOut
    case startupFailed
    case readinessTimedOut
    case requestTimedOut
    case serviceExited
    case dataDirectoryInUse
    case invalidRequest
    case writeRejected
    case memberNotFound
    case memberInactive
    case defaultMemberRequired
    case codexNotInstalled, codexConfigConflict, codexConfigFailed, codexBridgeUnavailable

    var message: String {
        switch self {
        case .configuration: "Local service setup unavailable"
        case .unavailable: "Local service unavailable"
        case .unauthorized: "Management access denied"
        case .invalidResponse: "Local service data unavailable"
        case .portConflict: "Unverified local service is using the port"
        case .authenticatedShutdownFailed: "Owned local service refused to stop"
        case .authenticatedShutdownTimedOut: "Owned local service did not stop in time"
        case .startupFailed: "Local service could not start"
        case .readinessTimedOut: "Local service did not become ready"
        case .requestTimedOut: "Local service request timed out"
        case .serviceExited: "Local service stopped"
        case .dataDirectoryInUse: "2049 data is open in another service"
        case .invalidRequest: "Check the entered values and try again"
        case .writeRejected: "The setting change was not confirmed"
        case .memberNotFound: "This agent is no longer available"
        case .memberInactive: "This agent has been revoked"
        case .defaultMemberRequired: "The default agent cannot be revoked"
        case .codexNotInstalled: "Install Codex Desktop or CLI to connect"
        case .codexConfigConflict: "This Codex MCP entry was changed outside 2049. Check it in Codex before reconnecting."
        case .codexConfigFailed: "Codex MCP configuration could not be confirmed. Check Codex settings and retry."
        case .codexBridgeUnavailable: "The 2049 MCP launcher is unavailable. Reinstall 2049."
        }
    }
}

struct OverviewClient {
    let runtime: NativeServiceRuntime

    func load(retry: Bool = false) async throws -> AppOverview {
        let (data, response) = try await request(.overview, retry: retry)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        guard response.statusCode == 200, data.count <= 1_048_576 else { throw OverviewLoadError.invalidResponse }
        do {
            return try JSONDecoder().decode(AppOverview.self, from: data)
        } catch {
            throw OverviewLoadError.invalidResponse
        }
    }

    func loadBalance() async throws -> AppBalance {
        let (data, response) = try await request(.balance)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        guard response.statusCode == 200, data.count <= 65_536 else { throw OverviewLoadError.unavailable }
        guard let balance = try? JSONDecoder().decode(BalanceResponse.self, from: data).balance else {
            throw OverviewLoadError.invalidResponse
        }
        return balance
    }

    func setPaused(_ paused: Bool) async throws {
        try await write(.setPaused(paused))
    }

    func setDailyLimit(_ minorUnits: String) async throws {
        try await write(.setDailyLimit(minorUnits))
    }

    func createGrant(totalLimit: String, singleLimit: String, expiresAt: Int64) async throws {
        try await write(.createGrant(totalLimit: totalLimit, singleLimit: singleLimit, expiresAt: expiresAt))
    }

    func revokeGrant() async throws {
        try await write(.revokeGrant)
    }

    func setConnection(_ enabled: Bool) async throws {
        try await write(.setConnection(enabled))
    }

    func loadMembers(retry: Bool = false) async throws -> [CardMemberSummary] {
        try await read(.members, as: MembersResponse.self, retry: retry).members
    }

    func loadMember(_ id: UUID, retry: Bool = false) async throws -> CardMemberSnapshot {
        try await read(.member(id), as: CardMemberSnapshot.self, retry: retry)
    }

    func createMember(label: String) async throws -> CardMemberSnapshot {
        try await mutate(.createMember(label), as: CardMemberSnapshot.self, successStatus: 201)
    }

    func renameMember(_ id: UUID, label: String) async throws -> CardMemberSnapshot {
        try await mutate(.renameMember(id, label), as: CardMemberSnapshot.self)
    }

    func revokeMember(_ id: UUID) async throws -> CardMemberSnapshot {
        try await mutate(.revokeMember(id), as: CardMemberSnapshot.self)
    }

    func setMemberConnection(_ id: UUID, enabled: Bool) async throws {
        try await write(.setMemberConnection(id, enabled))
    }

    func createMemberGrant(_ id: UUID, totalLimit: String, singleLimit: String, expiresAt: Int64) async throws {
        try await write(.createMemberGrant(id, totalLimit: totalLimit, singleLimit: singleLimit, expiresAt: expiresAt))
    }

    func revokeMemberGrant(_ id: UUID) async throws {
        try await write(.revokeMemberGrant(id))
    }

    private func read<T: Decodable>(_ endpoint: ServiceEndpoint, as type: T.Type, retry: Bool = false) async throws -> T {
        let (data, response) = try await request(endpoint, retry: retry)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        if response.statusCode == 404 { throw OverviewLoadError.memberNotFound }
        guard response.statusCode == 200, data.count <= 1_048_576,
              let value = try? JSONDecoder().decode(type, from: data) else { throw OverviewLoadError.invalidResponse }
        return value
    }

    private func mutate<T: Decodable>(_ endpoint: ServiceEndpoint, as type: T.Type, successStatus: Int = 200) async throws -> T {
        let (data, response) = try await request(endpoint)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        guard data.count <= 1_048_576 else { throw OverviewLoadError.writeRejected }
        guard response.statusCode == successStatus else {
            if let code = try? JSONDecoder().decode(ManagementErrorResponse.self, from: data).code {
                switch code {
                case "INVALID_REQUEST": throw OverviewLoadError.invalidRequest
                case "CARD_MEMBER_NOT_FOUND": throw OverviewLoadError.memberNotFound
                case "CARD_MEMBER_NOT_ACTIVE": throw OverviewLoadError.memberInactive
                case "DEFAULT_CARD_MEMBER_REQUIRED": throw OverviewLoadError.defaultMemberRequired
                default: break
                }
            }
            throw OverviewLoadError.writeRejected
        }
        guard let value = try? JSONDecoder().decode(type, from: data) else { throw OverviewLoadError.invalidResponse }
        return value
    }

    private func write(_ endpoint: ServiceEndpoint) async throws {
        let (data, response) = try await request(endpoint)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        guard data.count <= 65_536 else { throw OverviewLoadError.writeRejected }
        if response.statusCode == 200 { return }
        if let code = try? JSONDecoder().decode(ManagementErrorResponse.self, from: data).code {
            if code == "INVALID_REQUEST" { throw OverviewLoadError.invalidRequest }
            if code == "DATA_DIRECTORY_IN_USE" { throw OverviewLoadError.dataDirectoryInUse }
            if code == "CARD_MEMBER_NOT_FOUND" { throw OverviewLoadError.memberNotFound }
            if code == "CARD_MEMBER_NOT_ACTIVE" { throw OverviewLoadError.memberInactive }
            if code == "CODEX_NOT_INSTALLED" { throw OverviewLoadError.codexNotInstalled }
            if code == "CODEX_CONFIG_CONFLICT" { throw OverviewLoadError.codexConfigConflict }
            if code == "CODEX_CONFIG_FAILED" { throw OverviewLoadError.codexConfigFailed }
            if code == "CODEX_BRIDGE_UNAVAILABLE" { throw OverviewLoadError.codexBridgeUnavailable }
        }
        throw OverviewLoadError.writeRejected
    }

    private func request(_ endpoint: ServiceEndpoint, retry: Bool = false) async throws -> (Data, HTTPURLResponse) {
        do {
            let configuration = try await runtime.ready(retry: retry)
            return try await configuration.request(endpoint)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as ServiceRuntimeError {
            switch error {
            case .configuration: throw OverviewLoadError.configuration
            case .portConflict: throw OverviewLoadError.portConflict
            case .authenticatedShutdownFailed: throw OverviewLoadError.authenticatedShutdownFailed
            case .authenticatedShutdownTimedOut: throw OverviewLoadError.authenticatedShutdownTimedOut
            case .authenticationFailed: throw OverviewLoadError.unauthorized
            case .requestTimedOut: throw OverviewLoadError.requestTimedOut
            case .responseTooLarge: throw OverviewLoadError.invalidResponse
            case .cannotStart: throw OverviewLoadError.startupFailed
            case .notReady: throw OverviewLoadError.readinessTimedOut
            case .processExited: throw OverviewLoadError.serviceExited
            case .dataDirectoryInUse: throw OverviewLoadError.dataDirectoryInUse
            case .unavailable: throw OverviewLoadError.unavailable
            }
        } catch {
            throw OverviewLoadError.unavailable
        }
    }
}

private struct BalanceResponse: Decodable {
    let balance: AppBalance
}

private struct MembersResponse: Decodable {
    let members: [CardMemberSummary]
}

private struct ManagementErrorResponse: Decodable {
    let code: String
}
