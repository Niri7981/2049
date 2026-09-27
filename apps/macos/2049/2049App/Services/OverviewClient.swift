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
}

struct OverviewClient {
    let runtime: NativeServiceRuntime

    func load(retry: Bool = false) async throws -> AppOverview {
        let data: Data
        let response: HTTPURLResponse
        do {
            let configuration = try await runtime.ready(retry: retry)
            (data, response) = try await configuration.request(.overview)
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

        if response.statusCode == 401 { throw OverviewLoadError.unauthorized }
        guard response.statusCode == 200, data.count <= 1_048_576 else { throw OverviewLoadError.invalidResponse }
        do {
            return try JSONDecoder().decode(AppOverview.self, from: data)
        } catch {
            throw OverviewLoadError.invalidResponse
        }
    }
}
