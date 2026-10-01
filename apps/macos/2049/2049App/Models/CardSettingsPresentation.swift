import Foundation

/// Only these safe overview fields are eligible for display in Card Settings.
struct CardSettingsPresentation {
    let serviceStatus: String
    let walletAddress: String
    let dataDirectory: URL?

    static let repositoryURL = URL(string: "https://github.com/Niri7981/2049")!

    var shortWalletAddress: String {
        guard walletAddress.count > 16 else { return walletAddress }
        return "\(walletAddress.prefix(8))…\(walletAddress.suffix(4))"
    }

    init(_ overview: AppOverview, dataDirectory: URL? = nil) {
        serviceStatus = switch overview.service.status {
        case .running: "Running"
        case .stopping: "Stopping"
        }
        walletAddress = overview.wallet.address
        self.dataDirectory = dataDirectory
    }

    /// The existing authenticated health response owns the resolved storage path.
    static func dataDirectory(from data: Data) -> URL? {
        guard data.count <= 4096,
              let health = try? JSONDecoder().decode(StorageHealth.self, from: data),
              health.ready, health.service == "2049", health.dataDirectory.hasPrefix("/"),
              !health.dataDirectory.utf8.contains(0) else { return nil }
        return URL(fileURLWithPath: health.dataDirectory, isDirectory: true)
    }

    private struct StorageHealth: Decodable {
        let ready: Bool
        let service: String
        let dataDirectory: String
    }
}
