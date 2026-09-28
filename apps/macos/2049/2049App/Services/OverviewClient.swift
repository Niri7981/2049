import Foundation

enum OverviewLoadError: Error {
    case configuration
    case unavailable
    case unauthorized
    case invalidResponse
    case portConflict
    case startupFailed
    case readinessTimedOut
    case serviceExited
    case dataDirectoryInUse
    case invalidRequest
    case writeRejected

    var message: String {
        switch self {
        case .configuration: "Local service setup unavailable"
        case .unavailable: "Local service unavailable"
        case .unauthorized: "Management access denied"
        case .invalidResponse: "Local service data unavailable"
        case .portConflict: "Local service port in use"
        case .startupFailed: "Local service could not start"
        case .readinessTimedOut: "Local service did not become ready"
        case .serviceExited: "Local service stopped"
        case .dataDirectoryInUse: "2049 data is open in another service"
        case .invalidRequest: "Check the entered values and try again"
        case .writeRejected: "The setting change was not confirmed"
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

    private func write(_ endpoint: ServiceEndpoint) async throws {
        let (data, response) = try await request(endpoint)
        if response.statusCode == 401 || response.statusCode == 403 { throw OverviewLoadError.unauthorized }
        guard data.count <= 65_536 else { throw OverviewLoadError.writeRejected }
        if response.statusCode == 200 { return }
        if let code = try? JSONDecoder().decode(ManagementErrorResponse.self, from: data).code {
            if code == "INVALID_REQUEST" { throw OverviewLoadError.invalidRequest }
            if code == "DATA_DIRECTORY_IN_USE" { throw OverviewLoadError.dataDirectoryInUse }
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
            case .authenticationFailed: throw OverviewLoadError.unauthorized
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

private struct ManagementErrorResponse: Decodable {
    let code: String
}
