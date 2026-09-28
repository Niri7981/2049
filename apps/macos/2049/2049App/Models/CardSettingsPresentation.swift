import Foundation

/// Only these safe overview fields are eligible for display in Card Settings.
struct CardSettingsPresentation {
    let serviceStatus: String
    let executionMode: String
    let network: String
    let walletAddress: String

    init(_ overview: AppOverview) {
        serviceStatus = switch overview.service.status {
        case .running: "Running"
        case .stopping: "Stopping"
        }
        executionMode = switch overview.service.purchaseMode {
        case .simulated: "Simulated"
        case .liveDevnet: "Live · Devnet"
        }
        network = overview.service.network
        walletAddress = overview.wallet.address
    }
}
