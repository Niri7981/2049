import Foundation

/// Only these safe overview fields are eligible for display in Card Settings.
struct CardSettingsPresentation {
    let serviceStatus: String
    let walletAddress: String
    let dataDirectory: URL?
    let wallets: [ExistingWallet]

    struct WalletsResponse: Decodable {
        let wallets: [ExistingWallet]
    }

    struct ExistingWallet: Decodable, Identifiable {
        let id: String
        let label: String
        let address: String?
        let status: Status

        enum Status: String, Decodable {
            case available, missing, unavailable
        }

        var display: String {
            switch status {
            case .available: address.map { "\($0.prefix(8))…\($0.suffix(4))" } ?? "Wallet unavailable"
            case .missing: "No wallet"
            case .unavailable: "Keychain unavailable"
            }
        }
    }

    init(wallets: [ExistingWallet], dataDirectory: URL? = nil) {
        self.wallets = wallets
        self.dataDirectory = dataDirectory
        serviceStatus = "Running"
        walletAddress = ""
    }

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
        wallets = []
    }

    /// The existing authenticated health response owns the resolved storage path.
    static func dataDirectory(from data: Data) -> URL? {
        guard data.count <= 4096,
              let health = try? JSONDecoder().decode(StorageHealth.self, from: data),
              health.ready, health.service == "Yosh", health.dataDirectory.hasPrefix("/"),
              !health.dataDirectory.utf8.contains(0) else { return nil }
        return URL(fileURLWithPath: health.dataDirectory, isDirectory: true)
    }

    private struct StorageHealth: Decodable {
        let ready: Bool
        let service: String
        let dataDirectory: String
    }
}
